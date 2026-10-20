import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { DB, MediaItem } from './db.js';
import { transcodedDir } from './db.js';
import { isShuttingDown, spawnTool } from './tools.js';

export type TranscodeMode = 'remux' | 'audio' | 'encode';

export const SUPPORTED_VIDEO_CODECS = [
  'h264',
  'avc1',
  'hevc',
  'hvc1',
  'av1',
  'av01',
  'vp9',
  'vp09',
  'vp8',
  'vp08',
];
const SUPPORTED_AUDIO_CODECS = ['aac', 'mp3', 'opus', 'vorbis', 'flac'];
const VP_CODECS = new Set(['vp8', 'vp08', 'vp9', 'vp09']);

export function isSupportedVideoCodec(v: string | null): boolean {
  return v === null || SUPPORTED_VIDEO_CODECS.includes(v);
}

function isSupportedAudioCodec(a: string | null): boolean {
  return a === null || a === '' || SUPPORTED_AUDIO_CODECS.includes(a);
}
/** 「対応コーデックのみ表示」用: 直接再生できる動画のSQL条件 */
export function nativeVideoSql(prefix = ''): string {
  const p = prefix;
  const audio = `(${p}acodec IS NULL OR ${p}acodec = '' OR ${p}acodec IN ('aac','mp3','opus','vorbis','flac'))`;
  const video = `(${p}vcodec IS NULL OR ${p}vcodec IN (${SUPPORTED_VIDEO_CODECS.map(
    (c) => `'${c}'`,
  ).join(',')}))`;
  const webmVideo = `(${p}vcodec IS NULL OR ${p}vcodec IN ('vp8','vp08','vp9','vp09','av1','av01'))`;
  return `((${p}ext IN ('.mp4','.m4v') AND ${video} AND ${audio}) OR (${p}ext = '.webm' AND ${webmVideo} AND ${audio}) OR (${p}ext = '.ogv' AND ${audio}))`;
}

export type TranscodeState = 'none' | 'queued' | 'running' | 'ready' | 'failed';

const TRANSCODE_CONCURRENCY = Number(process.env.TRANSCODE_CONCURRENCY ?? 1);

interface Entry {
  status: TranscodeState;
  progress: number;
  message: string | null;
  mode: TranscodeMode | null;
}

const states = new Map<number, Entry>();

export function transcodeStatus(db: DB, id: number): Entry {
  const cached = states.get(id);
  if (cached) return cached;
  const row = db
    .prepare('SELECT status, progress, mode FROM transcode_cache WHERE media_id = ?')
    .get(id) as { status: string; progress: number; mode: string | null } | undefined;
  const entry: Entry = {
    status: (row?.status as TranscodeState) ?? 'none',
    progress: row?.progress ?? 0,
    message: null,
    mode: (row?.mode as TranscodeMode | null) ?? null,
  };
  states.set(id, entry);
  return entry;
}

export function transcodeOutputPath(id: number, ext: 'mp4' | 'webm' = 'mp4'): string {
  return join(transcodedDir(), `${id}.${ext}`);
}

export function isNativePlayable(item: MediaItem): boolean {
  if (!isSupportedVideoCodec(item.vcodec)) return false;
  if (!isSupportedAudioCodec(item.acodec)) return false;
  switch (item.ext) {
    case '.webm':
      return (
        item.vcodec === null ||
        item.vcodec === 'vp8' ||
        item.vcodec === 'vp08' ||
        item.vcodec === 'vp9' ||
        item.vcodec === 'vp09' ||
        item.vcodec === 'av1' ||
        item.vcodec === 'av01'
      );
    case '.ogv':
      return true;
    case '.mp4':
    case '.m4v':
      // HEVC / AV1 / VP9 は環境依存のため、失敗時はフロントのエラーフォールバックで変換
      return true;
    default:
      return false;
  }
}

interface TranscodePlan {
  mode: TranscodeMode;
  ext: 'mp4' | 'webm';
}

/**
 * 変換方法を決定する:
 * - 直接再生できる       : 対象外 (呼び出し元で native 判定)
 * - コンテナのみ非対応   : remux (無劣化)
 * - 音声のみ非対応       : audio (映像copy + AAC)
 * - 映像コーデック非対応 : encode
 */
function planFor(item: MediaItem): TranscodePlan {
  if (!isSupportedVideoCodec(item.vcodec)) return { mode: 'encode', ext: 'mp4' };
  const audioOk = isSupportedAudioCodec(item.acodec);
  const webmOut =
    VP_CODECS.has(item.vcodec ?? '') &&
    (item.acodec === null ||
      item.acodec === '' ||
      item.acodec === 'opus' ||
      item.acodec === 'vorbis');

  const isVp8 = item.vcodec === 'vp8' || item.vcodec === 'vp08';
  if (isVp8 && (!audioOk || !webmOut)) {
    // VP8 は WebM(Opus/Vorbis)以外への格納互換性が低いためエンコード
    return { mode: 'encode', ext: 'mp4' };
  }
  if (!audioOk) return { mode: 'audio', ext: 'mp4' };
  return { mode: 'remux', ext: webmOut ? 'webm' : 'mp4' };
}
function persist(
  db: DB,
  id: number,
  status: TranscodeState,
  progress: number,
  path?: string,
  size?: number,
  mode?: TranscodeMode | null,
): void {
  db.prepare(
    `INSERT INTO transcode_cache (media_id, status, progress, path, size, mode, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(media_id) DO UPDATE SET
       status = excluded.status,
       progress = excluded.progress,
       path = COALESCE(excluded.path, transcode_cache.path),
       size = COALESCE(excluded.size, transcode_cache.size),
       mode = COALESCE(excluded.mode, transcode_cache.mode),
       updated_at = excluded.updated_at`,
  ).run(id, status, progress, path ?? null, size ?? null, mode ?? null, Date.now());
}

let pumping = false;

export function requestTranscode(db: DB, id: number, force = false): Entry {
  const item = db.prepare('SELECT * FROM media_items WHERE id = ?').get(id) as
    | MediaItem
    | undefined;
  if (!item || item.type !== 'video') {
    throw new Error(`transcode 対象の動画が見つかりません (id=${id})`);
  }
  const entry = transcodeStatus(db, id);
  if (force) {
    // ブラウザ再生に失敗した場合の最終手段: 必ず libx264 エンコードで作り直す
    if (entry.status === 'ready') {
      void unlink(transcodeOutputPath(id, 'mp4')).catch(() => undefined);
      void unlink(transcodeOutputPath(id, 'webm')).catch(() => undefined);
    }
    entry.status = 'queued';
    entry.progress = 0;
    entry.message = null;
    entry.mode = 'encode';
    persist(db, id, 'queued', 0, undefined, undefined, 'encode');
    void pump(db);
    return entry;
  }
  if (entry.status === 'ready' || entry.status === 'running' || entry.status === 'queued') {
    return entry;
  }
  const mode: TranscodeMode = planFor(item).mode;
  entry.status = 'queued';
  entry.progress = 0;
  entry.mode = mode;
  entry.message = null;
  persist(db, id, 'queued', 0, undefined, undefined, mode);
  void pump(db);
  return entry;
}

async function pump(db: DB): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    const claimNext = db.prepare(`
      SELECT media_id FROM transcode_cache WHERE status = 'queued' ORDER BY media_id LIMIT ?
    `);
    for (;;) {
      if (isShuttingDown()) return;
      const next = claimNext.all(TRANSCODE_CONCURRENCY) as { media_id: number }[];
      if (next.length === 0) return;
      await Promise.all(
        next.map((row) => runTranscode(db, row.media_id).catch(() => undefined)),
      );
    }
  } finally {
    pumping = false;
  }
}

/** 起動時回復: running のまま残っている行を再試行に戻す */
export function recoverTranscodes(db: DB): void {
  const rows = db
    .prepare("SELECT media_id, path FROM transcode_cache WHERE status = 'running'")
    .all() as { media_id: number; path: string | null }[];
  for (const r of rows) {
    if (r.path) void unlink(r.path).catch(() => undefined);
    persist(db, r.media_id, 'none', 0);
    states.delete(r.media_id);
  }
}

/**
 * ブラウザが直接再生できるコーデックの不要なエンコード結果を削除する。
 * (例: AV1 対応前に自動変換された MP4 が残っていると、対応後も変換版が配信されてしまう)
 */
export function cleanupObsoleteEncodes(db: DB): void {
  const rows = db
    .prepare(
      `SELECT tc.media_id, tc.path
       FROM transcode_cache tc
       JOIN media_items mi ON mi.id = tc.media_id
       WHERE tc.mode = 'encode' AND mi.vcodec IN ('av1', 'av01')`,
    )
    .all() as { media_id: number; path: string | null }[];
  for (const r of rows) {
    if (r.path) void unlink(r.path).catch(() => undefined);
    db.prepare('DELETE FROM transcode_cache WHERE media_id = ?').run(r.media_id);
    states.delete(r.media_id);
  }
}

async function runTranscode(db: DB, id: number): Promise<void> {
  const item = db.prepare('SELECT * FROM media_items WHERE id = ?').get(id) as
    | MediaItem
    | undefined;
  const entry = states.get(id);
  if (!item) {
    persist(db, id, 'none', 0);
    states.delete(id);
    return;
  }
  const planned = planFor(item);
  let usedMode: TranscodeMode = entry?.mode ?? planned.mode;
  let outPath = transcodeOutputPath(id, usedMode === 'remux' ? planned.ext : 'mp4');
  await mkdir(transcodedDir(), { recursive: true });
  if (entry) {
    entry.status = 'running';
    entry.progress = 0;
    entry.message = null;
    entry.mode = usedMode;
  }
  persist(db, id, 'running', 0, outPath, undefined, usedMode);

  const getStderrSize = async (): Promise<number> => {
    const { stat } = await import('node:fs/promises');
    return (await stat(outPath)).size;
  };

  const runFfmpeg = (args: string[]): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const p = spawnTool('ffmpeg', args);
      let stderr = '';
      p.stderr?.on('data', (chunk) => {
        stderr = (stderr + chunk).slice(-2000);
        const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(chunk.toString());
        if (m && item.duration && item.duration > 0 && !isShuttingDown()) {
          const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
          const progress = Math.min(99, Math.round((seconds / item.duration) * 100));
          if (entry) entry.progress = progress;
          persist(db, id, 'running', progress, outPath, undefined, usedMode);
        }
      });
      p.on('error', reject);
      p.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exit ${code}\n${stderr.slice(-800)}`));
      });
    });

  const removeOtherExtension = (): void => {
    const other = outPath.endsWith('.webm')
      ? transcodeOutputPath(id, 'mp4')
      : transcodeOutputPath(id, 'webm');
    void unlink(other).catch(() => undefined);
  };

  try {
    if (usedMode === 'remux' || usedMode === 'audio') {
      // 無劣化リマックス(音声のみ非対応なら音声だけAACへ)
      try {
        const args =
          usedMode === 'audio'
            ? [
                '-hide_banner',
                '-i', item.path,
                '-c:v', 'copy',
                '-c:a', 'aac',
                '-b:a', '192k',
                '-movflags', '+faststart',
                '-y',
                outPath,
              ]
            : [
                '-hide_banner',
                '-i', item.path,
                '-c:v', 'copy',
                '-c:a', 'copy',
                ...(planned.ext === 'mp4' ? ['-movflags', '+faststart'] : []),
                '-y',
                outPath,
              ];
        await runFfmpeg(args);
        const size = await getStderrSize();
        persist(db, id, 'ready', 100, outPath, size, usedMode);
        if (entry) {
          entry.status = 'ready';
          entry.progress = 100;
          entry.mode = usedMode;
        }
        removeOtherExtension();
        return;
      } catch {
        // リマックス失敗 → フル変換へフォールバック
        usedMode = 'encode';
        if (entry) entry.mode = 'encode';
        await unlink(outPath).catch(() => undefined);
        outPath = transcodeOutputPath(id, 'mp4');
        persist(db, id, 'running', 0, outPath, undefined, usedMode);
      }
    }

    await runFfmpeg([
      '-hide_banner',
      '-i', item.path,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '160k',
      '-movflags', '+faststart',
      '-y',
      outPath,
    ]);

    const size = await getStderrSize();
    persist(db, id, 'ready', 100, outPath, size, usedMode);
    if (entry) {
      entry.status = 'ready';
      entry.progress = 100;
      entry.mode = usedMode;
    }
    removeOtherExtension();
  } catch (e) {
    if (isShuttingDown()) {
      await unlink(outPath).catch(() => undefined);
      return;
    }
    persist(db, id, 'failed', 0, outPath);
    if (entry) {
      entry.status = 'failed';
      entry.message = (e as Error).message.split('\n').slice(-1).join('') || 'transcode failed';
    }
    await unlink(outPath).catch(() => undefined);
  }
}

import { existsSync } from 'node:fs';
import { mkdir, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { DB, MediaItem } from './db.js';
import { thumbDir } from './db.js';
import { isShuttingDown, spawnTool } from './tools.js';

const THUMB_MAX = 384;
const THUMB_QUALITY = 75;
const THUMB_SPEC_KEY = 'thumb_spec';
const THUMB_SPEC = '384-w75';
const THUMB_CONCURRENCY = Number(process.env.THUMB_CONCURRENCY ?? 6);
const VIDEO_SEEK_SECONDS = 5;

export interface ThumbQueueState {
  running: boolean;
  processed: number;
  failed: number;
  remaining: number;
  currentIds: number[];
}

const state: ThumbQueueState = {
  running: false,
  processed: 0,
  failed: 0,
  remaining: 0,
  currentIds: [],
};

let stopping = false;

export function stopThumbQueue(): void {
  stopping = true;
  state.running = false;
  state.currentIds = [];
}

export function thumbStatus(): ThumbQueueState {
  return { ...state, currentIds: [...state.currentIds] };
}

export function thumbPath(id: number): string {
  return join(thumbDir(), `${id}.webp`);
}

export async function ensureThumbDir(): Promise<void> {
  await mkdir(thumbDir(), { recursive: true });
}

export function prepareThumbnails(db: DB): void {
  const row = db
    .prepare('SELECT value FROM app_meta WHERE key = ?')
    .get(THUMB_SPEC_KEY) as { value: string } | undefined;
  if (row?.value !== THUMB_SPEC) {
    db.transaction(() => {
      db.prepare(
        "UPDATE media_items SET thumb_status = 'pending' WHERE status = 'active'",
      ).run();
      db.prepare('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)').run(
        THUMB_SPEC_KEY,
        THUMB_SPEC,
      );
    })();
    console.log(`サムネイル仕様を ${THUMB_SPEC} に更新しました。既存サムネイルを再生成します。`);
  }
  void cleanupOrphanThumbs(db);
}

export async function cleanupOrphanThumbs(db: DB): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(thumbDir());
  } catch {
    return;
  }
  let active: Set<number>;
  try {
    active = new Set(
      (
        db.prepare("SELECT id FROM media_items WHERE status = 'active'").all() as {
          id: number;
        }[]
      ).map((r) => r.id),
    );
  } catch {
    return;
  }
  await Promise.all(
    entries.map(async (name) => {
      const m = /^(\d+)\.(?:webp|cover\.jpg)$/.exec(name);
      if (!m) return;
      if (active.has(Number(m[1]))) return;
      await unlink(join(thumbDir(), name)).catch(() => undefined);
    }),
  );
}

interface ProbeInfo {
  width: number;
  height: number;
  duration: number;
  codec: string | null;
  acodec: string | null;
}

function runTool(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawnTool(cmd, args);
    let stderr = '';
    p.stderr?.on('data', (c) => (stderr += c));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} がコード ${code} で終了しました\n${stderr.slice(-500)}`));
    });
  });
}

async function probeVideo(path: string): Promise<ProbeInfo> {
  const data = await new Promise<string>((resolve, reject) => {
    const p = spawnTool('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,codec_name,width,height',
      '-show_entries', 'format=duration',
      '-of', 'json',
      path,
    ]);
    let out = '';
    p.stdout?.on('data', (c) => (out += c));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`ffprobe がコード ${code} で終了しました`));
    });
  });
  const json = JSON.parse(data) as {
    streams?: {
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
    }[];
    format?: { duration: string };
  };
  const video = json.streams?.find((s) => s.codec_type === 'video');
  const audio = json.streams?.find((s) => s.codec_type === 'audio');
  return {
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    duration: Number(json.format?.duration ?? 0),
    codec: video?.codec_name ?? null,
    acodec: audio?.codec_name ?? null,
  };
}
async function makeVideoThumb(item: MediaItem, outPath: string, duration: number): Promise<void> {
  const seek = duration > 0 ? Math.min(VIDEO_SEEK_SECONDS, duration / 2) : 0;
  await runTool('ffmpeg', [
    '-v', 'error',
    '-ss', seek.toFixed(2),
    '-i', item.path,
    '-frames:v', '1',
    '-vf', `scale=${THUMB_MAX}:-2`,
    '-y',
    outPath,
  ]);
}

interface Dimensions {
  width: number;
  height: number;
  duration: number | null;
  codec: string | null;
  acodec: string | null;
}

const SHARP_LIMIT_INPUT_PIXELS = false;

/** PDF の1ページ目を描画してサムネイル化し、ページ寸法を返す */
async function makePdfThumb(
  itemPath: string,
  outPath: string,
): Promise<{ width: number; height: number }> {
  const { readFile } = await import('node:fs/promises');
  const { createRequire } = await import('node:module');
  const { pathToFileURL } = await import('node:url');
  const { dirname } = await import('node:path');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createCanvas } = await import('@napi-rs/canvas');

  // pdfjs の補助リソース(CJK フォント・JPX デコーダ等)は wasm/fetch 経由で読まれる
  const require = createRequire(import.meta.url);
  let pdfjsDir = dirname(
    dirname(dirname(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'))),
  );
  const unpacked = pdfjsDir.replace(
    /([\\/])app\.asar([\\/])/,
    '$1app.asar.unpacked$2',
  );
  if (unpacked !== pdfjsDir && existsSync(join(unpacked, 'cmaps'))) {
    pdfjsDir = unpacked;
  }
  const resUrl = (sub: string): string => pathToFileURL(`${pdfjsDir}/${sub}`).href + '/';

  const data = new Uint8Array(await readFile(itemPath));
  const doc = await pdfjs.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
    cMapUrl: resUrl('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: resUrl('standard_fonts'),
    wasmUrl: resUrl('wasm'),
    iccUrl: resUrl('iccs'),
  }).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(1, THUMB_MAX / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(
      Math.max(1, Math.ceil(viewport.width)),
      Math.max(1, Math.ceil(viewport.height)),
    );
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
      canvas: canvas as unknown as HTMLCanvasElement,
    }).promise;
    const png = canvas.toBuffer('image/png');
    const { default: sharp } = await import('sharp');
    await sharp(png).webp({ quality: THUMB_QUALITY }).toFile(outPath);
    return { width: Math.round(base.width), height: Math.round(base.height) };
  } finally {
    const closable = doc as unknown as { destroy?: () => Promise<void> };
    if (typeof closable.destroy === 'function') await closable.destroy();
  }
}

async function probeDuration(itemPath: string): Promise<number> {
  const data = await new Promise<string>((resolve, reject) => {
    const p = spawnTool('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'json',
      itemPath,
    ]);
    let out = '';
    p.stdout?.on('data', (c) => (out += c));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error('ffprobe failed'))));
  });
  const json = JSON.parse(data) as { format?: { duration?: string } };
  return Number(json.format?.duration ?? 0);
}

/** 音源に埋め込まれたカバーアートを取り出す(無ければ null) */
async function tryExtractCover(
  itemPath: string,
  id: number,
  outPath: string,
): Promise<{ width: number; height: number } | null> {
  const tmp = join(thumbDir(), `${id}.cover.jpg`);
  try {
    await runTool('ffmpeg', [
      '-v', 'error',
      '-i', itemPath,
      '-map', '0:v:0',
      '-frames:v', '1',
      '-y',
      tmp,
    ]);
    const { default: sharp } = await import('sharp');
    const meta = await sharp(tmp).metadata();
    await sharp(tmp)
      .rotate()
      .resize({ width: THUMB_MAX, height: THUMB_MAX, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toFile(outPath);
    return { width: meta.width ?? 0, height: meta.height ?? 0 };
  } catch {
    return null;
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** カバーアートが無い音源向けのプレースホルダー(グラデーション+音符) */
async function makeMusicPlaceholder(outPath: string, fileName: string, id: number): Promise<void> {
  const hue = (id * 47) % 360;
  const base = fileName.replace(/\.[^.]+$/, '');
  const title = escapeXml(base.length > 20 ? `${base.slice(0, 20)}…` : base);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="hsl(${hue}, 65%, 55%)"/>
        <stop offset="100%" stop-color="hsl(${(hue + 45) % 360}, 65%, 32%)"/>
      </linearGradient>
    </defs>
    <rect width="512" height="512" fill="url(#g)"/>
    <g fill="rgba(255,255,255,0.92)">
      <circle cx="200" cy="332" r="34"/>
      <circle cx="320" cy="302" r="34"/>
      <path d="M232 332V180l122-30v152" fill="none" stroke="rgba(255,255,255,0.92)" stroke-width="16" stroke-linecap="round"/>
    </g>
    <text x="256" y="436" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="20" fill="rgba(255,255,255,0.92)">${title}</text>
  </svg>`;
  const { default: sharp } = await import('sharp');
  await sharp(Buffer.from(svg)).webp({ quality: THUMB_QUALITY }).toFile(outPath);
}

/** 汎用ファイル向けのプレースホルダー(拡張子とファイル名) */
async function makeFilePlaceholder(outPath: string, fileName: string, id: number): Promise<void> {
  const hue = (id * 53) % 360;
  const extMatch = /\.[^.]+$/.exec(fileName);
  const ext = escapeXml((extMatch?.[0] ?? '').replace('.', '').toUpperCase() || 'FILE');
  const base = fileName.replace(/\.[^.]+$/, '');
  const title = escapeXml(base.length > 18 ? `${base.slice(0, 18)}…` : base);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="hsl(${hue}, 35%, 42%)"/>
        <stop offset="100%" stop-color="hsl(${(hue + 35) % 360}, 35%, 24%)"/>
      </linearGradient>
    </defs>
    <rect width="512" height="512" fill="url(#g)"/>
    <path d="M156 120h150l70 70v202a24 24 0 0 1-24 24H156a24 24 0 0 1-24-24V144a24 24 0 0 1 24-24z" fill="rgba(255,255,255,0.14)" stroke="rgba(255,255,255,0.75)" stroke-width="8"/>
    <path d="M306 120v70h70" fill="none" stroke="rgba(255,255,255,0.75)" stroke-width="8"/>
    <text x="256" y="300" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="54" font-weight="700" fill="rgba(255,255,255,0.92)">${ext.slice(0, 6)}</text>
    <text x="256" y="430" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="20" fill="rgba(255,255,255,0.85)">${title}</text>
  </svg>`;
  const { default: sharp } = await import('sharp');
  await sharp(Buffer.from(svg)).webp({ quality: THUMB_QUALITY }).toFile(outPath);
}

async function processItem(item: MediaItem, outPath: string): Promise<Dimensions> {
  if (item.type === 'file') {
    await makeFilePlaceholder(outPath, item.file_name, item.id);
    return { width: 512, height: 512, duration: null, codec: null, acodec: null };
  }
  if (item.type === 'music') {
    const duration = await probeDuration(item.path);
    const cover = await tryExtractCover(item.path, item.id, outPath);
    if (cover) {
      return {
        width: cover.width,
        height: cover.height,
        duration: duration > 0 ? duration : null,
        codec: null,
        acodec: null,
      };
    }
    await makeMusicPlaceholder(outPath, item.file_name, item.id);
    return {
      width: 512,
      height: 512,
      duration: duration > 0 ? duration : null,
      codec: null,
      acodec: null,
    };
  }
  if (item.type === 'pdf') {
    const dims = await makePdfThumb(item.path, outPath);
    return { width: dims.width, height: dims.height, duration: null, codec: null, acodec: null };
  }
  if (item.type === 'video') {
    const info = await probeVideo(item.path);
    await makeVideoThumb(item, outPath, info.duration);
    return {
      width: info.width,
      height: info.height,
      duration: info.duration > 0 ? info.duration : null,
      codec: info.codec,
      acodec: info.acodec ?? '',
    };
  }
  const { default: sharp } = await import('sharp');
  const opts = { limitInputPixels: SHARP_LIMIT_INPUT_PIXELS };
  const meta = await sharp(item.path, opts).metadata();
  await sharp(item.path, opts)
    .rotate()
    .resize({ width: THUMB_MAX, height: THUMB_MAX, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: THUMB_QUALITY })
    .toFile(outPath);
  return { width: meta.width ?? 0, height: meta.height ?? 0, duration: null, codec: null, acodec: null };
}

/**
 * サムネイル生成ワーカー。
 * DB(status=active)の pending 行を CLAIM しながら並行処理する。
 */
export function startThumbQueue(db: DB, concurrency = THUMB_CONCURRENCY): void {
  if (state.running || stopping) return;
  state.running = true;
  state.processed = 0;
  state.failed = 0;

  // 前回中断で in_progress のまま残っている行を pending に戻す
  db.prepare("UPDATE media_items SET thumb_status='pending' WHERE thumb_status='inprogress'").run();
  updateRemaining(db);

  const pending = db
    .prepare(
      "SELECT type, COUNT(*) AS c FROM media_items WHERE thumb_status='pending' AND status='active' GROUP BY type",
    )
    .all() as { type: string; c: number }[];
  const pendingOf = (types: string[]): number =>
    pending.filter((p) => types.includes(p.type)).reduce((a, p) => a + p.c, 0);
  const hasAv = pendingOf(['video', 'music']) > 0;
  const hasPdf = pendingOf(['pdf']) > 0;
  const avWorkers = hasAv ? 2 : 0;
  const pdfWorkers = hasPdf ? 1 : 0;
  const imageWorkers = Math.max(1, concurrency - avWorkers - pdfWorkers);

  const groups: { types: string[]; count: number }[] = [
    { types: ['image', 'file'], count: imageWorkers },
  ];
  if (hasAv) groups.push({ types: ['video', 'music'], count: avWorkers });
  if (hasPdf) groups.push({ types: ['pdf'], count: pdfWorkers });

  const setReady = db.prepare(
    "UPDATE media_items SET thumb_status='ready', width=?, height=?, duration=?, vcodec=?, acodec=? WHERE id=?",
  );
  const setFailed = db.prepare("UPDATE media_items SET thumb_status='failed' WHERE id=?");

  let activeWorkers = groups.reduce((a, g) => a + g.count, 0);
  const finishWorker = (): void => {
    activeWorkers--;
    if (activeWorkers > 0 || stopping) return;
    state.running = false;
    state.currentIds = [];
    try {
      updateRemaining(db);
    } catch {
      state.remaining = 0;
      return;
    }
    if (state.remaining > 0) {
      setImmediate(() => {
        if (!state.running && !stopping) startThumbQueue(db);
      });
    }
  };

  const worker = async (types: string[]): Promise<void> => {
    const placeholders = types.map(() => '?').join(',');
    const claim = db.prepare(`
      UPDATE media_items
      SET thumb_status = 'inprogress'
      WHERE id = (
        SELECT id FROM media_items
        WHERE thumb_status = 'pending' AND status = 'active' AND type IN (${placeholders})
        ORDER BY id LIMIT 1
      )
      RETURNING *
    `);
    try {
      for (;;) {
        if (stopping || isShuttingDown()) return;
        const claimed = claim.get(...types) as unknown;
        if (claimed === undefined) return;
        const item = claimed as unknown as MediaItem;
        state.currentIds.push(item.id);
        const outPath = thumbPath(item.id);
        try {
          const dims = await processItem(item, outPath);
          if (stopping || isShuttingDown()) return;
          setReady.run(
            dims.width || null,
            dims.height || null,
            dims.duration,
            dims.codec,
            dims.acodec,
            item.id,
          );
          state.processed++;
        } catch {
          if (stopping || isShuttingDown()) return;
          setFailed.run(item.id);
          state.failed++;
          await unlink(outPath).catch(() => undefined);
        } finally {
          state.currentIds = state.currentIds.filter((id) => id !== item.id);
          if (!stopping && !isShuttingDown()) updateRemaining(db);
        }
      }
    } catch (e) {
      console.error(`サムネイル処理エラー: ${(e as Error).message}`);
    } finally {
      finishWorker();
    }
  };

  for (const group of groups) {
    for (let i = 0; i < group.count; i++) void worker(group.types);
  }
}

function updateRemaining(db: DB): void {
  state.remaining =
    (
      db
        .prepare(
          "SELECT COUNT(*) AS c FROM media_items WHERE status='active' AND thumb_status IN ('pending','inprogress')",
        )
        .get() as { c: number }
    ).c;
}

/** 単体処理用(テスト・個別再生成)。id 指定で 1 件処理する */
export async function processThumb(db: DB, id: number): Promise<Dimensions> {
  const item = db.prepare('SELECT * FROM media_items WHERE id=?').get(id) as
    | MediaItem
    | undefined;
  if (!item) throw new Error(`media_items に id=${id} が存在しません`);
  const outPath = thumbPath(id);
  const dims = await processItem(item, outPath);
  db.prepare(
    "UPDATE media_items SET thumb_status='ready', width=?, height=?, duration=?, vcodec=?, acodec=? WHERE id=?",
  ).run(dims.width || null, dims.height || null, dims.duration, dims.codec, dims.acodec, id);
  return dims;
}

/**
 * 旧データ向け: 音声コーデック未取得の動画をバックグラウンドで ffprobe し直す
 * (サムネイルは再生成しない)
 */
export function startVideoMetaBackfill(db: DB): void {
  void (async () => {
    const rows = db
      .prepare(
        "SELECT * FROM media_items WHERE type = 'video' AND status = 'active' AND acodec IS NULL",
      )
      .all() as MediaItem[];
    if (rows.length === 0) return;
    const update = db.prepare(
      'UPDATE media_items SET acodec = ?, vcodec = COALESCE(vcodec, ?) WHERE id = ?',
    );
    let cursor = 0;
    const worker = async () => {
      while (cursor < rows.length) {
        const item = rows[cursor++];
        try {
          const info = await probeVideo(item.path);
          update.run(info.acodec ?? '', info.codec, item.id);
        } catch {
          // 読み取り失敗時は次回起動時に再試行
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, rows.length) }, () => worker()));
  })();
}
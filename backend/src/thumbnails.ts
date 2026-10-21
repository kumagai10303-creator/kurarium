import { existsSync } from 'node:fs';
import { mkdir, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { DB, MediaItem } from './db.js';
import { thumbDir } from './db.js';
import sharp from 'sharp';
import { isShuttingDown, spawnTool } from './tools.js';
import {
  THUMB_SPEC,
  clearThumbStore,
  deleteThumbIds,
  getThumb,
  listThumbIds,
  listThumbIdsBySpec,
  putThumb,
  vacuumThumbStore,
} from './thumb_store.js';
import { scheduleThumbCacheCleanup } from './thumb_cache.js';

const THUMB_HEIGHT = 360;
const THUMB_MAX_WIDTH = 1600;
const THUMB_QUALITY = 76;
const THUMB_SPEC_KEY = 'thumb_spec';
const THUMB_CONCURRENCY = Number(process.env.THUMB_CONCURRENCY ?? 6);
const VIDEO_SEEK_SECONDS = 5;

sharp.concurrency(1);

export interface ThumbQueueState {
  running: boolean;
  processed: number;
  failed: number;
  remaining: number;
  total: number;
  currentIds: number[];
}

const state: ThumbQueueState = {
  running: false,
  processed: 0,
  failed: 0,
  remaining: 0,
  total: 0,
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
    clearThumbStore();
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
  if (isShuttingDown()) return;
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

  let currentIds = new Set<number>();
  try {
    const stored = listThumbIds();
    const orphanStored = stored.filter((id) => !active.has(id));
    if (orphanStored.length > 0) deleteThumbIds(orphanStored);
    currentIds = new Set(listThumbIdsBySpec(THUMB_SPEC));
    vacuumThumbStore();
  } catch {
    // thumbnail store may be closed during shutdown
  }

  let entries: string[];
  try {
    entries = await readdir(thumbDir());
  } catch {
    return;
  }
  await Promise.all(
    entries.map(async (name) => {
      const m = /^(\d+)\.(?:webp|cover\.jpg)$/.exec(name);
      if (!m) return;
      const id = Number(m[1]);
      if (!active.has(id)) {
        await unlink(join(thumbDir(), name)).catch(() => undefined);
        return;
      }
      if (currentIds.has(id)) {
        await unlink(join(thumbDir(), name)).catch(() => undefined);
      }
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

function runToolBuffer(cmd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawnTool(cmd, args);
    const chunks: Buffer[] = [];
    let stderr = '';
    p.stdout?.on('data', (c: Buffer) => chunks.push(c));
    p.stderr?.on('data', (c) => (stderr += c));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
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
async function makeVideoThumb(item: MediaItem, info: ProbeInfo): Promise<Buffer> {
  const seek = info.duration > 0 ? Math.min(VIDEO_SEEK_SECONDS, info.duration / 2) : 0;
  const sourceW = info.width > 0 ? info.width : 1280;
  const sourceH = info.height > 0 ? info.height : 720;
  const scale = Math.min(1, THUMB_HEIGHT / sourceH, THUMB_MAX_WIDTH / sourceW);
  const width = Math.max(2, Math.round((sourceW * scale) / 2) * 2);
  const height = Math.max(2, Math.round((sourceH * scale) / 2) * 2);
  return runToolBuffer('ffmpeg', [
    '-v', 'error',
    '-ss', seek.toFixed(2),
    '-i', item.path,
    '-frames:v', '1',
    '-vf', `scale=${width}:${height}:flags=lanczos,unsharp=5:5:0.35:5:5:0`,
    '-c:v', 'libwebp',
    '-quality', '82',
    '-preset', 'photo',
    '-f', 'webp',
    'pipe:1',
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
): Promise<{ width: number; height: number; data: Buffer }> {
  const { readFile } = await import('node:fs/promises');
  const { createRequire } = await import('node:module');
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
  // PDF.js 6 の Node 版は fs.readFile で補助リソースを読むため、
  // file:// URL ではなくファイルシステムパスを渡す必要がある。
  const resUrl = (sub: string): string => join(pdfjsDir, sub).replace(/\\/g, '/') + '/';

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
    const scale = Math.min(1, THUMB_HEIGHT / base.height, THUMB_MAX_WIDTH / base.width);
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
    const data = await sharp(png).webp({ quality: THUMB_QUALITY, smartSubsample: true }).toBuffer();
    return { width: Math.round(base.width), height: Math.round(base.height), data };
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
): Promise<{ width: number; height: number; data: Buffer } | null> {
  try {
    const frame = await runToolBuffer('ffmpeg', [
      '-v', 'error',
      '-i', itemPath,
      '-map', '0:v:0',
      '-frames:v', '1',
      '-f', 'image2pipe',
      '-vcodec', 'png',
      'pipe:1',
    ]);
    const { default: sharp } = await import('sharp');
    const meta = await sharp(frame).metadata();
    const data = await sharp(frame)
      .rotate()
      .resize({
        width: THUMB_MAX_WIDTH,
        height: THUMB_HEIGHT,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: THUMB_QUALITY, smartSubsample: true })
      .toBuffer();
    return { width: meta.width ?? 0, height: meta.height ?? 0, data };
  } catch {
    return null;
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function makeMusicPlaceholder(fileName: string, id: number): Promise<Buffer> {
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
  return sharp(Buffer.from(svg)).webp({ quality: THUMB_QUALITY }).toBuffer();
}

async function makeFilePlaceholder(fileName: string, id: number): Promise<Buffer> {
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
  return sharp(Buffer.from(svg)).webp({ quality: THUMB_QUALITY }).toBuffer();
}
interface ThumbResult {
  dimensions: Dimensions;
  data: Buffer;
}

async function processItem(item: MediaItem): Promise<ThumbResult> {
  if (item.type === 'file') {
    return {
      dimensions: { width: 512, height: 512, duration: null, codec: null, acodec: null },
      data: await makeFilePlaceholder(item.file_name, item.id),
    };
  }
  if (item.type === 'music') {
    const duration = await probeDuration(item.path);
    const cover = await tryExtractCover(item.path);
    if (cover) {
      return {
        dimensions: {
          width: cover.width,
          height: cover.height,
          duration: duration > 0 ? duration : null,
          codec: null,
          acodec: null,
        },
        data: cover.data,
      };
    }
    return {
      dimensions: {
        width: 512,
        height: 512,
        duration: duration > 0 ? duration : null,
        codec: null,
        acodec: null,
      },
      data: await makeMusicPlaceholder(item.file_name, item.id),
    };
  }
  if (item.type === 'pdf') {
    const pdf = await makePdfThumb(item.path);
    return {
      dimensions: {
        width: pdf.width,
        height: pdf.height,
        duration: null,
        codec: null,
        acodec: null,
      },
      data: pdf.data,
    };
  }
  if (item.type === 'video') {
    const info = await probeVideo(item.path);
    return {
      dimensions: {
        width: info.width,
        height: info.height,
        duration: info.duration > 0 ? info.duration : null,
        codec: info.codec,
        acodec: info.acodec ?? '',
      },
      data: await makeVideoThumb(item, info),
    };
  }
  const { default: sharp } = await import('sharp');
  const opts = { limitInputPixels: SHARP_LIMIT_INPUT_PIXELS, failOn: 'none' as const };
  const meta = await sharp(item.path, opts).metadata();
  const data = await sharp(item.path, opts)
    .rotate()
    .resize({
      width: THUMB_MAX_WIDTH,
      height: THUMB_HEIGHT,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .sharpen({ sigma: 0.7, m1: 0.5, m2: 0.7 })
    .webp({ quality: THUMB_QUALITY, smartSubsample: true })
    .toBuffer();
  return {
    dimensions: {
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      duration: null,
      codec: null,
      acodec: null,
    },
    data,
  };
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
  state.total = (
    db
      .prepare(
        "SELECT COUNT(*) AS c FROM media_items WHERE status='active' AND thumb_status='pending'",
      )
      .get() as { c: number }
  ).c;
  state.remaining = state.total;

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
  const imageWorkers = Math.max(1, Math.min(4, concurrency - avWorkers - pdfWorkers));

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
    let pending = 0;
    try {
      pending = (
        db
          .prepare(
            "SELECT COUNT(*) AS c FROM media_items WHERE status='active' AND thumb_status='pending'",
          )
          .get() as { c: number }
      ).c;
    } catch {
      state.remaining = 0;
      return;
    }
    if (pending > 0) {
      state.remaining = pending;
      state.total = Math.max(state.total, state.processed + state.failed + pending);
      setImmediate(() => {
        if (!state.running && !stopping) startThumbQueue(db);
      });
    } else {
      state.remaining = 0;
      vacuumThumbStore();
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
        try {
          const result = await processItem(item);
          if (stopping || isShuttingDown()) return;
          putThumb(item.id, result.data);
          await unlink(thumbPath(item.id)).catch(() => undefined);
          const dims = result.dimensions;
          setReady.run(
            dims.width || null,
            dims.height || null,
            dims.duration,
            dims.codec,
            dims.acodec,
            item.id,
          );
          state.processed++;
          state.remaining = Math.max(0, state.remaining - 1);
        } catch {
          if (stopping || isShuttingDown()) return;
          setFailed.run(item.id);
          state.failed++;
          state.remaining = Math.max(0, state.remaining - 1);
        } finally {
          state.currentIds = state.currentIds.filter((id) => id !== item.id);
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
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

class Limiter {
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly max: number) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.active++;
        task()
          .then(resolve, reject)
          .finally(() => {
            this.active--;
            this.queue.shift()?.();
          });
      };
      if (this.active < this.max) start();
      else this.queue.push(start);
    });
  }
}

const limiters = {
  image: new Limiter(4),
  av: new Limiter(2),
  pdf: new Limiter(1),
};

const inflight = new Map<number, Promise<Buffer>>();

function limiterFor(type: MediaItem['type']): Limiter {
  if (type === 'video' || type === 'music') return limiters.av;
  if (type === 'pdf') return limiters.pdf;
  return limiters.image;
}

export async function ensureThumbnail(db: DB, item: MediaItem): Promise<Buffer> {
  const cached = getThumb(item.id);
  if (cached?.spec === THUMB_SPEC && item.thumb_status === 'ready') {
    return cached.data;
  }
  if (cached) deleteThumbIds([item.id]);

  const existing = inflight.get(item.id);
  if (existing) return existing;

  const task = limiterFor(item.type)
    .run(async () => {
      const result = await processItem(item);
      putThumb(item.id, result.data);
      await unlink(thumbPath(item.id)).catch(() => undefined);
      const dims = result.dimensions;
      db.prepare(
        "UPDATE media_items SET thumb_status='ready', width=?, height=?, duration=?, vcodec=?, acodec=? WHERE id=?",
      ).run(
        dims.width || null,
        dims.height || null,
        dims.duration,
        dims.codec,
        dims.acodec,
        item.id,
      );
      scheduleThumbCacheCleanup(db);
      return result.data;
    })
    .catch((e: Error) => {
      db.prepare("UPDATE media_items SET thumb_status='failed' WHERE id=?").run(item.id);
      throw e;
    });

  inflight.set(item.id, task);
  try {
    return await task;
  } finally {
    inflight.delete(item.id);
  }
}

/** 単体処理用(テスト・個別再生成)。id 指定で 1 件処理する */
export async function processThumb(db: DB, id: number): Promise<Dimensions> {
  const item = db.prepare('SELECT * FROM media_items WHERE id=?').get(id) as
    | MediaItem
    | undefined;
  if (!item) throw new Error(`media_items に id=${id} が存在しません`);
  const result = await processItem(item);
  putThumb(id, result.data);
  await unlink(thumbPath(id)).catch(() => undefined);
  const dims = result.dimensions;
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
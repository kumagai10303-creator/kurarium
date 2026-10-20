import { readdir, stat } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';
import type { DB, LibraryKind } from './db.js';
import { absMediaPath, type AppConfig } from './config.js';
import { applyTagRules } from './tags.js';
import { extensionsFor, getConnection, listLibraries } from './libraries.js';
import { ensureMounted } from './mount.js';
import { isShuttingDown } from './tools.js';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic', '.avif', '.apng']);
const VIDEO_EXTS = new Set([
  '.mp4', '.m4v', '.mkv', '.avi', '.mov', '.wmv', '.webm',
  '.mpg', '.mpeg', '.flv', '.3gp', '.ogv', '.ts', '.m2ts',
]);
const PDF_EXTS = new Set(['.pdf']);
const AUDIO_EXTS = new Set([
  '.mp3', '.m4a', '.aac', '.flac', '.wav', '.ogg', '.oga', '.opus',
  '.wma', '.aiff', '.aif', '.ape', '.alac', '.mka',
]);

export type MediaType = 'image' | 'video' | 'pdf' | 'music';

export type ScanMode = 'full' | 'diff';

export function classifyFile(ext: string): MediaType | null {
  const e = ext.toLowerCase();
  if (IMAGE_EXTS.has(e)) return 'image';
  if (VIDEO_EXTS.has(e)) return 'video';
  if (PDF_EXTS.has(e)) return 'pdf';
  if (AUDIO_EXTS.has(e)) return 'music';
  return null;
}

interface WalkEntry {
  path: string;
  size: number;
  mtimeMs: number;
}

async function walk(
  dir: string,
  out: WalkEntry[],
  isCandidate: (name: string) => boolean,
  depth = 0,
): Promise<void> {
  if (depth > 20) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const dirs: string[] = [];
  const files: WalkEntry[] = [];
  const stats = await Promise.all(
    entries.map(async (e) => {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!e.name.startsWith('.')) dirs.push(full);
        return null;
      }
      if (!e.isFile()) return null;
      if (!isCandidate(e.name)) return null;
      try {
        const st = await stat(full);
        return { path: full, size: st.size, mtimeMs: st.mtimeMs };
      } catch {
        return null;
      }
    }),
  );
  for (const s of stats) if (s) files.push(s);
  out.push(...files);
  await Promise.all(dirs.map((d) => walk(d, out, isCandidate, depth + 1)));
}

export interface ScanResult {
  folder: string;
  media: LibraryKind;
  mode: ScanMode;
  total: number;
  inserted: number;
  updated: number;
  removed: number;
  durationMs: number;
}

export interface ScanSummary {
  startedAt: number;
  finishedAt: number | null;
  results: ScanResult[];
  error: string | null;
}

const UPSERT_SQL = `
  INSERT INTO media_items
    (type, path, folder, file_name, ext, size, width, height, duration,
     mtime, thumb_status, status, added_at, last_scanned, library_id, library_path_id)
  VALUES
    (@type, @path, @folder, @file_name, @ext, @size, NULL, NULL, NULL,
     @mtime, 'pending', 'active', @now, @now, @library_id, @library_path_id)
  ON CONFLICT(path) DO UPDATE SET
    size     = excluded.size,
    mtime    = excluded.mtime,
    folder   = excluded.folder,
    file_name= excluded.file_name,
    ext      = excluded.ext,
    type     = excluded.type,
    status   = 'active',
    last_scanned = excluded.last_scanned,
    library_id = excluded.library_id,
    library_path_id = excluded.library_path_id
`;

interface ScanTarget {
  absBase: string;
  alias: string;
  libraryId: number | null;
  libraryPathId: number | null;
  kind: LibraryKind;
  /** ライブラリで明示指定された拡張子(空なら種別の既定) */
  extensions: string[];
}

function allowMixedMedia(db: DB): boolean {
  const row = db
    .prepare("SELECT value FROM app_meta WHERE key = 'allow_mixed_media'")
    .get() as { value: string } | undefined;
  return row?.value === '1';
}

async function scanDirectory(
  db: DB,
  target: ScanTarget,
  seenAt: number,
  mode: ScanMode,
): Promise<ScanResult> {
  const { absBase, alias, libraryId, libraryPathId, kind, extensions } = target;
  const mixed = allowMixedMedia(db);
  const allowed = new Set(
    extensions.length > 0
      ? extensions
      : mixed
        ? []
        : extensionsFor(kind, []),
  );
  const include = (p: string): boolean => {
    const ext = extname(p).toLowerCase();
    if (allowed.size > 0) return allowed.has(ext);
    return mixed ? classifyFile(ext) !== null : false;
  };
  const typeFor = (p: string): MediaType | 'file' => classifyFile(extname(p)) ?? 'file';
  const entries: WalkEntry[] = [];
  const start = Date.now();
  await walk(absBase, entries, (name) => include(name));
  if (isShuttingDown()) throw new Error('shutdown');
  const items = entries;

  const insert = db.prepare(UPSERT_SQL);
  const resetThumb = db.prepare(
    "UPDATE media_items SET thumb_status='pending', width=NULL, height=NULL, duration=NULL WHERE path = ? AND thumb_status != 'pending'",
  );

  const rowParams = (it: WalkEntry) => {
    const rel = relative(absBase, it.path).split(sep).join('\\');
    return {
      type: typeFor(it.path),
      path: it.path,
      folder: alias,
      file_name: rel,
      ext: extname(it.path).toLowerCase(),
      size: it.size,
      mtime: Math.round(it.mtimeMs),
      now: seenAt,
      library_id: libraryId,
      library_path_id: libraryPathId,
    };
  };

  let inserted = 0;
  let updated = 0;
  let removed = 0;

  if (mode === 'full') {
    const selectRow = db.prepare(
      'SELECT id, size, mtime, type, status, thumb_status FROM media_items WHERE path = ?',
    );
    const tx = db.transaction((list: WalkEntry[]) => {
      for (const it of list) {
        const prev = selectRow.get(it.path) as
          | { id: number; size: number; mtime: number; type: string; status: string; thumb_status: string }
          | undefined;
        insert.run(rowParams(it));
        const changed =
          !prev ||
          prev.size !== it.size ||
          Math.round(prev.mtime) !== Math.round(it.mtimeMs) ||
          prev.type !== typeFor(it.path) ||
          prev.status !== 'active';
        if (!prev) {
          inserted++;
        } else if (changed) {
          updated++;
          resetThumb.run(it.path);
        }
      }
    });
    tx.call(db, items);

    removed = libraryPathId !== null
      ? db
          .prepare(
            "UPDATE media_items SET status='missing' WHERE library_path_id = ? AND last_scanned < ?",
          )
          .run(libraryPathId, seenAt).changes
      : db
          .prepare(
            "UPDATE media_items SET status='missing' WHERE library_path_id IS NULL AND folder = ? AND last_scanned < ?",
          )
          .run(alias, seenAt).changes;
  } else {
    const rows = (
      libraryPathId !== null
        ? db
            .prepare(
              'SELECT path, size, mtime, type, status, library_id, library_path_id FROM media_items WHERE library_path_id = ? OR (library_path_id IS NULL AND folder = ?)',
            )
            .all(libraryPathId, alias)
        : db
            .prepare(
              'SELECT path, size, mtime, type, status, library_id, library_path_id FROM media_items WHERE library_path_id IS NULL AND folder = ?',
            )
            .all(alias)
    ) as {
      path: string;
      size: number;
      mtime: number;
      type: string;
      status: string;
      library_id: number | null;
      library_path_id: number | null;
    }[];
    const byPath = new Map(rows.map((r) => [r.path, r]));
    const update = db.prepare(`
      UPDATE media_items SET
        size = @size, mtime = @mtime, folder = @folder, file_name = @file_name,
        ext = @ext, type = @type, status = 'active', last_scanned = @now,
        library_id = @library_id, library_path_id = @library_path_id
      WHERE path = @path
    `);
    const markMissing = db.prepare(
      "UPDATE media_items SET status='missing' WHERE path = ? AND status = 'active'",
    );
    const seen = new Set<string>();

    const tx = db.transaction((list: WalkEntry[]) => {
      for (const it of list) {
        seen.add(it.path);
        const prev = byPath.get(it.path);
        if (!prev) {
          insert.run(rowParams(it));
          inserted++;
          continue;
        }
        const contentChanged =
          prev.size !== it.size || Math.round(prev.mtime) !== Math.round(it.mtimeMs);
        const relink =
          prev.type !== typeFor(it.path) ||
          prev.library_id !== libraryId ||
          prev.library_path_id !== libraryPathId;
        if (contentChanged || relink || prev.status !== 'active') {
          update.run(rowParams(it));
          updated++;
          if (contentChanged || prev.type !== typeFor(it.path)) resetThumb.run(it.path);
        }
      }
      for (const r of rows) {
        if (!seen.has(r.path) && markMissing.run(r.path).changes > 0) removed++;
      }
    });
    tx.call(db, items);
  }

  return {
    folder: alias,
    media: kind,
    mode,
    total: items.length,
    inserted,
    updated,
    removed,
    durationMs: Date.now() - start,
  };
}

/** 旧テスト/互換用: 設定のドライブ基準フォルダをスキャン(ライブラリ未使用) */
export async function scanFolder(
  db: DB,
  config: AppConfig,
  folder: string,
  media: MediaType,
  seenAt: number,
  mode: ScanMode = 'full',
): Promise<ScanResult> {
  return scanDirectory(
    db,
    {
      absBase: absMediaPath(config, folder),
      alias: folder,
      libraryId: null,
      libraryPathId: null,
      kind: media,
      extensions: [],
    },
    seenAt,
    mode,
  );
}

const scanState = {
  running: false,
  mode: 'diff' as ScanMode,
  startedAt: 0,
  finishedAt: null as number | null,
  folders: [] as { folder: string; media: LibraryKind }[],
  currentIndex: -1,
  currentFolder: null as string | null,
  results: [] as ScanResult[],
  error: null as string | null,
};

export function scanStatus() {
  return {
    running: scanState.running,
    mode: scanState.mode,
    currentIndex: scanState.currentIndex,
    currentFolder: scanState.currentFolder,
    totalFolders: scanState.folders.length,
    results: scanState.results,
    lastFinishedAt: scanState.finishedAt,
    error: scanState.error,
  };
}

async function resolveTargetBase(
  db: DB,
  provider: string,
  path: string,
  smbConnectionId: number | null,
): Promise<string> {
  if (provider === 'smb') {
    if (smbConnectionId === null) throw new Error('SMB 接続が未設定です');
    const conn = getConnection(db, smbConnectionId);
    if (!conn) throw new Error('SMB 接続が見つかりません');
    const base = await ensureMounted({
      host: conn.host,
      share: conn.share,
      username: conn.username,
      driveLetter: conn.drive_letter,
    });
    return join(base, path);
  }
  return path;
}

export async function scanAll(
  db: DB,
  config: AppConfig,
  mode: ScanMode = 'diff',
): Promise<ScanSummary> {
  if (scanState.running) {
    throw Object.assign(new Error('スキャンは実行中です'), { statusCode: 409 });
  }
  scanState.running = true;
  scanState.mode = mode;
  scanState.startedAt = Date.now();
  scanState.finishedAt = null;
  scanState.results = [];
  scanState.error = null;
  scanState.currentFolder = null;

  const libraries = listLibraries(db, false);
  const targets: {
    label: string;
    kind: LibraryKind;
    extensions: string[];
    provider: string;
    path: string;
    smbConnectionId: number | null;
    libraryId: number;
    libraryPathId: number;
  }[] = [];
  for (const lib of libraries) {
    for (const p of lib.paths) {
      if (!p.enabled) continue;
      targets.push({
        label: lib.name,
        kind: lib.kind,
        extensions:
          lib.extensions && lib.extensions.length > 0
            ? lib.extensions
                .split(',')
                .map((s) => s.trim())
                .filter((s) => s.length > 0)
            : [],
        provider: p.provider,
        path: p.path,
        smbConnectionId: p.smb_connection_id,
        libraryId: lib.id,
        libraryPathId: p.id,
      });
    }
  }
  scanState.folders = targets.map((t) => ({ folder: t.label, media: t.kind }));

  try {
    for (let i = 0; i < targets.length; i++) {
      if (isShuttingDown()) break;
      const t = targets[i];
      scanState.currentIndex = i;
      scanState.currentFolder = t.label;
      try {
        const absBase = await resolveTargetBase(db, t.provider, t.path, t.smbConnectionId);
        const r = await scanDirectory(
          db,
          {
            absBase,
            alias: t.label,
            libraryId: t.libraryId,
            libraryPathId: t.libraryPathId,
            kind: t.kind,
            extensions: t.extensions,
          },
          Date.now(),
          mode,
        );
        scanState.results.push(r);
      } catch (e) {
        console.error(`スキャンをスキップ (${t.label}: ${t.path}): ${(e as Error).message}`);
      }
    }
    if (!isShuttingDown()) void applyTagRules(db, config.tags.rules);
  } catch (e) {
    if (!isShuttingDown()) scanState.error = (e as Error).message;
  } finally {
    scanState.finishedAt = Date.now();
    scanState.running = false;
    scanState.currentIndex = -1;
    scanState.currentFolder = null;
  }
  return {
    startedAt: scanState.startedAt,
    finishedAt: scanState.finishedAt,
    results: scanState.results,
    error: scanState.error,
  };
}

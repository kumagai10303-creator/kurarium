import { win32 } from 'node:path';
import type {
  DB,
  LibraryKind,
  LibraryPathRow,
  LibraryProvider,
  LibraryRow,
  SmbConnectionRow,
} from './db.js';
import type { AppConfig } from './config.js';
import { registerCredential } from './mount.js';

export interface LibraryWithPaths extends LibraryRow {
  paths: LibraryPathRow[];
}

export interface PathInput {
  provider: LibraryProvider;
  path: string;
  smbConnectionId?: number | null;
  enabled?: boolean;
}

export interface LibraryInput {
  name: string;
  /** タブ名(任意)。同名のライブラリが同じタブにまとまる */
  tab: string;
  /** 対象拡張子(空配列ならタブ/種別の既定値) */
  extensions: string[];
  enabled?: boolean;
  paths: PathInput[];
}

const TAB_TO_KIND: Record<string, LibraryKind> = {
  '画像': 'image',
  '動画': 'video',
  'PDF': 'pdf',
  '音楽': 'music',
};

export function kindForTab(tab: string): LibraryKind {
  return TAB_TO_KIND[tab] ?? TAB_TO_KIND[tab.toUpperCase()] ?? 'custom';
}

export function tabForKind(kind: LibraryKind): string {
  const found = Object.entries(TAB_TO_KIND).find(([, k]) => k === kind);
  return found ? found[0] : kind;
}

const DEFAULT_EXTENSIONS: Record<LibraryKind, string[]> = {
  image: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic', '.avif', '.apng'],
  video: ['.mp4', '.m4v', '.mkv', '.avi', '.mov', '.wmv', '.webm', '.mpg', '.mpeg', '.flv', '.3gp', '.ogv', '.ts', '.m2ts'],
  pdf: ['.pdf'],
  music: ['.mp3', '.m4a', '.aac', '.flac', '.wav', '.ogg', '.oga', '.opus', '.wma', '.aiff', '.aif', '.ape', '.alac', '.mka'],
  custom: [],
};

export function extensionsFor(kind: LibraryKind, extensions: string[] | null): string[] {
  if (extensions && extensions.length > 0) return extensions;
  return DEFAULT_EXTENSIONS[kind];
}

/** 拡張子入力を正規化(小文字・先頭ドット・重複排除) */
export function normalizeExtensions(input: string[] | string | null | undefined): string[] {
  const raw =
    typeof input === 'string'
      ? input.split(',')
      : Array.isArray(input)
        ? input
        : [];
  const out: string[] = [];
  for (const part of raw) {
    let ext = String(part).trim().toLowerCase();
    if (!ext) continue;
    if (!ext.startsWith('.')) ext = `.${ext}`;
    if (!/^\.[a-z0-9]+$/.test(ext)) continue;
    if (!out.includes(ext)) out.push(ext);
  }
  return out;
}

/** Windows の絶対パス(ドライブレター or UNC)か */
export function isAbsoluteMediaPath(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || /^\\\\/.test(p);
}

export function listLibraries(db: DB, includeDisabled = false): LibraryWithPaths[] {
  const rows = db
    .prepare(
      `SELECT * FROM libraries ${includeDisabled ? '' : 'WHERE enabled = 1'}
       ORDER BY sort_order ASC, id ASC`,
    )
    .all() as LibraryRow[];
  const pathStmt = db.prepare(
    'SELECT * FROM library_paths WHERE library_id = ? ORDER BY sort_order ASC, id ASC',
  );
  return rows.map((r) => ({ ...r, paths: pathStmt.all(r.id) as LibraryPathRow[] }));
}

export function getLibrary(db: DB, id: number): LibraryWithPaths | undefined {
  const row = db.prepare('SELECT * FROM libraries WHERE id = ?').get(id) as LibraryRow | undefined;
  if (!row) return undefined;
  const paths = db
    .prepare('SELECT * FROM library_paths WHERE library_id = ? ORDER BY sort_order ASC, id ASC')
    .all(id) as LibraryPathRow[];
  return { ...row, paths };
}

function insertPaths(db: DB, libraryId: number, paths: PathInput[]): void {
  const stmt = db.prepare(
    `INSERT INTO library_paths (library_id, provider, path, smb_connection_id, enabled, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  paths.forEach((p, i) => {
    stmt.run(libraryId, p.provider, p.path, p.smbConnectionId ?? null, p.enabled === false ? 0 : 1, i);
  });
}

function nextSortOrder(db: DB): number {
  const row = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM libraries').get() as {
    m: number;
  };
  return row.m + 1;
}

export function createLibrary(db: DB, input: LibraryInput): LibraryWithPaths {
  const now = Date.now();
  const tab = input.tab.trim();
  const kind = kindForTab(tab);
  const extensions = normalizeExtensions(input.extensions);
  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO libraries (name, kind, tab_name, extensions, enabled, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.name,
        kind,
        tab,
        extensions.length > 0 ? extensions.join(',') : null,
        input.enabled === false ? 0 : 1,
        nextSortOrder(db),
        now,
        now,
      );
    const id = Number(info.lastInsertRowid);
    insertPaths(db, id, input.paths);
    return id;
  });
  const id = tx();
  return getLibrary(db, id) as LibraryWithPaths;
}

export function updateLibrary(
  db: DB,
  id: number,
  patch: Partial<LibraryInput>,
): LibraryWithPaths | undefined {
  const tx = db.transaction(() => {
    const current = db.prepare('SELECT * FROM libraries WHERE id = ?').get(id) as
      | LibraryRow
      | undefined;
    if (!current) return;
    const nextTab = patch.tab !== undefined ? patch.tab.trim() : (current.tab_name || tabForKind(current.kind));
    const nextKind = patch.tab !== undefined ? kindForTab(nextTab) : current.kind;
    const nextExtensions =
      patch.extensions !== undefined
        ? normalizeExtensions(patch.extensions)
        : normalizeExtensions(
            (current.extensions ?? '')
              .split(',')
              .filter((s) => s.length > 0),
          );
    db.prepare(
      `UPDATE libraries SET name = ?, kind = ?, tab_name = ?, extensions = ?, enabled = ?, updated_at = ? WHERE id = ?`,
    ).run(
      patch.name ?? current.name,
      nextKind,
      nextTab,
      nextExtensions.length > 0 ? nextExtensions.join(',') : null,
      patch.enabled === undefined ? current.enabled : patch.enabled ? 1 : 0,
      Date.now(),
      id,
    );
    if (patch.paths) {
      const signature = (
        list: {
          provider: string;
          path: string;
          smb_connection_id?: number | null;
          smbConnectionId?: number | null;
          enabled?: number | boolean;
        }[],
      ) =>
        JSON.stringify(
          list.map((p) => [
            p.provider,
            p.path,
            p.smbConnectionId ?? p.smb_connection_id ?? null,
            p.enabled === false || p.enabled === 0 ? 0 : 1,
          ]),
        );
      const currentPaths = db
        .prepare('SELECT provider, path, smb_connection_id, enabled FROM library_paths WHERE library_id = ? ORDER BY sort_order ASC, id ASC')
        .all(id) as { provider: string; path: string; smb_connection_id: number | null; enabled: number }[];
      if (signature(currentPaths) !== signature(patch.paths)) {
        db.prepare('DELETE FROM library_paths WHERE library_id = ?').run(id);
        insertPaths(db, id, patch.paths);
        const newIds = (
          db.prepare('SELECT id FROM library_paths WHERE library_id = ?').all(id) as { id: number }[]
        ).map((r) => r.id);
        // 削除されたパスのアイテムは一覧から外す(再スキャンで再紐付け)
        const placeholders = newIds.map(() => '?').join(',');
        if (newIds.length > 0) {
          db.prepare(
            `UPDATE media_items SET status = 'missing'
             WHERE library_id = ? AND (library_path_id IS NULL OR library_path_id NOT IN (${placeholders}))`,
          ).run(id, ...newIds);
        }
      }
    }
  });
  tx();
  return getLibrary(db, id);
}

export function deleteLibrary(db: DB, id: number): void {
  const tx = db.transaction(() => {
    db.prepare("UPDATE media_items SET status='missing' WHERE library_id = ?").run(id);
    db.prepare('DELETE FROM library_paths WHERE library_id = ?').run(id);
    db.prepare('DELETE FROM libraries WHERE id = ?').run(id);
  });
  tx();
}

export function reorderLibraries(db: DB, ids: number[]): void {
  const stmt = db.prepare('UPDATE libraries SET sort_order = ?, updated_at = ? WHERE id = ?');
  const now = Date.now();
  const tx = db.transaction(() => {
    ids.forEach((id, i) => stmt.run(i, now, id));
  });
  tx();
}

// ---- SMB 接続 ----

export function listConnections(db: DB): SmbConnectionRow[] {
  return db.prepare('SELECT * FROM smb_connections ORDER BY id ASC').all() as SmbConnectionRow[];
}

export interface ConnectionInput {
  name: string;
  host: string;
  share: string;
  username: string;
  driveLetter?: string | null;
  autoMount?: boolean;
}

export function createConnection(db: DB, input: ConnectionInput): SmbConnectionRow {
  const info = db
    .prepare(
      `INSERT INTO smb_connections (name, host, share, username, drive_letter, auto_mount, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.name,
      input.host,
      input.share,
      input.username,
      input.driveLetter?.replace(/\\$/, '') || null,
      input.autoMount === false ? 0 : 1,
      Date.now(),
    );
  return db
    .prepare('SELECT * FROM smb_connections WHERE id = ?')
    .get(Number(info.lastInsertRowid)) as SmbConnectionRow;
}

export function updateConnection(
  db: DB,
  id: number,
  patch: Partial<ConnectionInput>,
): SmbConnectionRow | undefined {
  const cur = db.prepare('SELECT * FROM smb_connections WHERE id = ?').get(id) as
    | SmbConnectionRow
    | undefined;
  if (!cur) return undefined;
  db.prepare(
    `UPDATE smb_connections SET name = ?, host = ?, share = ?, username = ?, drive_letter = ?, auto_mount = ? WHERE id = ?`,
  ).run(
    patch.name ?? cur.name,
    patch.host ?? cur.host,
    patch.share ?? cur.share,
    patch.username ?? cur.username,
    patch.driveLetter === undefined
      ? cur.drive_letter
      : patch.driveLetter?.replace(/\\$/, '') || null,
    patch.autoMount === undefined ? cur.auto_mount : patch.autoMount ? 1 : 0,
    id,
  );
  return db.prepare('SELECT * FROM smb_connections WHERE id = ?').get(id) as SmbConnectionRow;
}

export function deleteConnection(db: DB, id: number): void {
  db.prepare('DELETE FROM smb_connections WHERE id = ?').run(id);
  db.prepare('UPDATE library_paths SET enabled = 0 WHERE smb_connection_id = ?').run(id);
}

export function getConnection(db: DB, id: number): SmbConnectionRow | undefined {
  return db.prepare('SELECT * FROM smb_connections WHERE id = ?').get(id) as
    | SmbConnectionRow
    | undefined;
}

// ---- 旧 config.ini からの移行 ----

function uniqueName(db: DB, base: string): string {
  let name = base;
  let n = 2;
  const exists = db.prepare('SELECT 1 FROM libraries WHERE name = ? COLLATE NOCASE');
  while (exists.get(name)) {
    name = `${base} (${n++})`;
  }
  return name;
}

function pathBasename(p: string): string {
  const normalized = p.replace(/\//g, '\\');
  const base = win32.basename(normalized, win32.extname(normalized));
  return base || normalized;
}

/**
 * 旧 config.ini ([smb] + [media]) からライブラリ/接続を作成し、
 * 既存 media_items を library_id に紐付ける(初回のみ)。
 */
export async function importLegacyConfig(db: DB, config: AppConfig): Promise<void> {
  const flag = db
    .prepare("SELECT value FROM app_meta WHERE key = 'legacy_libraries_imported'")
    .get() as { value: string } | undefined;
  if (flag) return;
  const count = (db.prepare('SELECT COUNT(*) AS c FROM libraries').get() as { c: number }).c;
  if (count > 0) {
    db.prepare(
      "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('legacy_libraries_imported', '1')",
    ).run();
    return;
  }

  let connId: number | null = null;
  if (config.smb.host && config.smb.share) {
    const conn = createConnection(db, {
      name: 'SMB',
      host: config.smb.host,
      share: config.smb.share,
      username: config.smb.username,
      driveLetter: config.smb.driveLetter,
      autoMount: config.smb.autoMount,
    });
    connId = conn.id;
    if (config.smb.username && config.smb.password) {
      await registerCredential(config.smb.host, config.smb.username, config.smb.password).catch(
        (e) => console.error(`SMB 資格情報の登録に失敗しました: ${(e as Error).message}`),
      );
    }
  }

  const legacy: { folder: string; kind: LibraryKind }[] = [
    ...config.media.imageFolders.map((f) => ({ folder: f, kind: 'image' as const })),
    ...config.media.videoFolders.map((f) => ({ folder: f, kind: 'video' as const })),
    ...config.media.pdfFolders.map((f) => ({ folder: f, kind: 'pdf' as const })),
    ...config.media.musicFolders.map((f) => ({ folder: f, kind: 'music' as const })),
  ];

  const created: { folder: string; libraryId: number; pathId: number }[] = [];
  for (const entry of legacy) {
    const absolute = isAbsoluteMediaPath(entry.folder);
    const provider: LibraryProvider = absolute ? 'local' : connId ? 'smb' : 'local';
    const name = uniqueName(db, pathBasename(entry.folder));
    const enabled = !absolute && !connId ? false : true;
    const lib = createLibrary(db, {
      name,
      tab: tabForKind(entry.kind),
      extensions: [],
      enabled,
      paths: [
        {
          provider,
          path: entry.folder,
          smbConnectionId: provider === 'smb' ? connId : null,
          enabled,
        },
      ],
    });
    db.prepare('UPDATE libraries SET is_default = 1 WHERE id = ?').run(lib.id);
    created.push({ folder: entry.folder, libraryId: lib.id, pathId: lib.paths[0].id });
  }

  // 既存アイテムを folder(旧フォルダ名)で紐付け
  const link = db.prepare(
    'UPDATE media_items SET library_id = ?, library_path_id = ? WHERE folder = ? AND library_id IS NULL',
  );
  const tx = db.transaction(() => {
    for (const c of created) link.run(c.libraryId, c.pathId, c.folder);
  });
  tx();

  db.prepare(
    "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('legacy_libraries_imported', '1')",
  ).run();
}

/**
 * 既存DB向け: 旧config.ini由来のライブラリを「既定」として保護する。
 * パスとタブ名の一致で判定するため、名称変更後も維持される。
 */
export function markLegacyDefaults(db: DB, config: AppConfig): void {
  const entries: { folder: string; kind: LibraryKind }[] = [
    ...config.media.imageFolders.map((f) => ({ folder: f, kind: 'image' as const })),
    ...config.media.videoFolders.map((f) => ({ folder: f, kind: 'video' as const })),
    ...config.media.pdfFolders.map((f) => ({ folder: f, kind: 'pdf' as const })),
    ...config.media.musicFolders.map((f) => ({ folder: f, kind: 'music' as const })),
  ];
  const stmt = db.prepare(`
    UPDATE libraries SET is_default = 1
    WHERE id = (
      SELECT lp.library_id FROM library_paths lp
      JOIN libraries l ON l.id = lp.library_id
      WHERE lp.path = ? COLLATE NOCASE AND l.tab_name = ? COLLATE NOCASE
      LIMIT 1
    )
  `);
  const standard = db.prepare(
    'UPDATE libraries SET is_default = 1 WHERE tab_name = ? COLLATE NOCASE AND kind = ?',
  );
  const tx = db.transaction(() => {
    for (const e of entries) stmt.run(e.folder, tabForKind(e.kind));
    // 標準タブ(画像/動画/PDF/音楽)は config の有無に関わらず既定として保護する
    for (const kind of ['image', 'video', 'pdf', 'music'] as LibraryKind[]) {
      standard.run(tabForKind(kind), kind);
    }
  });
  tx();
}
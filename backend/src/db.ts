import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface MediaItem {
  id: number;
  type: 'image' | 'video' | 'pdf' | 'music' | 'file';
  path: string;
  folder: string;
  file_name: string;
  ext: string;
  size: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  vcodec: string | null;
  acodec: string | null;
  mtime: number;
  thumb_status: 'pending' | 'inprogress' | 'ready' | 'failed';
  status: 'active' | 'missing';
  added_at: number;
  last_scanned: number;
  view_count: number;
  last_viewed_at: number | null;
  resume_position: number | null;
  library_id: number | null;
  library_path_id: number | null;
  tags?: string[];
}

export type LibraryKind = 'image' | 'video' | 'pdf' | 'music' | 'custom';
export type LibraryProvider = 'local' | 'smb';

export interface SmbConnectionRow {
  id: number;
  name: string;
  host: string;
  share: string;
  username: string;
  drive_letter: string | null;
  auto_mount: number;
  created_at: number;
}

export interface LibraryPathRow {
  id: number;
  library_id: number;
  provider: LibraryProvider;
  path: string;
  smb_connection_id: number | null;
  enabled: number;
  sort_order: number;
}

export interface LibraryRow {
  id: number;
  name: string;
  kind: LibraryKind;
  tab_name: string;
  extensions: string | null;
  is_default: number;
  enabled: number;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS media_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  type          TEXT    NOT NULL,
  path          TEXT    NOT NULL UNIQUE,
  folder        TEXT    NOT NULL,
  file_name     TEXT    NOT NULL,
  ext           TEXT    NOT NULL,
  size          INTEGER NOT NULL,
  width         INTEGER,
  height        INTEGER,
  duration      REAL,
  vcodec        TEXT,
  acodec        TEXT,
  mtime         INTEGER NOT NULL,
  thumb_status  TEXT    NOT NULL DEFAULT 'pending',
  status        TEXT    NOT NULL DEFAULT 'active',
  added_at      INTEGER NOT NULL,
  last_scanned  INTEGER NOT NULL,
  view_count    INTEGER NOT NULL DEFAULT 0,
  last_viewed_at INTEGER,
  resume_position REAL
);
CREATE INDEX IF NOT EXISTS idx_items_type   ON media_items (type, status, id);
CREATE INDEX IF NOT EXISTS idx_items_folder ON media_items (folder, type, id);
CREATE INDEX IF NOT EXISTS idx_items_mtime  ON media_items (mtime DESC, id);

CREATE TABLE IF NOT EXISTS transcode_cache (
  media_id  INTEGER PRIMARY KEY,
  status    TEXT NOT NULL DEFAULT 'none',
  progress  REAL NOT NULL DEFAULT 0,
  path      TEXT,
  size      INTEGER,
  mode      TEXT,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tags (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE TABLE IF NOT EXISTS media_tags (
  media_id INTEGER NOT NULL,
  tag_id   INTEGER NOT NULL,
  PRIMARY KEY (media_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_media_tags_tag ON media_tags (tag_id);

CREATE TABLE IF NOT EXISTS browsing_history (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id  INTEGER NOT NULL,
  viewed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_media ON browsing_history (media_id);
CREATE INDEX IF NOT EXISTS idx_history_time  ON browsing_history (viewed_at DESC);

CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS libraries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  kind       TEXT    NOT NULL,
  tab_name   TEXT    NOT NULL DEFAULT '',
  extensions TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  enabled    INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS library_paths (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id        INTEGER NOT NULL,
  provider          TEXT    NOT NULL DEFAULT 'local',
  path              TEXT    NOT NULL,
  smb_connection_id INTEGER,
  enabled           INTEGER NOT NULL DEFAULT 1,
  sort_order        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_library_paths_lib ON library_paths (library_id);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token      TEXT PRIMARY KEY,
  username   TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_exp ON auth_sessions (expires_at);
CREATE TABLE IF NOT EXISTS smb_connections (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  host         TEXT    NOT NULL,
  share        TEXT    NOT NULL,
  username     TEXT    NOT NULL,
  drive_letter TEXT,
  auto_mount   INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS media_fts USING fts5 (
  file_name,
  content='media_items',
  content_rowid='id',
  tokenize='unicode61'
);
CREATE TRIGGER IF NOT EXISTS items_fts_ai AFTER INSERT ON media_items BEGIN
  INSERT INTO media_fts (rowid, file_name) VALUES (new.id, new.file_name);
END;
CREATE TRIGGER IF NOT EXISTS items_fts_au AFTER UPDATE ON media_items BEGIN
  INSERT INTO media_fts (media_fts, rowid, file_name) VALUES ('delete', old.id, old.file_name);
  INSERT INTO media_fts (rowid, file_name) VALUES (new.id, new.file_name);
END;
CREATE TRIGGER IF NOT EXISTS items_fts_ad AFTER DELETE ON media_items BEGIN
  INSERT INTO media_fts (media_fts, rowid, file_name) VALUES ('delete', old.id, old.file_name);
END;
`;

function migrate(db: DB): void {
  const cols = (
    db.prepare('PRAGMA table_info(media_items)').all() as { name: string }[]
  ).map((c) => c.name.toLowerCase());
  if (!cols.includes('vcodec')) {
    db.exec('ALTER TABLE media_items ADD COLUMN vcodec TEXT');
  }
  if (!cols.includes('acodec')) {
    db.exec('ALTER TABLE media_items ADD COLUMN acodec TEXT');
  }
  if (!cols.includes('view_count')) {
    db.exec('ALTER TABLE media_items ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.includes('last_viewed_at')) {
    db.exec('ALTER TABLE media_items ADD COLUMN last_viewed_at INTEGER');
  }
  if (!cols.includes('resume_position')) {
    db.exec('ALTER TABLE media_items ADD COLUMN resume_position REAL');
  }
  if (!cols.includes('library_id')) {
    db.exec('ALTER TABLE media_items ADD COLUMN library_id INTEGER');
  }
  if (!cols.includes('library_path_id')) {
    db.exec('ALTER TABLE media_items ADD COLUMN library_path_id INTEGER');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_items_library ON media_items (library_id, type, status, id)');
  // 旧既定名からの移行
  db.exec("UPDATE app_meta SET value = 'Kurarium' WHERE key = 'app_name' AND value = 'Media Viewer'");
  const libCols = (
    db.prepare('PRAGMA table_info(libraries)').all() as { name: string }[]
  ).map((c) => c.name.toLowerCase());
  if (!libCols.includes('tab_name')) {
    db.exec("ALTER TABLE libraries ADD COLUMN tab_name TEXT NOT NULL DEFAULT ''");
  }
  if (!libCols.includes('extensions')) {
    db.exec('ALTER TABLE libraries ADD COLUMN extensions TEXT');
  }
  if (!libCols.includes('is_default')) {
    db.exec('ALTER TABLE libraries ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0');
  }
  // 旧ライブラリのタブ名を種別ラベルで補完
  db.exec(`
    UPDATE libraries SET tab_name = CASE kind
      WHEN 'image' THEN '画像'
      WHEN 'video' THEN '動画'
      WHEN 'pdf'   THEN 'PDF'
      WHEN 'music' THEN '音楽'
      ELSE kind END
    WHERE tab_name = '' OR tab_name IS NULL
  `);
  const tcCols = (
    db.prepare('PRAGMA table_info(transcode_cache)').all() as { name: string }[]
  ).map((c) => c.name.toLowerCase());
  if (!tcCols.includes('mode')) {
    db.exec('ALTER TABLE transcode_cache ADD COLUMN mode TEXT');
  }
  // FTS5 外部コンテンツのインデックスは初回のみ rebuild で構築する
  // (COUNT(*) は content 表を読むため FTS インデックスの有無は判定できない点に注意)
  const ftsBuilt = (db
    .prepare("SELECT value FROM app_meta WHERE key = 'fts_built'")
    .get() as { value: string } | undefined);
  if (!ftsBuilt) {
    db.exec("INSERT INTO media_fts (media_fts) VALUES ('rebuild')");
    db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('fts_built', '1')").run();
  }
}

export function dataDir(): string {
  if (process.env.MEDIAVIEWER_DATA_DIR) return process.env.MEDIAVIEWER_DATA_DIR;
  const srcDir = dirname(fileURLToPath(import.meta.url));
  return join(srcDir, '..', '..', 'data');
}

export function openDb(dbPath?: string): DB {
  const path = dbPath ?? join(dataDir(), 'mediaviewer.db');
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

export function getMediaItem(db: DB, id: number): MediaItem | undefined {
  return db.prepare('SELECT * FROM media_items WHERE id = ?').get(id) as MediaItem | undefined;
}

export function thumbDir(): string {
  return join(dataDir(), 'thumbs');
}

export function transcodedDir(): string {
  return join(dataDir(), 'transcoded');
}

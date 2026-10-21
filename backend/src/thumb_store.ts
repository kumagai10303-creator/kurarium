import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dataDir } from './db.js';

export const THUMB_SPEC = 'h360-w1600-q76';
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export interface StoredThumb {
  data: Buffer;
  spec: string;
  updatedAt: number;
}

let store: Database.Database | null = null;
let stmts: {
  get: Database.Statement;
  has: Database.Statement;
  put: Database.Statement;
  list: Database.Statement;
  listSpec: Database.Statement;
  del: Database.Statement;
  touch: Database.Statement;
  stats: Database.Statement;
  expired: Database.Statement;
  oldest: Database.Statement;
  clear: Database.Statement;
} | null = null;

export function thumbDbPath(): string {
  return join(dataDir(), 'thumbs.db');
}

export function openThumbStore(): Database.Database {
  if (store) return store;
  const path = thumbDbPath();
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('auto_vacuum = INCREMENTAL');
  db.pragma('wal_autocheckpoint = 1000');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS thumbs (
      media_id   INTEGER PRIMARY KEY,
      spec       TEXT    NOT NULL,
      data       BLOB    NOT NULL,
      updated_at INTEGER NOT NULL,
      accessed_at INTEGER NOT NULL DEFAULT 0,
      byte_size   INTEGER
    ) WITHOUT ROWID;
  `);
  const cols = (db.prepare('PRAGMA table_info(thumbs)').all() as { name: string }[]).map(
    (c) => c.name.toLowerCase(),
  );
  if (!cols.includes('accessed_at')) {
    db.exec('ALTER TABLE thumbs ADD COLUMN accessed_at INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.includes('byte_size')) {
    db.exec('ALTER TABLE thumbs ADD COLUMN byte_size INTEGER');
  }
  db.exec(`
    UPDATE thumbs SET accessed_at = updated_at WHERE accessed_at = 0;
    UPDATE thumbs SET byte_size = LENGTH(data) WHERE byte_size IS NULL;
    CREATE INDEX IF NOT EXISTS idx_thumbs_accessed ON thumbs (accessed_at);
  `);
  store = db;
  stmts = {
    get: db.prepare(
      'SELECT data, spec, updated_at, accessed_at FROM thumbs WHERE media_id = ?',
    ),
    has: db.prepare('SELECT 1 AS ok FROM thumbs WHERE media_id = ?'),
    put: db.prepare(`
      INSERT INTO thumbs (media_id, spec, data, updated_at, accessed_at, byte_size)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(media_id) DO UPDATE SET
        spec = excluded.spec,
        data = excluded.data,
        updated_at = excluded.updated_at,
        accessed_at = excluded.accessed_at,
        byte_size = excluded.byte_size
    `),
    list: db.prepare('SELECT media_id FROM thumbs'),
    listSpec: db.prepare('SELECT media_id FROM thumbs WHERE spec = ?'),
    del: db.prepare('DELETE FROM thumbs WHERE media_id = ?'),
    touch: db.prepare('UPDATE thumbs SET accessed_at = ? WHERE media_id = ?'),
    stats: db.prepare(
      'SELECT COUNT(*) AS count, COALESCE(SUM(byte_size), 0) AS bytes FROM thumbs',
    ),
    expired: db.prepare('DELETE FROM thumbs WHERE accessed_at < ?'),
    oldest: db.prepare(`
      DELETE FROM thumbs WHERE media_id IN (
        SELECT media_id FROM thumbs ORDER BY accessed_at ASC, media_id ASC LIMIT ?
      )
    `),
    clear: db.prepare('DELETE FROM thumbs'),
  };
  return db;
}

export function closeThumbStore(): void {
  if (!store) return;
  try {
    store.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    // ignore
  }
  store.close();
  store = null;
  stmts = null;
}

export function getThumb(id: number): StoredThumb | null {
  openThumbStore();
  const row = stmts!.get.get(id) as
    | { data: Buffer; spec: string; updated_at: number; accessed_at: number }
    | undefined;
  if (!row) return null;
  const now = Date.now();
  if (now - row.accessed_at > TOUCH_INTERVAL_MS) {
    stmts!.touch.run(now, id);
  }
  return { data: Buffer.from(row.data), spec: row.spec, updatedAt: row.updated_at };
}

export function hasThumb(id: number): boolean {
  openThumbStore();
  return stmts!.has.get(id) !== undefined;
}

export function putThumb(id: number, data: Buffer, spec = THUMB_SPEC): void {
  openThumbStore();
  const now = Date.now();
  stmts!.put.run(id, spec, data, now, now, data.length);
}

export function listThumbIds(): number[] {
  openThumbStore();
  return (stmts!.list.all() as { media_id: number }[]).map((r) => r.media_id);
}

export function listThumbIdsBySpec(spec: string): number[] {
  openThumbStore();
  return (stmts!.listSpec.all(spec) as { media_id: number }[]).map((r) => r.media_id);
}

export function deleteThumbIds(ids: number[]): number {
  if (ids.length === 0) return 0;
  openThumbStore();
  let deleted = 0;
  store!.transaction((batch: number[]) => {
    for (const id of batch) deleted += stmts!.del.run(id).changes;
  })(ids);
  return deleted;
}

export function deleteExpiredThumbs(cutoff: number): number {
  openThumbStore();
  return stmts!.expired.run(cutoff).changes;
}

export function deleteOldestThumbs(limit: number): number {
  if (limit <= 0) return 0;
  openThumbStore();
  return stmts!.oldest.run(limit).changes;
}

export function clearThumbStore(): number {
  openThumbStore();
  return stmts!.clear.run().changes;
}

export function vacuumThumbStore(maxPages = 2000): void {
  const db = openThumbStore();
  try {
    db.pragma(`incremental_vacuum(${Math.max(1, maxPages)})`);
  } catch {
    // ignore
  }
}

export function thumbStoreStats(): { count: number; bytes: number } {
  openThumbStore();
  return stmts!.stats.get() as { count: number; bytes: number };
}

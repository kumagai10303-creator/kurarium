import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dataDir } from './db.js';

export const THUMB_SPEC = 'h360-w1600-q76';

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
      updated_at INTEGER NOT NULL
    ) WITHOUT ROWID;
  `);
  store = db;
  stmts = {
    get: db.prepare('SELECT data, spec, updated_at FROM thumbs WHERE media_id = ?'),
    has: db.prepare('SELECT 1 AS ok FROM thumbs WHERE media_id = ?'),
    put: db.prepare(
      `INSERT INTO thumbs (media_id, spec, data, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(media_id) DO UPDATE SET
         spec = excluded.spec,
         data = excluded.data,
         updated_at = excluded.updated_at`,
    ),
    list: db.prepare('SELECT media_id FROM thumbs'),
    listSpec: db.prepare('SELECT media_id FROM thumbs WHERE spec = ?'),
    del: db.prepare('DELETE FROM thumbs WHERE media_id = ?'),
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
    | { data: Buffer; spec: string; updated_at: number }
    | undefined;
  if (!row) return null;
  return { data: Buffer.from(row.data), spec: row.spec, updatedAt: row.updated_at };
}

export function hasThumb(id: number): boolean {
  openThumbStore();
  return stmts!.has.get(id) !== undefined;
}

export function putThumb(id: number, data: Buffer, spec = THUMB_SPEC): void {
  openThumbStore();
  stmts!.put.run(id, spec, data, Date.now());
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

export function vacuumThumbStore(maxPages = 2000): void {
  const db = openThumbStore();
  try {
    db.pragma(`incremental_vacuum(${Math.max(1, maxPages)})`);
  } catch {
    // ignore
  }
}

export function thumbStoreStats(): { count: number; bytes: number } {
  const db = openThumbStore();
  const row = db
    .prepare('SELECT COUNT(*) AS count, COALESCE(SUM(LENGTH(data)), 0) AS bytes FROM thumbs')
    .get() as { count: number; bytes: number };
  return row;
}

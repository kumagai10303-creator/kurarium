import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dbPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'mediaviewer.db');
const db = new Database(dbPath);
const rows = db
  .prepare(
    "SELECT id, ext, size, file_name FROM media_items WHERE type='video' AND ext IN ('.flv','.wmv','.3gp') AND status='active' ORDER BY size LIMIT 5",
  )
  .all();
console.log(JSON.stringify(rows, null, 1));
db.close();

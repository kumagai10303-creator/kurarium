import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dbPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'mediaviewer.db');
const db = new Database(dbPath);
const rows = db
  .prepare("SELECT id, path, thumb_status FROM media_items WHERE thumb_status='failed' ORDER BY id LIMIT 20")
  .all();
console.log(JSON.stringify(rows, null, 1));
const counts = db.prepare('SELECT thumb_status, COUNT(*) AS c FROM media_items GROUP BY thumb_status').all();
console.log(counts);
db.close();

import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dbPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'mediaviewer.db');
const db = new Database(dbPath);
console.log('--- vcodec 分布 ---');
console.log(JSON.stringify(db.prepare("SELECT COALESCE(vcodec,'(null)') AS codec, COUNT(*) c FROM media_items WHERE type='video' AND thumb_status='ready' GROUP BY vcodec").all()));
db.close();

import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dbPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'mediaviewer.db');
const db = new Database(dbPath);

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic', '.avif'];
const VIDEO_EXTS = [
  '.mp4', '.m4v', '.mkv', '.avi', '.mov', '.wmv', '.webm',
  '.mpg', '.mpeg', '.flv', '.3gp', '.ogv', '.ts', '.m2ts',
];

const tx = db.transaction(() => {
  for (const e of VIDEO_EXTS) {
    db.prepare(
      "UPDATE media_items SET type='video', thumb_status='pending' WHERE ext = ? AND type != 'video'",
    ).run(e);
  }
  for (const e of IMAGE_EXTS) {
    db.prepare(
      "UPDATE media_items SET type='image', thumb_status='pending' WHERE ext = ? AND type != 'image' AND thumb_status != 'ready'",
    ).run(e);
  }
});
tx();

const counts = db.prepare(
  "SELECT type, thumb_status, COUNT(*) AS c FROM media_items WHERE status='active' GROUP BY type, thumb_status",
).all();
console.log(counts);

// failed も一度 pending に戻す(limitInputPixels=false 適用済みの再試行)
db.prepare("UPDATE media_items SET thumb_status='pending' WHERE thumb_status='failed' AND status='active'").run();
console.log('failed → pending にリセット済み');
db.close();

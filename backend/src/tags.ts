import type { DB, MediaItem } from './db.js';

export interface Tag {
  id: number;
  name: string;
  count: number;
}

export function ensureTag(db: DB, name: string): { id: number; name: string } | null {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 100) return null;
  const existing = db.prepare('SELECT id, name FROM tags WHERE name = ? COLLATE NOCASE').get(trimmed) as
    | { id: number; name: string }
    | undefined;
  if (existing) return existing;
  db.prepare('INSERT INTO tags (name) VALUES (?)').run(trimmed);
  return db.prepare('SELECT id, name FROM tags WHERE name = ? COLLATE NOCASE').get(trimmed) as {
    id: number;
    name: string;
  };
}

export function getItemTags(db: DB, mediaId: number): string[] {
  return db
    .prepare(
      'SELECT t.name FROM media_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.media_id = ? ORDER BY t.name',
    )
    .all(mediaId)
    .map((r) => (r as { name: string }).name);
}

export function attachTagsToRows(db: DB, rows: unknown[]): void {
  if (rows.length === 0) return;
  const ids = (rows as { id: number }[]).map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const list = db
    .prepare(
      `SELECT mt.media_id, t.name FROM media_tags mt JOIN tags t ON t.id = mt.tag_id
       WHERE mt.media_id IN (${placeholders})`,
    )
    .all(...ids) as { media_id: number; name: string }[];
  const map = new Map<number, string[]>();
  for (const row of list) {
    const arr = map.get(row.media_id) ?? [];
    arr.push(row.name);
    map.set(row.media_id, arr);
  }
  for (const r of rows as { id: number; tags?: string[] }[]) {
    r.tags = map.get(r.id) ?? [];
  }
}

export function addItemTag(db: DB, mediaId: number, tagName: string): string[] | null {
  const item = db.prepare('SELECT id FROM media_items WHERE id = ?').get(mediaId);
  if (!item) return null;
  const tag = ensureTag(db, tagName);
  if (!tag) return null;
  db.prepare('INSERT OR IGNORE INTO media_tags (media_id, tag_id) VALUES (?, ?)').run(mediaId, tag.id);
  return getItemTags(db, mediaId);
}

export function removeItemTag(db: DB, mediaId: number, tagName: string): string[] | null {
  const row = db
    .prepare('SELECT t.id FROM tags t WHERE t.name = ? COLLATE NOCASE')
    .get(tagName) as { id: number } | undefined;
  if (!row) return getItemTags(db, mediaId);
  db.prepare('DELETE FROM media_tags WHERE media_id = ? AND tag_id = ?').run(mediaId, row.id);
  return getItemTags(db, mediaId);
}

export function listTags(db: DB, limit = 500): Tag[] {
  return db
    .prepare(
      `SELECT t.id, t.name, COUNT(mt.media_id) AS count
       FROM tags t
       LEFT JOIN media_tags mt ON mt.tag_id = t.id
         JOIN media_items mi ON mi.id = mt.media_id AND mi.status = 'active'
       GROUP BY t.id
       ORDER BY count DESC, t.name
       LIMIT ?`,
    )
    .all(limit) as Tag[];
}

export function deleteTag(db: DB, tagId: number): boolean {
  const tag = db.prepare('SELECT id FROM tags WHERE id = ?').get(tagId);
  if (!tag) return false;
  db.prepare('DELETE FROM media_tags WHERE tag_id = ?').run(tagId);
  db.prepare('DELETE FROM tags WHERE id = ?').run(tagId);
  return true;
}

/** 記録: 10分以内の連続視聴は1回にまとめる */
export const HISTORY_DEDUP_MS = 10 * 60 * 1000;

export function recordView(db: DB, mediaId: number, now: number): void {
  const latest = db
    .prepare(
      'SELECT viewed_at FROM browsing_history WHERE media_id = ? ORDER BY viewed_at DESC LIMIT 1',
    )
    .get(mediaId) as { viewed_at: number } | undefined;
  if (latest && now - latest.viewed_at < HISTORY_DEDUP_MS) {
    db.prepare(
      'UPDATE browsing_history SET viewed_at = ? WHERE media_id = ? AND viewed_at = ?',
    ).run(now, mediaId, latest.viewed_at);
  } else {
    db.prepare('INSERT INTO browsing_history (media_id, viewed_at) VALUES (?, ?)').run(mediaId, now);
  }
  db.prepare(`UPDATE media_items SET view_count = view_count + 1, last_viewed_at = ? WHERE id = ?`).run(
    now,
    mediaId,
  );
}

export function saveResumePosition(db: DB, mediaId: number, position: number): void {
  const item = db.prepare('SELECT duration FROM media_items WHERE id = ?').get(mediaId) as
    | { duration: number | null }
    | undefined;
  if (!item) return;
  // ほぼ最後まで見た場合は位置をリセット(再視聴時は最初から)
  const nearEnd =
    item.duration !== null &&
    item.duration > 0 &&
    position >= item.duration - Math.min(15, item.duration * 0.05);
  const pos = nearEnd ? 0 : position;
  db.prepare('UPDATE media_items SET resume_position = ? WHERE id = ?').run(pos, mediaId);
}

export interface HistoryItem extends MediaItem {
  recent_view: number;
}

export function recentHistory(db: DB, limit: number, offset = 0): HistoryItem[] {
  return db
    .prepare(
      `SELECT m.*, (SELECT viewed_at FROM browsing_history h WHERE h.media_id = m.id
                    ORDER BY viewed_at DESC LIMIT 1) AS recent_view
       FROM media_items m
       WHERE m.last_viewed_at IS NOT NULL
       ORDER BY m.last_viewed_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as HistoryItem[];
}

export interface TagRule {
  match: string;
  tag: string;
}

export function applyTagRules(db: DB, rules: TagRule[]): { applied: number } {
  if (rules.length === 0) return { applied: 0 };
  let applied = 0;
  for (const rule of rules) {
    if (!rule.match || !rule.tag) continue;
    const ensure = ensureTag(db, rule.tag);
    if (!ensure) continue;
    const targets = db
      .prepare(
        "SELECT id FROM media_items WHERE status='active' AND (file_name LIKE ? OR folder LIKE ?)",
      )
      .all(
        `%${rule.match.replace(/[%_]/g, '\\$&')}%`,
        `%${rule.match.replace(/[%_]/g, '\\$&')}%`,
      ) as { id: number }[];
    const tx = db.transaction((items: { id: number }[]) => {
      for (const it of items) {
        const res = db
          .prepare('INSERT OR IGNORE INTO media_tags (media_id, tag_id) VALUES (?, ?)')
          .run(it.id, ensure.id);
        applied += res.changes;
      }
    });
    tx.call(db, targets);
  }
  return { applied };
}
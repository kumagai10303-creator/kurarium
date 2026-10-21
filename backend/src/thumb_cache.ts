import type { DB } from './db.js';
import {
  deleteExpiredThumbs,
  deleteOldestThumbs,
  thumbStoreStats,
  vacuumThumbStore,
} from './thumb_store.js';

export const THUMB_CACHE_MAX_KEY = 'thumb_cache_max_bytes';
export const THUMB_CACHE_TTL_KEY = 'thumb_cache_ttl_days';
export const DEFAULT_THUMB_CACHE_MAX_BYTES = 512 * 1024 * 1024;
export const DEFAULT_THUMB_CACHE_TTL_DAYS = 0;

export interface ThumbCacheSettings {
  maxBytes: number;
  ttlDays: number;
}

export interface ThumbCacheInfo extends ThumbCacheSettings {
  count: number;
  bytes: number;
}

export interface ThumbCacheCleanupResult extends ThumbCacheInfo {
  removed: number;
}

function readMeta(db: DB, key: string): string | undefined {
  return (
    db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined
  )?.value;
}

function writeMeta(db: DB, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)').run(key, value);
}

export function getThumbCacheSettings(db: DB): ThumbCacheSettings {
  const maxBytes = Number(readMeta(db, THUMB_CACHE_MAX_KEY));
  const ttlDays = Number(readMeta(db, THUMB_CACHE_TTL_KEY));
  return {
    maxBytes:
      Number.isFinite(maxBytes) && maxBytes >= 128 * 1024 * 1024
        ? Math.floor(maxBytes)
        : DEFAULT_THUMB_CACHE_MAX_BYTES,
    ttlDays:
      Number.isFinite(ttlDays) && ttlDays >= 0
        ? Math.floor(ttlDays)
        : DEFAULT_THUMB_CACHE_TTL_DAYS,
  };
}

export function setThumbCacheSettings(
  db: DB,
  patch: { maxBytes?: number; ttlDays?: number },
): ThumbCacheSettings {
  if (patch.maxBytes !== undefined) {
    writeMeta(db, THUMB_CACHE_MAX_KEY, String(Math.floor(patch.maxBytes)));
  }
  if (patch.ttlDays !== undefined) {
    writeMeta(db, THUMB_CACHE_TTL_KEY, String(Math.floor(patch.ttlDays)));
  }
  return getThumbCacheSettings(db);
}

export function getThumbCacheInfo(db: DB): ThumbCacheInfo {
  const settings = getThumbCacheSettings(db);
  const stats = thumbStoreStats();
  return { ...settings, ...stats };
}

export function enforceThumbCacheLimit(
  db: DB,
  settings: ThumbCacheSettings = getThumbCacheSettings(db),
): ThumbCacheCleanupResult {
  let removed = 0;
  if (settings.ttlDays > 0) {
    const cutoff = Date.now() - settings.ttlDays * 24 * 60 * 60 * 1000;
    removed += deleteExpiredThumbs(cutoff);
  }

  let stats = thumbStoreStats();
  if (stats.bytes > settings.maxBytes) {
    const average = stats.count > 0 ? stats.bytes / stats.count : 1;
    const needed = Math.ceil((stats.bytes - settings.maxBytes) / Math.max(1, average));
    removed += deleteOldestThumbs(needed + 16);
    stats = thumbStoreStats();
  }
  while (stats.bytes > settings.maxBytes && stats.count > 0) {
    const deleted = deleteOldestThumbs(256);
    if (deleted === 0) break;
    removed += deleted;
    stats = thumbStoreStats();
  }

  if (removed > 0) vacuumThumbStore(20000);
  return { ...settings, ...stats, removed };
}

let cleanupTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleThumbCacheCleanup(
  db: DB,
  delayMs = 2000,
): void {
  if (cleanupTimer) return;
  cleanupTimer = setTimeout(() => {
    cleanupTimer = null;
    try {
      enforceThumbCacheLimit(db);
    } catch (e) {
      console.error(`サムネイルキャッシュ整理エラー: ${(e as Error).message}`);
    }
  }, delayMs);
  cleanupTimer.unref?.();
}

export function cancelThumbCacheCleanup(): void {
  if (!cleanupTimer) return;
  clearTimeout(cleanupTimer);
  cleanupTimer = null;
}

export function startThumbCacheMaintenance(db: DB): () => void {
  const timer = setInterval(() => {
    try {
      enforceThumbCacheLimit(db);
    } catch (e) {
      console.error(`サムネイルキャッシュ定期整理エラー: ${(e as Error).message}`);
    }
  }, 30 * 60 * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}

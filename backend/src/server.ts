import type { FastifyInstance } from 'fastify';
import { loadConfig, migrateLegacyConfigFile, type AppConfig } from './config.js';
import { openDb, type DB } from './db.js';
import {
  cleanupOrphanThumbs,
  ensureThumbDir,
  prepareThumbnails,
  startThumbQueue,
  startVideoMetaBackfill,
  stopThumbQueue,
} from './thumbnails.js';
import { scanAll, scanStatus } from './scanner.js';
import { cleanupObsoleteEncodes, recoverTranscodes } from './transcode.js';
import { buildApp, invalidateFoldersCache } from './routes.js';
import { importLegacyConfig, listConnections, markLegacyDefaults } from './libraries.js';
import { ensureMounted } from './mount.js';
import { authEnabled, isLoopbackHost } from './auth.js';
import { killToolProcesses } from './tools.js';
import { closeThumbStore, openThumbStore } from './thumb_store.js';

export interface ServerOptions {
  port?: number;
  host?: string;
}

export interface ServerHandle {
  app: FastifyInstance;
  db: DB;
  config: AppConfig;
  host: string;
  port: number;
  url: string;
  stop: () => Promise<void>;
}

function listenPortFromAddress(address: string): number {
  try {
    return Number(new URL(address).port);
  } catch {
    return 0;
  }
}

export async function startServer(options: ServerOptions = {}): Promise<ServerHandle> {
  const config = loadConfig();
  const db = openDb();
  openThumbStore();
  await ensureThumbDir();
  prepareThumbnails(db);
  recoverTranscodes(db);
  cleanupObsoleteEncodes(db);

  await importLegacyConfig(db, config);
  markLegacyDefaults(db, config);
  migrateLegacyConfigFile(config.server);
  startVideoMetaBackfill(db);

  for (const conn of listConnections(db)) {
    if (!conn.auto_mount) continue;
    try {
      const base = await ensureMounted({
        host: conn.host,
        share: conn.share,
        username: conn.username,
        driveLetter: conn.drive_letter,
      });
      console.log(`SMB 接続確認: ${base} (${conn.name})`);
    } catch (e) {
      console.error(`SMB 接続に失敗しました (${conn.name}): ${(e as Error).message}`);
    }
  }

  const app = await buildApp({ config, db });

  let host = options.host ?? config.server.host ?? '127.0.0.1';
  if (
    !isLoopbackHost(host) &&
    (!config.server.basicAuthUser || !config.server.basicAuthPasswordHash)
  ) {
    console.warn('LAN公開にはログイン用のユーザー名とパスワード設定が必要です。127.0.0.1 で起動します。');
    host = '127.0.0.1';
    config.server.host = host;
  }

  const requestedPort = options.port ?? config.server.port;
  let address: string;
  try {
    address = await app.listen({ port: requestedPort, host });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EADDRINUSE' && isLoopbackHost(host) && options.port === undefined) {
      console.warn(`ポート ${requestedPort} は使用中のため、空きポートで起動します。`);
      address = await app.listen({ port: 0, host });
    } else {
      await app.close().catch(() => undefined);
      db.close();
      throw e;
    }
  }

  const port = listenPortFromAddress(address);
  console.log(
    `サーバー起動: ${address}${authEnabled(config.server) ? ' (ログイン認証有効)' : ''}`,
  );

  const libCount = (
    db.prepare('SELECT COUNT(*) AS c FROM libraries WHERE enabled = 1').get() as { c: number }
  ).c;
  const itemCount = (
    db.prepare("SELECT COUNT(*) AS c FROM media_items WHERE status = 'active'").get() as { c: number }
  ).c;
  const scanOnStartup =
    (
      db.prepare("SELECT value FROM app_meta WHERE key = 'scan_on_startup'").get() as
        | { value: string }
        | undefined
    )?.value !== '0';

  if (!scanStatus().running && libCount > 0 && scanOnStartup) {
    const mode = itemCount === 0 ? 'full' : 'diff';
    console.log(`起動時${mode === 'full' ? '全' : '差分'}スキャンを実行します...`);
    startThumbQueue(db);
    void scanAll(db, config, mode).then((summary) => {
      if (summary.error) {
        console.error(`スキャンエラー: ${summary.error}`);
        return;
      }
      for (const r of summary.results) {
        console.log(
          `スキャン完了(${r.mode === 'full' ? '全' : '差分'}): ${r.folder} (${r.media}) ${r.total}件 ` +
            `新規${r.inserted} / 更新${r.updated} / 削除${r.removed} / ${r.durationMs}ms`,
        );
      }
      invalidateFoldersCache();
      void cleanupOrphanThumbs(db);
      startThumbQueue(db);
    });
  } else {
    startThumbQueue(db);
  }

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    stopThumbQueue();
    await killToolProcesses();
    await app.close().catch((e: Error) => console.error(`サーバー停止エラー: ${e.message}`));
    try {
      db.close();
    } catch {
      // already closed
    }
    closeThumbStore();
  };

  return { app, db, config, host, port, url: address, stop };
}

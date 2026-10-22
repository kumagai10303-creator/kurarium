import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { loadConfig, type AppConfig } from './config.js';
import { openDb, type DB } from './db.js';
import { hashPassword } from './password.js';
import { buildApp } from './routes.js';

let root: string;
let db: DB;
let config: AppConfig;
let app: FastifyInstance;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'kurarium-settings-'));
  process.env.MEDIAVIEWER_DATA_DIR = join(root, 'data');
  config = loadConfig(join(root, 'missing.ini'));
  config.server.host = '127.0.0.1';
  config.server.basicAuthUser = 'user';
  config.server.basicAuthPasswordHash = hashPassword('secret');
  db = openDb(join(root, 'test.db'));
  app = await buildApp({ config, db });
});

afterEach(async () => {
  await app.close();
  db.close();
  delete process.env.MEDIAVIEWER_DATA_DIR;
  rmSync(root, { recursive: true, force: true });
});

describe('server settings', () => {
  it('LAN password must be at least 5 characters', async () => {
    const tooShort = await app.inject({
      method: 'PUT',
      url: '/api/server-settings',
      payload: {
        host: '0.0.0.0',
        port: 3000,
        basicAuthUser: 'user',
        basicAuthPassword: '1234',
      },
    });
    expect(tooShort.statusCode).toBe(400);
    expect(tooShort.json().error).toContain('5文字以上');

    const ok = await app.inject({
      method: 'PUT',
      url: '/api/server-settings',
      payload: {
        host: '0.0.0.0',
        port: 3000,
        basicAuthUser: 'user',
        basicAuthPassword: '12345',
      },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().lanEnabled).toBe(true);
  });

  it('credential changes invalidate existing sessions', async () => {
    db.prepare(
      'INSERT INTO auth_sessions (token, username, created_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run('session-token', 'user', Date.now(), Date.now() + 60_000);

    const ok = await app.inject({
      method: 'PUT',
      url: '/api/server-settings',
      payload: {
        host: '127.0.0.1',
        port: 3000,
        basicAuthUser: 'user',
        basicAuthPassword: '12345',
      },
    });
    expect(ok.statusCode).toBe(200);
    expect(
      db.prepare('SELECT COUNT(*) AS c FROM auth_sessions').get() as { c: number },
    ).toEqual({ c: 0 });
  });

  it('reports that no TLS certificate exists before LAN startup', async () => {
    const response = await app.inject('/api/server-settings');
    expect(response.statusCode).toBe(200);
    expect(response.json().tls).toBeNull();
  });
});

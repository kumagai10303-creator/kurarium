import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { registerAuth, isLoopbackHost } from './auth.js';
import type { ServerConfig } from './config.js';
import { openDb, type DB } from './db.js';
import { hashPassword } from './password.js';

const serverConfig = (patch: Partial<ServerConfig> = {}): ServerConfig => ({
  port: 3000,
  host: '0.0.0.0',
  basicAuthUser: 'user',
  basicAuthPasswordHash: hashPassword('pass'),
  ...patch,
});

function makeDb(): { db: DB; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'kurarium-auth-'));
  return { db: openDb(join(dir, 'test.db')), dir };
}

describe('auth', () => {
  it('ループバック判定', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('192.0.2.10')).toBe(false);
  });

  it('LAN公開時はログイン必須でセッションCookieで解除される', async () => {
    const { db, dir } = makeDb();
    try {
      const app = Fastify();
      registerAuth(app, serverConfig(), db);
      app.get('/api/test', async () => ({ ok: true }));

      const unauth = await app.inject('/api/test');
      expect(unauth.statusCode).toBe(401);

      const status = await app.inject('/api/auth/status');
      expect(status.json()).toEqual({ required: true, authenticated: false });

      const wrong = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'user', password: 'wrong' },
      });
      expect(wrong.statusCode).toBe(401);

      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'user', password: 'pass' },
      });
      expect(login.statusCode).toBe(200);
      const setCookie = login.headers['set-cookie'];
      const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : (setCookie ?? '');
      const cookie = cookieHeader.split(';')[0];
      expect(cookie).toContain('kurarium_session=');

      const ok = await app.inject({ url: '/api/test', headers: { cookie } });
      expect(ok.statusCode).toBe(200);

      const afterLogin = await app.inject({ url: '/api/auth/status', headers: { cookie } });
      expect(afterLogin.json()).toEqual({ required: true, authenticated: true });

      const logout = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { cookie },
      });
      expect(logout.statusCode).toBe(200);

      const afterLogout = await app.inject({ url: '/api/test', headers: { cookie } });
      expect(afterLogout.statusCode).toBe(401);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ループバックではログイン不要', async () => {
    const { db, dir } = makeDb();
    try {
      const app = Fastify();
      registerAuth(app, serverConfig({ host: '127.0.0.1' }), db);
      app.get('/api/test', async () => ({ ok: true }));
      expect((await app.inject('/api/test')).statusCode).toBe(200);
      expect((await app.inject('/api/auth/status')).json()).toEqual({
        required: false,
        authenticated: true,
      });
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

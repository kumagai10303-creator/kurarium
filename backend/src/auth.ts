import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ServerConfig } from './config.js';
import type { DB } from './db.js';
import { verifyPassword } from './password.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const SESSION_COOKIE = 'kurarium_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}

/** 非ループバックで待ち受ける場合のみログインを要求する */
export function authEnabled(server: ServerConfig): boolean {
  return (
    !isLoopbackHost(server.host) &&
    server.basicAuthUser.length > 0 &&
    server.basicAuthPasswordHash.length > 0
  );
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

function isValidSession(db: DB, token: string | null): boolean {
  if (!token) return false;
  const row = db
    .prepare('SELECT expires_at FROM auth_sessions WHERE token = ?')
    .get(token) as { expires_at: number } | undefined;
  return row !== undefined && row.expires_at > Date.now();
}

function createSession(db: DB, username: string): string {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare(
    'INSERT INTO auth_sessions (token, username, created_at, expires_at) VALUES (?, ?, ?, ?)',
  ).run(token, username, now, now + SESSION_TTL_MS);
  db.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').run(now);
  return token;
}

const sessionCookie = (token: string): string =>
  `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(
    SESSION_TTL_MS / 1000,
  )}`;

const clearCookie = (): string =>
  `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;

export function registerAuth(app: FastifyInstance, server: ServerConfig, db: DB): void {
  const required = authEnabled(server);

  app.get('/api/auth/status', async (req) => {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    return {
      required,
      authenticated: !required || isValidSession(db, token),
    };
  });

  app.post('/api/auth/login', async (req, rep) => {
    if (!required) {
      return { ok: true, required: false };
    }
    const body = (req.body ?? {}) as { username?: string; password?: string };
    const username = (body.username ?? '').trim();
    const password = body.password ?? '';
    const ok =
      username === server.basicAuthUser &&
      verifyPassword(password, server.basicAuthPasswordHash);
    if (!ok) {
      // 総当たりを緩和するため少し待たせる
      await new Promise((resolve) => setTimeout(resolve, 300));
      return rep.code(401).send({ error: 'ユーザー名またはパスワードが違います' });
    }
    const token = createSession(db, username);
    rep.header('set-cookie', sessionCookie(token));
    return { ok: true, required: true };
  });

  app.post('/api/auth/logout', async (req, rep) => {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (token) {
      db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
    }
    rep.header('set-cookie', clearCookie());
    return { ok: true };
  });

  if (!required) return;

  app.addHook('onRequest', async (req, rep) => {
    if (!req.url.startsWith('/api/')) return;
    if (req.url.startsWith('/api/auth/')) return;
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (isValidSession(db, token)) return;
    rep.code(401).send({ error: 'unauthorized' });
  });
}

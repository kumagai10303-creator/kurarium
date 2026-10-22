import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ServerConfig } from './config.js';
import type { DB } from './db.js';
import { verifyPassword } from './password.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
export const SESSION_COOKIE = 'kurarium_session';
export const MIN_PASSWORD_LENGTH = 5;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_MAX_TRACKED_IPS = 10_000;

interface LoginFailures {
  count: number;
  firstAt: number;
  blockedUntil: number;
}

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
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

function isValidSession(db: DB, token: string | null, username: string): boolean {
  if (!token) return false;
  const row = db
    .prepare('SELECT username, expires_at FROM auth_sessions WHERE token = ?')
    .get(token) as { username: string; expires_at: number } | undefined;
  return row !== undefined && row.username === username && row.expires_at > Date.now();
}

export function invalidateAllSessions(db: DB): void {
  db.prepare('DELETE FROM auth_sessions').run();
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
  `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(
    SESSION_TTL_MS / 1000,
  )}`;

const clearCookie = (): string =>
  `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export function registerAuth(app: FastifyInstance, server: ServerConfig, db: DB): void {
  const required = authEnabled(server);
  const loginFailures = new Map<string, LoginFailures>();

  const pruneLoginFailures = (now: number): void => {
    for (const [ip, entry] of loginFailures) {
      if (entry.blockedUntil <= now && now - entry.firstAt > LOGIN_WINDOW_MS) {
        loginFailures.delete(ip);
      }
    }
    while (loginFailures.size > LOGIN_MAX_TRACKED_IPS) {
      const oldest = loginFailures.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      loginFailures.delete(oldest);
    }
  };

  app.get('/api/auth/status', async (req, rep) => {
    rep.header('cache-control', 'no-store');
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    return {
      required,
      authenticated: !required || isValidSession(db, token, server.basicAuthUser),
    };
  });

  app.post('/api/auth/login', async (req, rep) => {
    rep.header('cache-control', 'no-store');
    if (!required) {
      return { ok: true, required: false };
    }
    const now = Date.now();
    pruneLoginFailures(now);
    const key = req.ip;
    const current = loginFailures.get(key);
    if (current && current.blockedUntil > now) {
      const retryAfter = Math.max(1, Math.ceil((current.blockedUntil - now) / 1000));
      rep.header('retry-after', String(retryAfter));
      return rep.code(429).send({
        error: 'ログイン試行回数が多すぎます。しばらく待ってから再試行してください',
      });
    }

    const body = (req.body ?? {}) as { username?: string; password?: string };
    const username = (body.username ?? '').trim();
    const password = body.password ?? '';
    const ok =
      username === server.basicAuthUser &&
      verifyPassword(password, server.basicAuthPasswordHash);
    if (!ok) {
      const withinWindow = current && now - current.firstAt <= LOGIN_WINDOW_MS;
      const count = (withinWindow ? current.count : 0) + 1;
      const firstAt = withinWindow ? current.firstAt : now;
      const blockedUntil = count >= LOGIN_MAX_FAILURES ? now + LOGIN_WINDOW_MS : 0;
      loginFailures.set(key, { count, firstAt, blockedUntil });
      // 総当たりを避けるため失敗時も待つ
      await new Promise((resolve) => setTimeout(resolve, 300));
      return rep.code(401).send({ error: 'ユーザー名またはパスワードが違います' });
    }
    loginFailures.delete(key);
    const token = createSession(db, username);
    rep.header('set-cookie', sessionCookie(token));
    return { ok: true, required: true };
  });

  app.post('/api/auth/logout', async (req, rep) => {
    rep.header('cache-control', 'no-store');
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
    // 公開証明書はクライアントが信頼設定に使うため認証不要
    if (req.url.split('?')[0] === '/api/tls/certificate') return;
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (isValidSession(db, token, server.basicAuthUser)) return;
    rep.code(401).send({ error: 'unauthorized' });
  });
}

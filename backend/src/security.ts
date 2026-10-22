import type { FastifyInstance } from 'fastify';
import { networkInterfaces, hostname } from 'node:os';
import type { ServerConfig } from './config.js';
import { isLoopbackHost } from './auth.js';

const CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
].join('; ');

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/^\[|\]$/g, '');
}

function hostnameFromHostHeader(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return normalizeHostname(new URL(`http://${value}`).hostname);
  } catch {
    return null;
  }
}

function allowedHostnames(server: ServerConfig): Set<string> {
  const allowed = new Set(['localhost', '127.0.0.1', '::1']);
  if (isLoopbackHost(server.host)) return allowed;

  const machineName = hostname().trim();
  if (machineName) allowed.add(normalizeHostname(machineName));

  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (!address.internal) allowed.add(normalizeHostname(address.address));
    }
  }

  if (server.host && server.host !== '0.0.0.0' && server.host !== '::') {
    allowed.add(normalizeHostname(server.host));
  }
  return allowed;
}

function originAllowed(origin: string | undefined, server: ServerConfig, hosts: Set<string>): boolean {
  if (!origin) return true;
  if (origin === 'null') return false;
  try {
    const parsed = new URL(origin);
    if (!hosts.has(normalizeHostname(parsed.hostname))) return false;
    if (!isLoopbackHost(server.host)) return parsed.protocol === 'https:';
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function registerSecurity(app: FastifyInstance, server: ServerConfig): void {
  const hosts = allowedHostnames(server);

  app.addHook('onRequest', async (req, rep) => {
    const requestHost = hostnameFromHostHeader(req.headers.host);
    if (!requestHost || !hosts.has(requestHost)) {
      return rep.code(403).send({ error: 'invalid_host' });
    }

    if (!originAllowed(req.headers.origin, server, hosts)) {
      return rep.code(403).send({ error: 'invalid_origin' });
    }
    if (
      req.url.startsWith('/api/') &&
      req.headers['sec-fetch-site'] === 'cross-site'
    ) {
      return rep.code(403).send({ error: 'cross_site_request' });
    }
  });

  app.addHook('onSend', async (_req, rep, payload) => {
    rep.header('x-content-type-options', 'nosniff');
    rep.header('referrer-policy', 'no-referrer');
    rep.header('x-frame-options', 'DENY');
    rep.header('content-security-policy', CSP);
    rep.header('cross-origin-opener-policy', 'same-origin');
    rep.header('cross-origin-resource-policy', 'same-origin');
    rep.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    return payload;
  });
}

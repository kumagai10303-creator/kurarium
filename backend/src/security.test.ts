import { describe, expect, it } from 'vitest';
import { hostname } from 'node:os';
import Fastify from 'fastify';
import { registerSecurity } from './security.js';
import type { ServerConfig } from './config.js';

const config = (patch: Partial<ServerConfig> = {}): ServerConfig => ({
  port: 3000,
  host: '127.0.0.1',
  basicAuthUser: '',
  basicAuthPasswordHash: '',
  ...patch,
});

function makeApp(server = config()) {
  const app = Fastify();
  registerSecurity(app, server);
  app.get('/api/test', async () => ({ ok: true }));
  return app;
}

describe('request security', () => {
  it('許可されていないHostを拒否する', async () => {
    const app = makeApp();
    try {
      const response = await app.inject({
        url: '/api/test',
        headers: { host: 'evil.example:3000' },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'invalid_host' });
    } finally {
      await app.close();
    }
  });

  it('クロスサイトOriginを拒否する', async () => {
    const app = makeApp();
    try {
      const response = await app.inject({
        url: '/api/test',
        headers: {
          host: '127.0.0.1:3000',
          origin: 'http://evil.example',
        },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'invalid_origin' });
    } finally {
      await app.close();
    }
  });

  it('同一OriginとSec-Fetch-Siteを許可する', async () => {
    const app = makeApp();
    try {
      const response = await app.inject({
        url: '/api/test',
        headers: {
          host: '127.0.0.1:3000',
          origin: 'http://127.0.0.1:3000',
          'sec-fetch-site': 'same-origin',
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-security-policy']).toContain("script-src 'self'");
      expect(response.headers['x-frame-options']).toBe('DENY');
    } finally {
      await app.close();
    }
  });

  it('クロスサイトのAPIリクエストを拒否する', async () => {
    const app = makeApp();
    try {
      const response = await app.inject({
        url: '/api/test',
        headers: {
          host: '127.0.0.1:3000',
          'sec-fetch-site': 'cross-site',
        },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'cross_site_request' });
    } finally {
      await app.close();
    }
  });

  it('LAN公開時はHTTPSのOriginのみ許可する', async () => {
    const app = makeApp(config({ host: '0.0.0.0' }));
    const machine = hostname();
    try {
      const insecure = await app.inject({
        url: '/api/test',
        headers: { host: `${machine}:3000`, origin: `http://${machine}:3000` },
      });
      expect(insecure.statusCode).toBe(403);

      const secure = await app.inject({
        url: '/api/test',
        headers: { host: `${machine}:3000`, origin: `https://${machine}:3000` },
      });
      expect(secure.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});

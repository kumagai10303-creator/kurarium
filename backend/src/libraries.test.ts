import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import { openDb, type DB } from './db.js';
import { markLegacyDefaults } from './libraries.js';
import { buildApp } from './routes.js';

let root: string;
let db: DB;
let app: FastifyInstance;
let config: AppConfig;
let legacyPath: string;
let newPath: string;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'kurarium-libraries-'));
  process.env.MEDIAVIEWER_DATA_DIR = join(root, 'data');
  legacyPath = join(root, 'Legacy');
  newPath = join(root, 'New');
  config = {
    smb: {
      host: '',
      share: '',
      username: '',
      password: '',
      driveLetter: 'Z:',
      autoMount: false,
    },
    media: {
      imageFolders: [legacyPath],
      videoFolders: [],
      pdfFolders: [],
      musicFolders: [],
    },
    server: {
      port: 3000,
      host: '127.0.0.1',
      basicAuthUser: '',
      basicAuthPasswordHash: '',
    },
    tags: { rules: [] },
  };
  db = openDb(join(root, 'test.db'));
  app = await buildApp({ config, db });
});

afterEach(async () => {
  await app.close();
  db.close();
  rmSync(root, { recursive: true, force: true });
});

async function createLibrary(name: string, path: string): Promise<number> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/libraries',
    payload: {
      name,
      tab: '画像',
      paths: [{ provider: 'local', path }],
    },
  });
  expect(response.statusCode).toBe(200);
  return (response.json() as { id: number }).id;
}

async function getLibrary(id: number): Promise<{ is_default: number; enabled: number }> {
  const response = await app.inject({ method: 'GET', url: '/api/libraries' });
  expect(response.statusCode).toBe(200);
  const body = response.json() as {
    libraries: { id: number; is_default: number; enabled: number }[];
  };
  const library = body.libraries.find((entry) => entry.id === id);
  expect(library).toBeDefined();
  return library!;
}

describe('library actions', () => {
  it('すべてのライブラリを無効化・有効化・削除できる', async () => {
    const legacyId = await createLibrary('Legacy', legacyPath);
    const newId = await createLibrary('New', newPath);

    expect((await getLibrary(legacyId)).is_default).toBe(1);
    expect((await getLibrary(newId)).is_default).toBe(0);

    db.prepare('UPDATE libraries SET is_default = 1 WHERE id = ?').run(newId);
    markLegacyDefaults(db, config);
    expect((await getLibrary(newId)).is_default).toBe(0);

    const disabled = await app.inject({
      method: 'PATCH',
      url: `/api/libraries/${legacyId}`,
      payload: { enabled: false },
    });
    expect(disabled.statusCode).toBe(200);
    expect((await getLibrary(legacyId)).enabled).toBe(0);

    const enabled = await app.inject({
      method: 'PATCH',
      url: `/api/libraries/${legacyId}`,
      payload: { enabled: true },
    });
    expect(enabled.statusCode).toBe(200);
    expect((await getLibrary(legacyId)).enabled).toBe(1);

    const deletedNew = await app.inject({ method: 'DELETE', url: `/api/libraries/${newId}` });
    expect(deletedNew.statusCode).toBe(200);

    const deletedLegacy = await app.inject({
      method: 'DELETE',
      url: `/api/libraries/${legacyId}`,
    });
    expect(deletedLegacy.statusCode).toBe(200);
  });
});

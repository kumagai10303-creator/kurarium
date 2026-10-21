import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

const root = process.env.KURARIUM_E2E_ROOT ?? join(tmpdir(), 'kurarium-e2e');
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
const dataDir = join(root, 'data');
const mediaDir = join(root, 'media');
process.env.MEDIAVIEWER_DATA_DIR = dataDir;

const colors = [
  { r: 30, g: 120, b: 220 },
  { r: 210, g: 80, b: 60 },
  { r: 40, g: 170, b: 100 },
];
for (let i = 0; i < colors.length; i++) {
  await mkdir(mediaDir, { recursive: true });
  const width = i === 1 ? 480 : 640;
  const height = i === 1 ? 640 : 480;
  const image = await sharp({
    create: { width, height, channels: 3, background: colors[i] },
  })
    .png()
    .toBuffer();
  await writeFile(join(mediaDir, `e2e-${i + 1}.png`), image);
}
const subDir = join(mediaDir, 'sub');
await mkdir(subDir, { recursive: true });
await writeFile(
  join(subDir, 'nested.png'),
  await sharp({ create: { width: 640, height: 480, channels: 3, background: colors[2] } })
    .png()
    .toBuffer(),
);

const { startServer } = await import('../backend/dist/server.js');
const port = Number(process.env.E2E_BACKEND_PORT ?? 3100);
const server = await startServer({ port, host: '127.0.0.1' });
const base = server.url;

async function api(path, init) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`E2E seed failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

async function seed() {
  await api('/api/libraries', {
    method: 'POST',
    body: JSON.stringify({
      name: 'E2E Images',
      tab: '画像',
      paths: [{ provider: 'local', path: mediaDir }],
    }),
  });
  await api('/api/scan', {
    method: 'POST',
    body: JSON.stringify({ mode: 'full' }),
  });

  for (let i = 0; i < 80; i++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const status = await api('/api/scan/status');
    const items = await api('/api/items?limit=10');
    if (!status.scan.running && Array.isArray(items.items) && items.items.length >= 3) {
      return;
    }
  }
  throw new Error('E2E seed timed out waiting for the initial scan');
}

let stopping = false;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  await server.stop().catch(() => undefined);
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
  process.exit(code);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

try {
  await seed();
  console.log(`E2E backend ready: ${base}`);
} catch (error) {
  console.error(error);
  await shutdown(1);
}

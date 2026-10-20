import { build } from 'esbuild';
import { rm } from 'node:fs/promises';

await rm('electron/dist', { recursive: true, force: true });

const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: false,
  logLevel: 'info',
};

await Promise.all([
  build({ ...shared, entryPoints: ['electron/main.ts'], outfile: 'electron/dist/main.js' }),
  build({ ...shared, entryPoints: ['electron/preload.ts'], outfile: 'electron/dist/preload.js' }),
]);

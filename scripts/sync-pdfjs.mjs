import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = join(repoRoot, 'frontend', 'node_modules', 'pdfjs-dist');
const targetRoot = join(repoRoot, 'frontend', 'public', 'pdfjs');
const dirs = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];

if (!existsSync(sourceRoot)) {
  console.error('pdfjs-dist is not installed. Run npm install in frontend first.');
  process.exit(1);
}

await rm(targetRoot, { recursive: true, force: true });
await mkdir(targetRoot, { recursive: true });
for (const dir of dirs) {
  await cp(join(sourceRoot, dir), join(targetRoot, dir), { recursive: true });
}
console.log(`Synced PDF.js assets to ${targetRoot}`);

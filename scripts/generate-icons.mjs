import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const svg = await readFile(join(root, 'frontend', 'public', 'logo.svg'));
const outDir = join(root, 'build');
await mkdir(outDir, { recursive: true });

const render = (size) =>
  sharp(svg, { density: 512 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

const [png, tray] = await Promise.all([render(256), render(32)]);
await writeFile(join(outDir, 'tray.png'), tray);

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);

const entry = Buffer.alloc(16);
entry.writeUInt8(0, 0);
entry.writeUInt8(0, 1);
entry.writeUInt8(0, 2);
entry.writeUInt8(0, 3);
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(22, 12);

await writeFile(join(outDir, 'icon.ico'), Buffer.concat([header, entry, png]));
console.log('Generated build/icon.ico and build/tray.png');

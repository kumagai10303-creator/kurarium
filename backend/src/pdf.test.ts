import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type DB } from './db.js';
import { processThumb } from './thumbnails.js';
import { closeThumbStore, getThumb } from './thumb_store.js';

let root: string;
let db: DB;

function makeCmapPdf(): Buffer {
  const content = 'BT /F1 24 Tf 72 700 Td <304230443046> Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /KozMinPro-Regular /Encoding /Adobe-Japan1-UCS2 /DescendantFonts [6 0 R] >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /KozMinPro-Regular /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 6 >> /FontDescriptor 7 0 R /DW 1000 >>',
    '<< /Type /FontDescriptor /FontName /KozMinPro-Regular /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'kurarium-pdf-'));
  process.env.MEDIAVIEWER_DATA_DIR = join(root, 'data');
  db = openDb(join(root, 'mediaviewer.db'));
});

afterAll(() => {
  closeThumbStore();
  db.close();
  rmSync(root, { recursive: true, force: true });
});

describe('PDF thumbnail resources', () => {
  it('CMapをファイルパスから読み込み、警告なしで生成する', async () => {
    const pdfPath = join(root, 'japanese-cmap.pdf');
    await writeFile(pdfPath, makeCmapPdf());
    const now = Date.now();
    const result = db
      .prepare(
        `INSERT INTO media_items
         (type, path, folder, file_name, ext, size, mtime, thumb_status, status, added_at, last_scanned)
         VALUES ('pdf', ?, ?, 'japanese-cmap.pdf', 'pdf', ?, ?, 'pending', 'active', ?, ?)`,
      )
      .run(pdfPath, root, makeCmapPdf().length, now, now, now);
    const id = Number(result.lastInsertRowid);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await processThumb(db, id);
    } finally {
      warn.mockRestore();
    }

    expect(warn.mock.calls.flat().join('\n')).not.toContain('Unable to load CMap data');
    expect(getThumb(id)).not.toBeNull();
    const row = db.prepare('SELECT thumb_status, width, height FROM media_items WHERE id=?').get(id);
    expect(row).toEqual({ thumb_status: 'ready', width: 595, height: 842 });
  }, 30_000);
});

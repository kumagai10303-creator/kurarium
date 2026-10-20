import sharp from 'sharp';
const pdf = Buffer.from(`%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj
trailer << /Root 1 0 R >>
%%EOF
`, 'utf8');
sharp(pdf, { density: 96 })
  .resize({ width: 128 })
  .jpeg()
  .toBuffer()
  .then((b) => console.log('PDF thumb OK, bytes=', b.length))
  .catch((e) => console.log('PDF FAIL:', e.message));

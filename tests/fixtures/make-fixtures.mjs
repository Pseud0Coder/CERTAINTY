/* Regenerates the document fixtures used by tests/documents.test.ts.
   Run: node tests/fixtures/make-fixtures.mjs
   All people and companies are fictional.

   cv-two-column.pdf  A sidebar (contact, skills, education) beside an
                      experience column, the layout that interleaves lines
                      in naive PDF text extraction.
   cv-word.docx       Deflate-compressed parts and numbered list paragraphs,
                      the way Word itself saves a CV. */
import { writeFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/* ---------- two-column PDF ---------- */
function pdfEscape(s) { return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
function textOps(items) {
  return items.map(([x, y, size, bold, text]) =>
    `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (${pdfEscape(text)}) Tj ET`).join('\n');
}
const left = [
  [40, 740, 18, true, 'Ravi Menon'],
  [40, 720, 10, false, 'Backend Engineer'],
  [40, 690, 11, true, 'Contact'],
  [40, 674, 9, false, 'Bristol, UK'],
  [40, 662, 9, false, 'ravi.menon@example.com'],
  [40, 650, 9, false, '+44 7700 900456'],
  [40, 620, 11, true, 'Skills'],
  [40, 604, 9, false, 'Go, PostgreSQL, Kafka'],
  [40, 592, 9, false, 'Kubernetes, Terraform'],
  [40, 562, 11, true, 'Education'],
  [40, 546, 9, false, 'BEng Software Engineering'],
  [40, 534, 9, false, 'University of Bath, 2016'],
];
const right = [
  [230, 740, 12, true, 'Experience'],
  [230, 718, 10, true, 'Senior Backend Engineer, Harbourline'],
  [230, 704, 9, false, 'Mar 2020 - Present'],
  [230, 690, 9, false, '- Moved payments onto Kafka, cutting settlement lag from 6h to 20 minutes.'],
  [230, 678, 9, false, '- Ran the on-call rotation for 9 services.'],
  [230, 652, 10, true, 'Backend Engineer, Copperleaf'],
  [230, 638, 9, false, 'Sep 2016 - Feb 2020'],
  [230, 624, 9, false, '- Built the Go billing service handling 40k invoices a month.'],
  [230, 612, 9, false, '- Introduced Terraform for staging environments.'],
];
const content = textOps([...left, ...right]);
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
];
let pdf = '%PDF-1.4\n';
const offsets = [];
objects.forEach((body, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
writeFileSync(join(here, 'cv-two-column.pdf'), pdf, 'latin1');

/* ---------- deflated DOCX ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (const x of b) c = CRC[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zip(files) {
  const locals = []; const centrals = []; let offset = 0;
  for (const [name, text] of files) {
    const raw = Buffer.from(text, 'utf8'); const comp = deflateRawSync(raw); const nameB = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc32(raw), 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nameB.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc32(raw), 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nameB.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameB, comp); centrals.push(ch, nameB); offset += 30 + nameB.length + comp.length;
  }
  const cd = Buffer.concat(centrals); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
/* Runs split on tabs the way Word writes them: <w:tab/> is its own run
   element, never inside <w:t>. */
const para = (t, list = false) => `<w:p>${list ? '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' : ''}${
  t.split('\t').map(part => `<w:r><w:t xml:space="preserve">${part}</w:t></w:r>`).join('<w:r><w:tab/></w:r>')}</w:p>`;
const body = [
  para('Amara Okafor'), para('Operations Manager'), para('Leeds, UK | amara.okafor@example.com'),
  para('PROFESSIONAL EXPERIENCE'),
  para('Operations Manager\tKestrel Logistics'), para('Apr 2019 – Present'),
  para('Cut late deliveries from 12% to 4% across 3 depots.', true),
  para('Hired and led a team of 14 &amp; ran weekly safety reviews.', true),
  para('Shift Supervisor, Pennine Freight'), para('2015 to 2019'),
  para('Introduced route planning software.', true),
  para('EDUCATION'), para('BSc Business Management, Leeds Beckett University'),
].join('');
const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
writeFileSync(join(here, 'cv-word.docx'), zip([
  ['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
  ['word/document.xml', docXml],
]));
console.log('fixtures written');

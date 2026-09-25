/* Minimal PDF writer: US Letter pages, the two standard (unembedded)
   Helvetica fonts, word-wrapped text positioned by hand. No external
   library: PDF is a plain byte format and a CV is short enough that a
   hand-rolled object table is entirely tractable. */
import type { CvBlock } from './cv-template.js';

const PAGE_W = 612, PAGE_H = 792, MARGIN = 54;
const CONTENT_W = PAGE_W - MARGIN * 2;

/* Rough Helvetica advance-width buckets (em-fractions): not the real AFM
   table, but close enough that word-wrap neither overflows the margin
   nor wraps absurdly early. */
const NARROW = new Set([...'ijl.,;:\'!|` ']);
const WIDE = new Set([...'mwMW@%']);
function charWidth(ch: string): number {
  if (NARROW.has(ch)) return 0.28;
  if (WIDE.has(ch)) return 0.86;
  if (ch >= 'A' && ch <= 'Z') return 0.72;
  if (ch >= '0' && ch <= '9') return 0.56;
  if (ch === '-') return 0.33;
  return 0.5;
}
function textWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of s) w += charWidth(ch);
  return w * size;
}
function wrap(text: string, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && textWidth(candidate, size) > maxWidth) { lines.push(line); line = word; }
    else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}
function escPdf(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

interface LineSpec { text: string; size: number; font: 'F1' | 'F2'; gray: number; indent: number; spaceBefore: number }

function blockLines(b: CvBlock): LineSpec[] {
  const mk = (lines: string[], size: number, font: 'F1' | 'F2', gray: number, indent: number, spaceBefore: number): LineSpec[] =>
    lines.map((text, i) => ({ text, size, font, gray, indent, spaceBefore: i === 0 ? spaceBefore : 0 }));
  switch (b.type) {
    case 'title': return mk(wrap(b.text, 22, CONTENT_W), 22, 'F2', 0, 0, 0);
    case 'subtitle': return mk(wrap(b.text, 13, CONTENT_W), 13, 'F2', 0, 0, 12);
    case 'meta': return mk(wrap(b.text, 10, CONTENT_W), 10, 'F1', 0.4, 0, 0);
    case 'heading': return mk(wrap(b.text, 14, CONTENT_W), 14, 'F2', 0, 0, 18);
    case 'bullet': {
      const ls = wrap(b.text, 10.5, CONTENT_W - 16);
      return ls.map((text, i) => ({ text: i === 0 ? `- ${text}` : `  ${text}`, size: 10.5, font: 'F1', gray: 0, indent: 16, spaceBefore: i === 0 ? 2 : 0 }));
    }
    case 'para': return mk(wrap(b.text, 10.5, CONTENT_W), 10.5, 'F1', 0, 0, 4);
    case 'space': return [{ text: '', size: 6, font: 'F1', gray: 0, indent: 0, spaceBefore: 6 }];
  }
}

interface Placed extends LineSpec { y: number }
function paginate(lines: LineSpec[]): Placed[][] {
  const pages: Placed[][] = [[]];
  let y = PAGE_H - MARGIN;
  for (const ln of lines) {
    const lineHeight = ln.size * 1.35;
    if (y - (ln.spaceBefore + lineHeight) < MARGIN) { pages.push([]); y = PAGE_H - MARGIN; }
    y -= ln.spaceBefore;
    pages[pages.length - 1]!.push({ ...ln, y });
    y -= lineHeight;
  }
  return pages;
}

function pageContentStream(placed: Placed[]): string {
  const parts: string[] = [];
  for (const p of placed) {
    if (!p.text) continue;
    const x = MARGIN + p.indent;
    parts.push(`BT ${p.gray} g /${p.font} ${p.size} Tf ${x.toFixed(2)} ${p.y.toFixed(2)} Td (${escPdf(p.text)}) Tj ET`);
  }
  return parts.join('\n');
}

export function buildCvPdf(blocks: CvBlock[]): Blob {
  const lines = blocks.flatMap(blockLines);
  const pages = paginate(lines);
  if (pages.length === 0) pages.push([]);
  const N = pages.length;

  const idCatalog = 1, idPages = 2, idF1 = 3, idF2 = 4;
  const pageIds = Array.from({ length: N }, (_, i) => 5 + i);
  const contentIds = Array.from({ length: N }, (_, i) => 5 + N + i);
  const totalObjs = 4 + N * 2;

  const bytes: number[] = [];
  const offsets: number[] = new Array(totalObjs + 1).fill(0);
  const push = (s: string): void => { for (let i = 0; i < s.length; i++) bytes.push(Math.min(s.charCodeAt(i), 255)); };
  const obj = (id: number, body: string): void => { offsets[id] = bytes.length; push(`${id} 0 obj\n${body}\nendobj\n`); };

  push('%PDF-1.4\n');
  obj(idCatalog, `<< /Type /Catalog /Pages ${idPages} 0 R >>`);
  obj(idPages, `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${N} >>`);
  obj(idF1, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  obj(idF2, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  pages.forEach((_, i) => {
    obj(pageIds[i]!, `<< /Type /Page /Parent ${idPages} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${idF1} 0 R /F2 ${idF2} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`);
  });
  pages.forEach((placed, i) => {
    const data = pageContentStream(placed);
    obj(contentIds[i]!, `<< /Length ${data.length} >>\nstream\n${data}\nendstream`);
  });

  const xrefOffset = bytes.length;
  push(`xref\n0 ${totalObjs + 1}\n`);
  push('0000000000 65535 f \n');
  for (let id = 1; id <= totalObjs; id++) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${totalObjs + 1} /Root ${idCatalog} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return new Blob([Uint8Array.from(bytes) as unknown as BlobPart], { type: 'application/pdf' });
}

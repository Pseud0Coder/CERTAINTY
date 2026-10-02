/* Document intake (ADR-0022). A CV or JD arrives once as a file and is
   turned into plain text here, before anything else touches it. The text
   then goes through quarantine() exactly like pasted text: parsing is
   extraction, not trust (L1).

   PDF: LiteParse, local and offline (Apache 2.0, Rust core). It projects
   text onto a spatial grid, so two-column CVs come out in reading order.
   OCR is off: scanned CVs are detected and refused with a clear message
   rather than slowly guessed at.

   DOCX: read directly. A .docx is a zip of XML parts; LiteParse converts
   Office files through LibreOffice, which a plain Node host does not have,
   so the paragraphs are pulled from word/document.xml with node:zlib. */

import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export type DocFormat = 'pdf' | 'docx';

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

export class DocumentError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}

export interface ExtractedDocument {
  text: string;
  format: DocFormat;
  parser: 'liteparse' | 'docx-xml';
  pages: number;
  bytes: number;
  sha256: string;
}

/* Format comes from the bytes, never from the filename or a client claim. */
export function sniffFormat(bytes: Uint8Array): DocFormat | null {
  const head = Buffer.from(bytes.subarray(0, 8)).toString('latin1');
  if (head.startsWith('%PDF-')) return 'pdf';
  if (head.startsWith('PK\x03\x04')) {
    return zipEntries(bytes).some(e => e.name === 'word/document.xml') ? 'docx' : null;
  }
  return null;
}

/* ---------------------------------------------------------------------- */
/* zip reading: central directory, stored and deflated entries only        */

interface ZipEntry { name: string; method: number; compSize: number; offset: number }

function zipEntries(bytes: Uint8Array): ZipEntry[] {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  /* End of central directory: scan back over a possible trailing comment. */
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return [];
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    out.push({ name: buf.toString('utf8', p + 46, p + 46 + nameLen), method, compSize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function zipRead(bytes: Uint8Array, name: string): Buffer | null {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const e = zipEntries(bytes).find(x => x.name === name);
  if (!e || buf.readUInt32LE(e.offset) !== 0x04034b50) return null;
  const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
  const data = buf.subarray(start, start + e.compSize);
  if (e.method === 0) return Buffer.from(data);
  if (e.method === 8) return inflateRawSync(data, { maxOutputLength: 20 * 1024 * 1024 });
  return null;
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return XML_ENTITIES[code] ?? m;
  });
}

/* One line per paragraph; list paragraphs (w:numPr) become "- " bullets,
   tabs and line breaks inside a paragraph become spaces. */
export function docxText(bytes: Uint8Array): string {
  const xml = zipRead(bytes, 'word/document.xml');
  if (!xml) throw new DocumentError('unreadable_document');
  const doc = xml.toString('utf8');
  const lines: string[] = [];
  for (const para of doc.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) ?? []) {
    const runs = [...para.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br)\/>/g)]
      /* A tab separates fields ("Title<tab>Company"); keep it as one. */
      .map(m => (m[2] === 'tab' ? ' | ' : m[2] ? ' ' : unescapeXml(m[1] ?? '')))
      .join('');
    const text = runs.replace(/[ \t]+/g, ' ').replace(/^\|\s*|\s*\|$/g, '').trim();
    if (!text) { lines.push(''); continue; }
    lines.push(/<w:numPr>/.test(para) && !/^[-•*]/.test(text) ? `- ${text}` : text);
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ---------------------------------------------------------------------- */
/* PDF through LiteParse                                                   */

interface PdfItem { text: string; x: number; y: number; width: number }
interface PdfPage { width: number; text: string; textItems: PdfItem[] }
type LiteParseCtor = new (cfg: Record<string, unknown>) => {
  parse(input: Uint8Array): Promise<{ text: string; totalPages: number; pages: PdfPage[] }>;
};
let liteParse: LiteParseCtor | null = null;

/* Groups items into lines (same baseline within 3pt), left to right. */
function linesOf(items: PdfItem[]): string[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: PdfItem[][] = [];
  for (const it of sorted) {
    const last = lines.at(-1);
    if (last && Math.abs(last[0]!.y - it.y) <= 3) last.push(it);
    else lines.push([it]);
  }
  return lines.map(l => l.sort((a, b) => a.x - b.x).map(i => i.text.trim()).filter(Boolean).join(' '));
}

/* Sidebar CVs put two columns side by side, and a spatial text grid keeps
   them on shared lines ("Contact   - Moved payments onto Kafka"). Find a
   vertical gutter no item crosses (a couple of full-width header items
   allowed), then read each column top to bottom. Single-column pages keep
   LiteParse's own layout text. */
export function columnText(page: PdfPage): string {
  const items = page.textItems.filter(i => i.text.trim());
  if (items.length < 8) return page.text;
  const starts = [...new Set(items.map(i => Math.round(i.x)))].sort((a, b) => a - b);
  for (const split of starts) {
    if (split < page.width * 0.2 || split > page.width * 0.75) continue;
    const left = items.filter(i => i.x < split);
    const right = items.filter(i => i.x >= split);
    const crossing = left.filter(i => i.x + i.width > split - 6);
    if (crossing.length > 2 || left.length - crossing.length < 4 || right.length < 4) continue;
    const top = Math.min(...right.map(i => i.y));
    /* Crossing items are only acceptable above the columns, as a header. */
    if (crossing.some(i => i.y > top)) continue;
    const leftCol = left.filter(i => !crossing.includes(i));
    return [...linesOf(crossing), '', ...linesOf(leftCol), '', ...linesOf(right)].join('\n').trim();
  }
  return page.text;
}

async function pdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  if (!liteParse) {
    /* Loaded on first use: the native binary is only needed by hosts that
       actually receive documents. */
    const mod = await import('@llamaindex/liteparse') as unknown as { LiteParse: LiteParseCtor };
    liteParse = mod.LiteParse;
  }
  const parser = new liteParse({ ocrEnabled: false, outputFormat: 'json', maxPages: 10, quiet: true });
  try {
    const result = await parser.parse(bytes);
    const text = result.pages.length ? result.pages.map(columnText).join('\n\n') : result.text;
    return { text, pages: result.totalPages };
  } catch {
    throw new DocumentError('unreadable_document');
  }
}

/* Bytes to text, with the checks a user should hear about in words:
   too large, not a PDF or Word file, unreadable, or a scan with no text. */
export async function extractDocument(bytes: Uint8Array): Promise<ExtractedDocument> {
  if (bytes.byteLength === 0) throw new DocumentError('empty_document');
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new DocumentError('document_too_large');
  const format = sniffFormat(bytes);
  if (!format) throw new DocumentError('unsupported_format');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (format === 'docx') {
    const text = docxText(bytes);
    if (text.replace(/\s/g, '').length < 40) throw new DocumentError('no_text_found');
    return { text, format, parser: 'docx-xml', pages: 1, bytes: bytes.byteLength, sha256 };
  }
  const { text, pages } = await pdfText(bytes);
  /* A scanned CV has pages but no text layer. Under ~40 characters per
     page there is nothing to structure, so say so instead of guessing. */
  if (text.replace(/\s/g, '').length < 40 * Math.max(1, Math.min(pages, 2))) throw new DocumentError('no_text_found');
  return { text, format, parser: 'liteparse', pages, bytes: bytes.byteLength, sha256 };
}

/* Base64 from a JSON body, tolerant of a data: URL prefix. */
export function decodeUpload(dataBase64: unknown): Uint8Array {
  if (typeof dataBase64 !== 'string' || !dataBase64) throw new DocumentError('empty_document');
  const raw = dataBase64.replace(/^data:[^,]*,/, '');
  if (raw.length > Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4 + 4) throw new DocumentError('document_too_large');
  return new Uint8Array(Buffer.from(raw, 'base64'));
}

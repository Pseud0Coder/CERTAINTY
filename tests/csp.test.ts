/* Static contract between the shipped clients and the CSP (ADR-0013,
   ADR-0018). A page whose inline script or bare import is blocked by CSP
   boots to a blank screen with a 200 status: nothing in the API or the
   server logs sees it. These tests make that failure mode a build failure
   instead of a silent production regression. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB_DIST = join(ROOT, 'web-dist');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const pages = walk(WEB_DIST).filter(p => p.endsWith('.html'));
const scripts = walk(WEB_DIST).filter(p => ['.js', '.mjs'].includes(extname(p)));

test('shipped pages contain no inline scripts (CSP script-src blocks them)', () => {
  assert.ok(pages.length > 0, 'web-dist has pages; run npm run build:web');
  for (const page of pages) {
    const html = readFileSync(page, 'utf8');
    const tags = [...html.matchAll(/<script\b[^>]*>/gi)].map(m => m[0]);
    for (const tag of tags) {
      assert.match(tag, /\bsrc=/i, `${page} has an inline <script>; move it to a file. Tag: ${tag}`);
    }
  }
});

test('shipped modules use no bare import specifiers (they fail without an import map)', () => {
  assert.ok(scripts.length > 0, 'web-dist has modules; run npm run build:web');
  /* Statements only (a line that starts with import or export), plus dynamic
     import(): a UI string that ends in "from" is not an import. */
  const IMPORT_RE = /(?:^[ \t]*(?:import|export)\b[^;'"]*?\bfrom\s*|^[ \t]*import\s*|\bimport\(\s*)["']([^"']+)["']/gm;
  for (const file of scripts.filter(f => !f.includes('vendor'))) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1];
      if (!spec) continue;
      const allowed = spec.startsWith('./') || spec.startsWith('../') ||
        spec.startsWith('/') || spec.startsWith('data:') || spec.startsWith('blob:');
      assert.ok(allowed,
        `${file} imports "${spec}": only relative or absolute paths survive the CSP; bare specifiers need an import map, and import maps are inline scripts the CSP blocks.`);
    }
  }
});

test('the vendor bundle is fully self-contained (the module graph resolves with no map)', async () => {
  /* Regex cannot tell code from string literals in a minified bundle (" from
     JSON: " is prose, not an import), so self-containment is proven the way
     the browser proves it: the resolver must link the graph without any
     import map. A bare specifier fails with ERR_MODULE_NOT_FOUND. */
  const vendor = scripts.filter(f => f.includes('vendor'));
  assert.ok(vendor.length > 0, 'vendor bundle missing; run npm run build:web');
  for (const file of vendor) {
    const url = pathToFileURL(file).href;
    const err = await import(url).then(() => null, (e: NodeJS.ErrnoException) => e);
    const unresolved = err && (err.code === 'ERR_MODULE_NOT_FOUND' ||
      /Failed to resolve|Cannot find (package|module)/.test(String(err.message)));
    assert.ok(!unresolved, `${file} does not resolve on its own: ${err?.message}`);
  }
});

test('the vendor bundle matches the installed livekit-client version', () => {
  const shipped = join(ROOT, 'src', 'web', 'vendor', 'livekit-client.esm.mjs');
  const installed = join(ROOT, 'node_modules', 'livekit-client', 'dist', 'livekit-client.esm.mjs');
  const hash = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
  assert.equal(hash(shipped), hash(installed),
    'src/web/vendor/livekit-client.esm.mjs is stale; run npm run build:web after changing the livekit-client dependency');
});

test('the CSP no longer references the removed esm.sh CDN', () => {
  const server = readFileSync(join(ROOT, 'src', 'server', 'index.ts'), 'utf8');
  assert.ok(!server.includes('esm.sh'),
    'script-src/connect-src still allow esm.sh; clients are self-hosted now, drop the CDN exception');
});

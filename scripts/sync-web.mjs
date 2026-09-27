import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'web-dist');
mkdirSync(out, { recursive: true });

/* tsc emits the compiled TS. HTML and CSS ship alongside. */
execSync('npx tsc -p src/web/tsconfig.json', { cwd: root, stdio: 'inherit' });

/* `base` is fixed at the top-level src/web root for every recursive call,
   so a file's destination mirrors its full path relative to that root
   (e.g. src/web/img/shot.png -> web-dist/img/shot.png). Slicing against
   the current recursion directory instead of `base` was a latent bug:
   it never surfaced because until src/web/img, no subdirectory held a
   .html/.css file for copyStatic to place. */
function copyStatic(dir, base) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) copyStatic(p, base);
    else if (['.html', '.css', '.png', '.mjs'].some(ext => p.endsWith(ext))) {
      const dest = join(out, p.slice(base.length + 1));
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(p, dest);
    }
  }
}
const webRoot = join(root, 'src', 'web');
copyStatic(webRoot, webRoot);

/* Vendor bundle lives in git (render has no npm-provided path for it after a
   clean clone, and committing it keeps deploys reproducible). Refresh it from
   node_modules and refuse a stale copy: the shipped bundle must always match
   the livekit-client version in package.json. */
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
const vendorName = 'livekit-client.esm.mjs';
const vendorSrc = join(root, 'node_modules', 'livekit-client', 'dist', vendorName);
const vendorOut = join(webRoot, 'vendor', vendorName);
const same = existsSync(vendorOut) &&
  createHash('sha256').update(readFileSync(vendorOut)).digest('hex') ===
  createHash('sha256').update(readFileSync(vendorSrc)).digest('hex');
if (!same) cpSync(vendorSrc, vendorOut);

console.log('web-dist synced');

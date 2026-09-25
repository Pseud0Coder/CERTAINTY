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
    else if (p.endsWith('.html') || p.endsWith('.css') || p.endsWith('.png')) {
      const dest = join(out, p.slice(base.length + 1));
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(p, dest);
    }
  }
}
const webRoot = join(root, 'src', 'web');
copyStatic(webRoot, webRoot);
console.log('web-dist synced');

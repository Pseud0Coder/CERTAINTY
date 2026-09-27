/* Certainty server. Static clients, API, SSE event bus, retention job.
   Security headers on every response. Prompts are never served (L3). */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../spine/db.ts';
import { Engine } from '../spine/flows/engine.ts';
import { seedDemo } from '../spine/seed.ts';
import { pipelineHandler } from '../spine/pipeline.ts';
import { applyRetention } from '../spine/retention.ts';
import { providerFromEnv } from '../spine/providers/llm.ts';
import { userForToken } from './auth.ts';
import { handleApi } from './api.ts';
import type { ApiDeps } from './api.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/* Never die silently: log before anything can take the process down. */
process.on('uncaughtException', err => { console.error('uncaught exception', err); });
process.on('unhandledRejection', err => { console.error('unhandled rejection', err); });

const DATA = join(ROOT, 'data');
const WEB_DIST = join(ROOT, 'web-dist');
mkdirSync(DATA, { recursive: true });

/* Provider credentials come from the environment. A .env file at the repo
   root is loaded when present so a local run needs no shell setup; real
   environment variables already set always win. */
const ENV_FILE = join(ROOT, '.env');
if (existsSync(ENV_FILE)) {
  try { process.loadEnvFile(ENV_FILE); } catch (err) {
    console.error('could not read .env', err instanceof Error ? err.message : err);
  }
}

const store = new Store(join(DATA, 'certain.db'));

/* Model provider selection (ADR-0005, ADR-0012). No key, or CERTAINTY_LLM=off,
   selects the scripted provider and the demo stays deterministic.
   Diagnostics are structured and carry no prompt text (L3). */
const llm = providerFromEnv(process.env, (event, detail) => {
  console.warn(`llm ${event} ${detail}`);
});
const engine = new Engine(store, llm);
console.log(`model provider: ${llm.name}`);

const userCount = (store.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
if (userCount === 0) {
  const ids = seedDemo(store);
  console.log('seeded demo scenario, tenant', ids.tenantId);
}
applyRetention(store);

/* SSE hub plus pipeline handlers, composed on the single event bus (A0). */
const sseClients = new Map<string, Set<ServerResponse>>();
const pipeline = pipelineHandler(store, engine);
store.onEvent = (tenantId: string, topic: string, payload: unknown) => {
  pipeline(tenantId, topic, payload);
  const set = sseClients.get(tenantId);
  if (!set) return;
  const frame = `event: ${topic}\ndata: ${JSON.stringify({ topic, payload })}\n\n`;
  for (const res of set) res.write(frame);
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  ".js": 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2',
};

function securityHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self' wss://*.livekit.cloud https://*.livekit.cloud; img-src 'self' data:");
}

function serveFile(res: ServerResponse, path: string): boolean {
  if (!existsSync(path)) return false;
  const ext = path.slice(path.lastIndexOf('.'));
  if (!MIME[ext]) return false;
  res.writeHead(200, { 'Content-Type': MIME[ext] });
  res.end(readFileSync(path));
  return true;
}

const server = createServer(async (req, res) => {
  securityHeaders(res);
  const url = new URL(req.url ?? '/', 'http://localhost');

  try {
    /* Event stream. */
    if (url.pathname === '/api/events' && req.method === 'GET') {
      const auth = authFor(req);
      if (!auth) { res.writeHead(401).end(); return; }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(': connected\n\n');
      const set = sseClients.get(auth.user.tenantId) ?? new Set();
      set.add(res);
      sseClients.set(auth.user.tenantId, set);
      const hb = setInterval(() => res.write(': hb\n\n'), 30_000);
      req.on('close', () => { clearInterval(hb); set.delete(res); });
      return;
    }

    /* API. */
    if (url.pathname.startsWith('/api/')) {
      const auth = authFor(req);
      const handled = await handleApi(req, res, deps, url, auth);
      if (!handled) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"error":"no_route"}'); }
      return;
    }

    /* Pages. */
    if (req.method === 'GET') {
      const pages: Record<string, string> = {
        '/': 'marketing.html', '/login': 'index.html',
        '/app/recruiter': 'recruiter.html', '/app/candidate': 'candidate.html',
        '/app/admin': 'admin.html',
      };
      const page = pages[url.pathname];
      if (page && serveFile(res, join(WEB_DIST, page))) return;
      if (/^\/p\/[^/]+$/.test(url.pathname) && serveFile(res, join(WEB_DIST, 'public-profile.html'))) return;
      if (url.pathname === '/tokens.css' && serveFile(res, join(ROOT, 'tokens.css'))) return;
      if (url.pathname.startsWith('/assets/') &&
        serveFile(res, join(WEB_DIST, normalize(url.pathname).replace('assets/', '')))) return;
      if (serveFile(res, join(WEB_DIST, url.pathname.slice(1)))) return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  } catch (e) {
    console.error('server error', e);
    if (!res.headersSent) res.writeHead(500);
    res.end('internal error');
  }
});

function authFor(req: IncomingMessage) {
  const cookie = (req.headers.cookie ?? '').split(';')
    .map(c => c.trim()).find(c => c.startsWith('certainty_s='));
  const token = cookie?.slice('certainty_s='.length) ?? null;
  return token ? userForToken(store, token) : null;
}

const deps: ApiDeps = { store, engine };

const PORT = Number(process.env.PORT ?? 8331);
server.listen(PORT, () => {
  console.log(`Certainty listening on http://localhost:${PORT}`);
});

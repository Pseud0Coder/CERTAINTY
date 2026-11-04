/* Health check for uptime monitors and keep-alive pings (ADR-0028). No
   authentication and nothing sensitive: whether the database answers, how
   long the process has been up, and whether a model is configured. One cheap
   query, so pinging it every few minutes costs nothing. */
import type { Store } from '../spine/db.ts';
import type { LlmProvider } from '../spine/providers/llm.ts';

export interface Health { status: 200 | 503; body: { ok: boolean; uptimeSec: number; db: boolean; model: boolean } }

export function health(store: Store, llm: LlmProvider, startedAt: number, now = Date.now()): Health {
  let db = false;
  try { db = (store.db.prepare('SELECT 1 AS ok').get() as { ok: number }).ok === 1; } catch { db = false; }
  return {
    status: db ? 200 : 503,
    body: { ok: db, uptimeSec: Math.round((now - startedAt) / 1000), db, model: llm.name !== 'scripted' },
  };
}

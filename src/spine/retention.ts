/* Retention and GDPR (master prompt section 6). Per-tenant policy, default
   6 months for audio, applied by a scheduled job. Deletion propagates to
   derived artifacts. Data subject export and erase, audited. */
import type { Store, Ctx } from './db.ts';

const DEFAULT_RETENTION_MONTHS = 6;

export function applyRetention(store: Store, now = new Date()): number {
  let affected = 0;
  const cutoffs = new Map<string, number>();
  const rows = store.db.prepare(
    `SELECT c.tenant_id, c.retention_policy, s.id AS session_id FROM consents c
     JOIN sessions s ON s.consent_id = c.id WHERE c.withdrawn_at IS NOT NULL OR c.granted_at IS NOT NULL`)
    .all() as unknown as Array<{ tenant_id: string; retention_policy: string; session_id: string }>;
  for (const row of rows) {
    const months = Number(row.retention_policy.match(/(\d+)\s*month/)?.[1] ?? DEFAULT_RETENTION_MONTHS);
    if (!cutoffs.has(row.tenant_id)) cutoffs.set(row.tenant_id, months);
  }
  for (const [tenantId, months] of cutoffs) {
    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() - months);
    const ctx: Ctx = { tenantId };
    const expired = store.db.prepare(
      `SELECT id, candidate_id FROM sessions WHERE tenant_id = ? AND created_at < ? AND (transcript != '[]' OR debrief IS NOT NULL)`)
      .all(tenantId, cutoff.toISOString()) as unknown as Array<{ id: string; candidate_id: string }>;
    for (const row of expired) {
      store.updateSession(ctx, row.id, { transcript: [], debrief: null, star: null, duration: '' });
      for (const a of store.artifacts(ctx, row.candidate_id)) {
        if (a.kind === 'transcript') {
          store.db.prepare('UPDATE artifacts SET sanitized_text = NULL, content = NULL WHERE id = ? AND tenant_id = ?')
            .run(a.id, tenantId);
        }
      }
      store.audit(tenantId, 'system', 'system', 'retention_applied', row.id);
      affected++;
    }
  }
  return affected;
}

export function gdprExport(store: Store, ctx: Ctx, candidateId: string): Record<string, unknown> {
  const c = store.candidate(ctx, candidateId);
  if (!c) throw new Error('candidate_not_found');
  return {
    exportedAt: new Date().toISOString(),
    candidate: c,
    sessions: store.sessions(ctx, candidateId),
    flags: store.flags(ctx, candidateId),
    tasks: store.tasks(ctx, candidateId),
    artifacts: store.artifacts(ctx, candidateId).map(a => ({
      id: a.id, kind: a.kind, title: a.title, createdAt: a.createdAt, content: a.content,
    })),
    consents: store.db.prepare('SELECT * FROM consents WHERE tenant_id = ? AND candidate_id = ?')
      .all(ctx.tenantId, candidateId),
    audit: store.db.prepare(
      "SELECT * FROM audit_events WHERE tenant_id = ? AND (target = ? OR target LIKE ?) ORDER BY ts")
      .all(ctx.tenantId, candidateId, `${candidateId}%`),
  };
}

export function gdprErase(store: Store, ctx: Ctx, candidateId: string, actor: string): void {
  const c = store.candidate(ctx, candidateId);
  if (!c) throw new Error('candidate_not_found');
  store.updateCandidate(ctx, candidateId, {
    name: 'Erased data subject', currentCompensation: null, compExpectations: null,
    noticePeriod: null, motivation: null,
  });
  for (const s of store.sessions(ctx, candidateId)) {
    store.updateSession(ctx, s.id, { transcript: [], debrief: null, star: null, duration: '' });
  }
  for (const a of store.artifacts(ctx, candidateId)) {
    store.db.prepare('UPDATE artifacts SET sanitized_text = NULL, content = NULL, fields = ? WHERE id = ? AND tenant_id = ?')
      .run('{}', a.id, ctx.tenantId);
  }
  store.db.prepare('UPDATE tasks SET done = 1 WHERE tenant_id = ? AND candidate_id = ?')
    .run(ctx.tenantId, candidateId);
  store.audit(ctx.tenantId, actor, 'system', 'gdpr_erase', candidateId);
}

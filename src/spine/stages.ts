/* Stage machine. Stage advances and parking are human actions (A9); agents
   suggest only. One stage per advance, exactly as the prototype behaves. */
import type { Store, Ctx } from './db.ts';
import { STAGES, type Stage } from './types.ts';

export function assertStage(s: string): Stage {
  if (!STAGES.includes(s as Stage)) throw new Error(`Unknown stage: ${s}`);
  return s as Stage;
}

export function advance(ctx: Ctx, store: Store, candidateId: string, actor: string, role: string) {
  const c = store.candidate(ctx, candidateId);
  if (!c) throw new Error('Candidate not found');
  if (c.parked) throw new Error('Candidate is parked');
  const idx = STAGES.indexOf(assertStage(c.stage));
  if (idx >= STAGES.length - 1) throw new Error('Already at the final stage');
  const next = STAGES[idx + 1]!;
  store.updateCandidate(ctx, candidateId, { stage: next });
  store.audit(ctx.tenantId, actor, role, 'stage_advance', `${candidateId}:${next}`);
  return next;
}

export function park(ctx: Ctx, store: Store, candidateId: string, parked: boolean, actor: string, role: string) {
  const c = store.candidate(ctx, candidateId);
  if (!c) throw new Error('Candidate not found');
  store.updateCandidate(ctx, candidateId, { parked });
  store.audit(ctx.tenantId, actor, role, parked ? 'park' : 'unpark', candidateId);
  return parked;
}

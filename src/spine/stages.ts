/* Stage machine. Stage advances and parking are human actions (A9); agents
   suggest only. One stage per advance, exactly as the prototype behaves.

   Stages come from the tenant's hiring model (ADR-0024). The candidate stage
   is a mirror of the primary application's stage, and this is the only
   function that writes either, so the two can never drift. */
import type { Store, Ctx } from './db.ts';
import { STAGES, type Stage } from './types.ts';
import { stagesFor } from './hiring.ts';

export function assertStage(s: string, stages: Stage[] = STAGES): Stage {
  if (!stages.includes(s as Stage)) throw new Error(`Unknown stage: ${s}`);
  return s as Stage;
}

/* Advance one application by one stage. If it is the candidate's primary
   application, the candidate's stage mirror moves with it, here and only
   here. Audited as stage_advance on the application (ADR-0024). */
export function advanceApplication(ctx: Ctx, store: Store, applicationId: string, actor: string, role: string): Stage {
  const app = store.application(ctx, applicationId);
  if (!app) throw new Error('Application not found');
  if (['rejected', 'withdrawn', 'hired'].includes(app.status)) throw new Error(`Application is ${app.status}`);
  const c = store.candidate(ctx, app.candidateId);
  if (app.primary && c?.parked) throw new Error('Candidate is parked');
  const stages = stagesFor(store, ctx);
  const idx = stages.indexOf(assertStage(app.stage, stages));
  if (idx >= stages.length - 1) throw new Error('Already at the final stage');
  const next = stages[idx + 1]!;
  app.stage = next;
  app.updatedAt = new Date().toISOString();
  store.updateApplication(ctx, app);
  if (app.primary) store.updateCandidate(ctx, app.candidateId, { stage: next });
  store.audit(ctx.tenantId, actor, role, 'stage_advance', `${app.id}:${next}`);
  return next;
}

/* Advance a candidate: their primary application when they have one
   (keeping the mirror), otherwise the candidate-level stage for candidates
   who predate requisitions. */
export function advance(ctx: Ctx, store: Store, candidateId: string, actor: string, role: string) {
  const c = store.candidate(ctx, candidateId);
  if (!c) throw new Error('Candidate not found');
  if (c.parked) throw new Error('Candidate is parked');
  const primary = store.applications(ctx, { candidateId }).find(a => a.primary);
  if (primary) return advanceApplication(ctx, store, primary.id, actor, role);
  const stages = stagesFor(store, ctx);
  const idx = stages.indexOf(assertStage(c.stage, stages));
  if (idx >= stages.length - 1) throw new Error('Already at the final stage');
  const next = stages[idx + 1]!;
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

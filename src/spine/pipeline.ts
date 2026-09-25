/* Pipeline agent wiring (Addendum A0/A1). Agents produce state; dashboards
   subscribe to the event bus. A pipeline agent failure degrades
   intelligence, never the dashboard: every handler is isolated. */
import { randomUUID } from 'node:crypto';
import type { Store, Ctx } from './db.ts';
import type { Engine } from './flows/engine.ts';
import { agentConflictDetector, agentStageAdvisor, agentSessionEvaluator, agentCvAssembler, agentProfilePageAssembler } from './agents.ts';
import { makeToolContext } from './flows/tools.ts';
import type { ToolContext } from './flows/tools.ts';
import type { FlowRun } from './types.ts';

function ephemeralContext(store: Store, ctx: Ctx, candidateId: string, agent: string, tools: string[]): ToolContext {
  const run = {
    id: randomUUID(), tenantId: ctx.tenantId, flowId: 'pipeline', flowVersion: 1,
    candidateId, actorRole: 'system' as const, status: 'running' as const,
    currentStep: agent, stepStates: {}, retries: {}, error: null, trace: [],
    toolCalls: {}, createdAt: new Date().toISOString(),
  } as unknown as FlowRun;
  return makeToolContext({
    store, ctx, run, step: agent, candidateId, actor: `agent:${agent}`,
    role: 'system', seq: 0, usedKeys: new Set(), allowlist: tools,
  });
}

const evaluated = new Set<string>();

/* Returns the event handler; the server composes it with the SSE hub. */
export function pipelineHandler(store: Store, _engine: Engine):
  (tenantId: string, topic: string, payload: unknown) => void {
  return (tenantId: string, topic: string, payload: unknown) => {
    const ctx: Ctx = { tenantId };
    try {
      if (topic === 'artifact.changed') {
        const { id } = payload as { id: string };
        const art = store.artifact(ctx, id);
        if (art && art.kind === 'linkedin_snapshot' && art.quarantine !== 'rejected') {
          agentConflictDetector(ephemeralContext(store, ctx, art.candidateId, 'conflict_detector',
            ['read_spine', 'write_flag']));
        }
      }
      if (topic === 'session.changed') {
        const { id } = payload as { id: string };
        const s = store.session(ctx, id);
        if (s && s.status === 'complete' && s.mode === 'verified' && !evaluated.has(s.id)) {
          evaluated.add(s.id);
          const t1 = ephemeralContext(store, ctx, s.candidateId, 'session_evaluator',
            ['read_spine', 'write_metrics', 'annotate_transcript', 'write_flag']);
          agentSessionEvaluator(t1, s.id);
          const t2 = ephemeralContext(store, ctx, s.candidateId, 'stage_advisor',
            ['read_spine', 'suggest_stage']);
          agentStageAdvisor(t2);
        }
      }
      if (topic === 'flow.complete') {
        const { runId, flowId } = payload as { runId?: string; flowId?: string };
        if (flowId === 'resume_studio' && runId) {
          const run = store.flowRun(ctx, runId);
          if (run) {
            agentCvAssembler(ephemeralContext(store, ctx, run.candidateId, 'cv_assembler',
              ['read_spine', 'write_artifact', 'emit_event']));
            agentProfilePageAssembler(ephemeralContext(store, ctx, run.candidateId, 'profile_page_assembler',
              ['read_spine', 'write_artifact']));
          }
        }
      }
      if (topic === 'flag.changed') {
        /* Suggestions land in the recruiter review queue (suggestedGaps).
           Only a recruiter approval writes a candidate task (ADR-0007). */
      }
    } catch {
      /* A0: agent crash degrades intelligence, never the dashboard. */
    }
  };
}

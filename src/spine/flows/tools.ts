/* Tool layer (Addendum A4). Agents act only through registered tools.
   No raw SQL, no file system, no outbound network. Tool calls inherit the
   acting role's projection scope. Calls are idempotent, keyed by
   run_id + step + sequence. Unknown tools fail closed. */
import { randomUUID } from 'node:crypto';
import type { Store, Ctx } from '../db.ts';
import type { FlowRun, FlagType, StarMetrics, TranscriptTurn } from '../types.ts';
import { candidateSelfView, candidatePublic } from '../projections.ts';

export interface ToolContext {
  store: Store;
  ctx: Ctx;
  run: FlowRun;
  step: string;
  candidateId: string;
  actor: string;
  role: string;
  seq: number;
  usedKeys: Set<string>;
  allowlist?: string[];
  /* Bound helper agents use to act. Enforces the step allowlist. */
  call(name: string, args: unknown): unknown;
}

export class ToolError extends Error {}

type ToolImpl = (t: ToolContext, args: unknown) => unknown;

const tools: Record<string, ToolImpl> = {
  /* Role-scoped read. A candidate-side caller gets the candidate projection,
     wrapped in the same shape so agents never depend on role for structure. */
  read_spine(t) {
    if (t.role === 'candidate') {
      const self = candidateSelfView(t.ctx, t.store, t.candidateId);
      if (!self) throw new ToolError('candidate not found');
      return {
        candidate: { ...self },
        flags: [],
        sessions: self.sessions,
        artifacts: self.artifacts,
      };
    }
    const c = t.store.candidate(t.ctx, t.candidateId);
    if (!c) throw new ToolError('candidate not found');
    return {
      candidate: t.role === 'recruiter' ? c : candidatePublic(c),
      flags: t.store.flags(t.ctx, t.candidateId),
      sessions: t.store.sessions(t.ctx, t.candidateId).filter(s => s.mode === 'verified'),
      artifacts: t.store.artifacts(t.ctx, t.candidateId).map(a => ({
        id: a.id, kind: a.kind, title: a.title, quarantine: a.quarantine,
        fields: a.fields, content: a.content, injectionAttempts: a.injectionAttempts,
      })),
    };
  },

  write_artifact(t, args) {
    const a = args as { kind: string; title: string; content: string; clientFacing?: boolean; fields?: Record<string, unknown> };
    const existing = t.store.artifacts(t.ctx, t.candidateId).find(x => x.kind === a.kind && x.title === a.title);
    if (existing) {
      t.store.updateArtifactContent(t.ctx, existing.id, a.content);
      if (a.fields) {
        t.store.db.prepare('UPDATE artifacts SET fields = ? WHERE tenant_id = ? AND id = ?')
          .run(JSON.stringify(a.fields), t.ctx.tenantId, existing.id);
      }
      return { id: existing.id, updated: true };
    }
    const id = randomUUID();
    t.store.insertArtifact({
      id, tenantId: t.ctx.tenantId, candidateId: t.candidateId,
      kind: a.kind as never, title: a.title, quarantine: 'clean',
      fields: a.fields ?? {}, sanitizedText: null, content: a.content,
      injectionAttempts: 0, createdBy: 'system', createdAt: new Date().toISOString(),
    });
    if (a.clientFacing) {
      t.store.recordUsage({
        id: randomUUID(), tenantId: t.ctx.tenantId, kind: 'generations',
        quantity: 1, refId: t.run.id, ts: new Date().toISOString(),
      });
    }
    return { id, updated: false };
  },

  write_flag(t, args) {
    const f = args as { type: FlagType; title: string; body: string; quote?: string; status?: 'open' | 'actioned' | 'resolved' };
    const dupe = t.store.flags(t.ctx, t.candidateId)
      .find(x => x.type === f.type && x.title === f.title && x.status !== 'resolved');
    if (dupe) return { id: dupe.id, duplicate: true };
    const id = randomUUID();
    t.store.insertFlag({
      id, tenantId: t.ctx.tenantId, candidateId: t.candidateId, type: f.type,
      status: f.status ?? 'open', title: f.title, body: f.body, quote: f.quote ?? '',
      sourceRunId: t.run.id, createdAt: new Date().toISOString(),
    });
    return { id };
  },

  write_task(t, args) {
    const k = args as { type: 'task' | 'warn'; title: string; body: string; flagId?: string };
    const id = randomUUID();
    t.store.insertTask({
      id, tenantId: t.ctx.tenantId, candidateId: t.candidateId, type: k.type,
      done: false, source: 'system', title: k.title, body: k.body,
      flagId: k.flagId ?? null, createdAt: new Date().toISOString(),
    });
    return { id };
  },

  write_metrics(t, args) {
    const m = args as { sessionId: string; star: StarMetrics; ownership: number; trailing: number };
    t.store.updateSession(t.ctx, m.sessionId, {
      star: m.star, ownership: m.ownership, trailing: m.trailing, status: 'complete',
    });
    t.store.recordUsage({
      id: randomUUID(), tenantId: t.ctx.tenantId, kind: 'llm_tokens',
      quantity: 2400, refId: t.run.id, ts: new Date().toISOString(),
    });
    return { ok: true };
  },

  append_transcript(t, args) {
    const a = args as { sessionId: string; turn: TranscriptTurn };
    const s = t.store.session(t.ctx, a.sessionId);
    if (!s) throw new ToolError('session not found');
    const transcript = [...s.transcript, a.turn];
    t.store.updateSession(t.ctx, a.sessionId, { transcript });
    return { ok: true, turns: transcript.length };
  },

  annotate_transcript(t, args) {
    const a = args as { sessionId: string; annotations: Array<{ index: number; mark: string; label: string }> };
    const s = t.store.session(t.ctx, a.sessionId);
    if (!s) throw new ToolError('session not found');
    const transcript = s.transcript.map((turn, i) => {
      const annot = a.annotations.find(x => x.index === i);
      return annot ? { ...turn, annot: { mark: annot.mark, label: annot.label } } : turn;
    });
    t.store.updateSession(t.ctx, a.sessionId, { transcript });
    return { ok: true, annotated: a.annotations.length };
  },

  suggest_stage(t, args) {
    const s = args as { stage: string; rationale: string };
    /* A9: agents suggest only. A suggestion is data, never a stage change. */
    t.store.audit(t.ctx.tenantId, `agent:${t.run.flowId}`, 'system', 'stage_suggested',
      `${t.candidateId}:${s.stage}`);
    t.store.emit(t.ctx.tenantId, 'stage.suggested', { candidateId: t.candidateId, stage: s.stage });
    return { suggestion: s.stage };
  },

  emit_event(t, args) {
    const e = args as { topic: string; payload: unknown };
    t.store.emit(t.ctx.tenantId, e.topic, e.payload);
    return { ok: true };
  },
};

export function toolNames(): string[] {
  return Object.keys(tools);
}

/* Executes one tool call under the runtime's enforcement rules: allowlist
   first (fail closed), then idempotency by run_id + step + sequence. */
export function invokeTool(t: ToolContext, name: string, args: unknown): unknown {
  if (t.allowlist && !t.allowlist.includes(name)) {
    t.store.audit(t.ctx.tenantId, `agent:${t.run.flowId}`, 'system', 'tool_rejected', `${name}:not_allowed`);
    throw new ToolError(`tool not allowed for step ${t.step}: ${name}`);
  }
  const impl = tools[name];
  if (!impl) {
    t.store.audit(t.ctx.tenantId, `agent:${t.run.flowId}`, 'system', 'tool_rejected', `${name}:not_registered`);
    throw new ToolError(`tool not registered: ${name}`);
  }
  const key = `${t.run.id}:${t.step}:${t.seq++}`;
  if (t.usedKeys.has(key)) throw new ToolError(`duplicate tool call sequence: ${key}`);
  t.usedKeys.add(key);
  return impl(t, args);
}

export function makeToolContext(t: Omit<ToolContext, 'call'>): ToolContext {
  const ctx = t as ToolContext;
  ctx.call = (name: string, args: unknown) => invokeTool(ctx, name, args);
  return ctx;
}

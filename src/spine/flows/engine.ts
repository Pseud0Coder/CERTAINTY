/* Flow engine (Addendum A5). FlowRun is a state machine in code. Agents
   execute steps; they never decide transitions alone. Completion
   declarations are validated against the flow contract. Retries are
   bounded at 2, then the step fails into a visible error state with a
   human resume path. Human gates (A9) are enforced here, not in prompts. */
import { randomUUID } from 'node:crypto';
import type { Store, Ctx } from '../db.ts';
import type {
  FlowDef, FlowRun, FlowStepDef, InterviewSession, Stage, TranscriptTurn,
} from '../types.ts';
import { STAGES } from '../types.ts';
import { invokeTool, makeToolContext } from './tools.ts';
import type { ToolContext } from './tools.ts';
import { ToolError } from './tools.ts';
import { custodyPrompt } from './prompts.ts';
import { INTERACTIVE_FLOWS } from './defs.ts';
import { runContract, type ContractContext } from '../contracts.ts';
import {
  agentConflictDetector, agentStageAdvisor, agentSessionEvaluator,
  gatherResearchEvidence, writeResearchReport,
  composeSubmission, resumeStudioTurn, screenerTurn, linkedinTurn,
  type SessionState, type ResumeFields,
} from '../agents.ts';
import {
  researchFindings, intelligentResumeTurn, intelligentScreenerTurn,
  intelligentLinkedinTurn, modelExecutiveSummary,
} from '../intelligence.ts';
import { nullProvider, type LlmProvider } from '../providers/llm.ts';

/* Fallback cost model for the scripted path, which spends nothing but is
   still metered so usage projections stay comparable across providers.
   A real provider reports its own cost and overrides this. */
const TIER_COST = { cheap: 0.0000009, strong: 0.000009 };

export class FlowError extends Error {
  code: string;
  constructor(code: string, message?: string) { super(message ?? code); this.code = code; }
}

export class Engine {
  private store: Store;
  /* The model provider. Defaults to the fail-closed scripted provider, so
     constructing an Engine without one keeps the deterministic behaviour
     the tests and the offline demo depend on (ADR-0005). */
  private llm: LlmProvider;
  constructor(store: Store, llm: LlmProvider = nullProvider) {
    this.store = store;
    this.llm = llm;
  }

  /* Which producer served the most recent agent step, for tracing. */
  private lastProducer: 'model' | 'scripted' = 'scripted';

  private def(ctx: Ctx, flowId: string): FlowDef {
    const def = this.store.flowDef(ctx, flowId);
    if (!def) throw new FlowError('flow_not_found');
    if (!def.enabled) throw new FlowError('flow_disabled');
    return def;
  }

  async startRun(ctx: Ctx, opts: {
    flowId: string; candidateId: string; actorRole: string; actor: string;
    mode?: 'practice' | 'verified'; roleKey?: string;
  }): Promise<FlowRun> {
    const def = this.def(ctx, opts.flowId);
    const candidate = this.store.candidate(ctx, opts.candidateId);
    if (!candidate) throw new FlowError('candidate_not_found');
    /* One active session agent per candidate per flow (A1). Builder runs are
       not session agents; a new one supersedes the old. */
    if (INTERACTIVE_FLOWS.has(def.id)) {
      const active = this.store.flowRuns(ctx, opts.candidateId)
        .find(r => r.flowId === def.id && (r.status === 'running' || r.status === 'awaiting_human'));
      if (active) throw new FlowError('active_session_exists');
    }

    const run: FlowRun = {
      id: randomUUID(), tenantId: ctx.tenantId, flowId: def.id, flowVersion: def.version,
      candidateId: opts.candidateId, actorRole: opts.actorRole as FlowRun['actorRole'],
      status: 'running', currentStep: def.steps[0]!.id, stepStates: {}, retries: {},
      error: null, trace: [], toolCalls: {}, createdAt: new Date().toISOString(),
    };
    if (def.id === 'resume_studio') {
      const session = this.createSession(ctx, candidate.id, 'practice', null, run.id);
      run.stepStates['_session'] = session.id;
      if (opts.roleKey) {
        const roles = this.resumeFields(this.readForAgent(ctx, run)).roles ?? [];
        const idx = Number(opts.roleKey.split(':')[0]);
        const role = roles[idx];
        if (!role || `${idx}:${role.company}` !== opts.roleKey) throw new FlowError('role_not_found');
        run.stepStates['_roleKey'] = opts.roleKey;
        run.stepStates['_roleTitle'] = role.title;
      }
    }
    this.store.insertFlowRun(run);
    this.store.audit(ctx.tenantId, opts.actor, opts.actorRole, 'flow_started', `${def.id}:${run.id}`);
    /* Practice screener sessions skip the consent gate: they are private and
       never recorded (L4 applies to verified capture only). */
    if (def.id === 'interview_screener' && opts.mode === 'practice') {
      run.stepStates['_practice'] = '1';
    }
    const firstStep = def.id === 'interview_screener' && opts.mode === 'practice'
      ? def.steps[1]!
      : def.steps[0]!;
    await this.enterStep(ctx, run, def, firstStep);
    return this.store.flowRun(ctx, run.id)!;
  }

  private createSession(ctx: Ctx, candidateId: string, mode: 'practice' | 'verified',
    consentId: string | null, flowRunId: string): InterviewSession {
    const now = new Date();
    const session: InterviewSession = {
      id: randomUUID(), tenantId: ctx.tenantId, candidateId, flowRunId, mode,
      status: 'active', date: now.toISOString().slice(0, 10),
      duration: '', star: null, targets: { S: 15, T: 10, A: 50, R: 25 },
      ownership: null, trailing: null, transcript: [], debrief: null,
      consentId, createdAt: now.toISOString(),
    };
    this.store.insertSession(session);
    return session;
  }

  /* Consent gate resume (L4). No consent record, no verified recording. */
  async grantConsent(ctx: Ctx, runId: string, actor: string, scope: string): Promise<FlowRun> {
    const run = this.mustRun(ctx, runId);
    const def = this.def(ctx, run.flowId);
    const step = def.steps.find(s => s.id === run.currentStep);
    if (!step || step.kind !== 'human_gate' || step.id !== 'consent') {
      throw new FlowError('not_awaiting_consent');
    }
    const consent = {
      id: randomUUID(), tenantId: ctx.tenantId, candidateId: run.candidateId,
      sessionId: null, scope, grantedAt: new Date().toISOString(), withdrawnAt: null,
      retentionPolicy: '6 months', createdAt: new Date().toISOString(),
    };
    this.store.insertConsent(consent);
    this.store.audit(ctx.tenantId, actor, 'candidate', 'consent_granted', consent.id);
    run.stepStates['_consent'] = consent.id;
    await this.advance(ctx, run, def, step);
    return this.store.flowRun(ctx, run.id)!;
  }

  withdrawConsent(ctx: Ctx, consentId: string, actor: string): void {
    const consent = this.store.consent(ctx, consentId);
    if (!consent) throw new FlowError('consent_not_found');
    this.store.withdrawConsent(ctx, consentId);
    this.store.audit(ctx.tenantId, actor, 'candidate', 'consent_withdrawn', consentId);
    /* Withdrawal stops the recording and flags downstream artifacts. */
    const sessions = this.store.sessions(ctx, consent.candidateId)
      .filter(s => s.consentId === consentId && s.status === 'active');
    for (const s of sessions) {
      this.store.updateSession(ctx, s.id, { status: 'stopped' });
      this.store.insertFlag({
        id: randomUUID(), tenantId: ctx.tenantId, candidateId: consent.candidateId,
        type: 'source_conflict', status: 'open',
        title: 'Consent withdrawn mid-session',
        body: 'The candidate withdrew consent during a verified session. Recording stopped. Downstream artifacts are flagged for review.',
        quote: '', sourceRunId: null, createdAt: new Date().toISOString(),
      });
    }
  }

  /* One conversational turn into an interactive session agent. */
  async turn(ctx: Ctx, runId: string, text: string, actor: string): Promise<{ run: FlowRun; reply: string }> {
    const run = this.mustRun(ctx, runId);
    if (run.status !== 'running') throw new FlowError(`run_not_running:${run.status}`);
    const def = this.def(ctx, run.flowId);
    const step = def.steps.find(s => s.id === run.currentStep);
    if (!step || step.kind !== 'agent' || !step.interactive) throw new FlowError('step_not_interactive');

    const started = Date.now();
    const state: SessionState = run.stepStates[`state:${step.id}`]
      ? JSON.parse(run.stepStates[`state:${step.id}`]!) : { phase: 'open', areas: [], probeIndex: 0 };
    const spine = this.readForAgent(ctx, run);
    const jd = spine.artifacts.find(a => a.kind === 'jd' && a.quarantine !== 'rejected');
    const mustHave = ((jd?.fields as { mustHave?: string[] })?.mustHave ?? []);
    const resume = this.resumeFields(spine);

    /* Session agents run through the intelligence layer, which wraps the
       scripted state machine: sequencing, depth targets and the completion
       declaration stay deterministic, wording comes from the model when one
       is configured. A model failure inside returns the scripted turn, so
       this call cannot fail for provider reasons. */
    const candidate = this.store.candidate(ctx, run.candidateId);
    const targetRole = candidate?.targetRole ?? '';

    let reply: string; let nextState: SessionState; let declaration: unknown;
    this.lastProducer = 'scripted';
    if (step.agent === 'screener_interviewer') {
      const isAnswer = state.phase === 'asked';
      const r = await intelligentScreenerTurn(this.llm, state, mustHave, text, isAnswer,
        { resume, targetRole });
      reply = r.reply; nextState = r.state; declaration = r.declareComplete;
      this.lastProducer = r.producer;
      nextState.phase = 'asked';
    } else if (step.agent === 'resume_interviewer') {
      state.role = state.role ?? run.stepStates['_roleTitle'];
      const r = await intelligentResumeTurn(this.llm, state, { roles: resume.roles ?? [] },
        text, run.stepStates['_roleKey']);
      reply = r.reply; nextState = r.state; declaration = r.declareComplete;
      this.lastProducer = r.producer;
    } else if (step.agent === 'linkedin_writer') {
      const r = await intelligentLinkedinTurn(this.llm, state, resume, text);
      reply = r.reply; nextState = r.state; declaration = r.declareComplete;
      this.lastProducer = r.producer;
    } else throw new FlowError('no_session_agent');

    const sessionId = run.stepStates['_session'];
    if (sessionId) {
      if (text.trim()) this.appendTurn(ctx, sessionId, { t: this.timecode(ctx, sessionId), who: 'Candidate', text });
      this.appendTurn(ctx, sessionId, { t: this.timecode(ctx, sessionId), who: 'Interviewer', text: reply });
    }

    run.stepStates[`state:${step.id}`] = JSON.stringify(nextState);
    this.trace(ctx, run, step, `turn:${text.slice(0, 24)}`, { reply: reply.slice(0, 64) }, step.modelTier ?? 'cheap',
      Date.now() - started);

    if (declaration) {
      const ok = this.validateDeclaration(ctx, run, step, declaration);
      if (!ok) {
        this.bumpRetry(ctx, run, step, 'completion declaration failed validation');
        this.store.updateFlowRun(ctx, run.id, { stepStates: run.stepStates, retries: run.retries });
        return { run: this.store.flowRun(ctx, run.id)!, reply };
      }
      await this.finishSessionStep(ctx, run, step, declaration, nextState);
    }
    this.store.updateFlowRun(ctx, run.id, { stepStates: run.stepStates });
    return { run: this.store.flowRun(ctx, run.id)!, reply };
  }

  private async finishSessionStep(ctx: Ctx, run: FlowRun, step: FlowStepDef, declaration: unknown, state: SessionState): Promise<void> {
    const def = this.def(ctx, run.flowId);
    run.stepStates[`out:${step.id}`] = JSON.stringify(declaration);
    if (step.agent === 'resume_interviewer' && declaration && typeof declaration === 'object' && 'bullets' in declaration) {
      const bullets = (declaration as { bullets: number }).bullets;
      if (bullets > 0) await this.advance(ctx, run, def, step);
      return;
    }
    if (step.agent === 'screener_interviewer' && declaration && typeof declaration === 'object' && 'debrief' in declaration) {
      const d = declaration as { debrief: string; questions: number };
      const sessionId = run.stepStates['_session'];
      if (sessionId) this.store.updateSession(ctx, sessionId, { debrief: d.debrief, duration: this.durationOf(ctx, sessionId) });
      await this.advance(ctx, run, def, step);
      return;
    }
    if (step.agent === 'linkedin_writer') {
      this.complete(ctx, run, def);
      return;
    }
    this.advance(ctx, run, def, step);
  }

  /* Human gate resume: recruiter or candidate click. */
  async resume(ctx: Ctx, runId: string, actor: string, role: string, action: string): Promise<FlowRun> {
    const run = this.mustRun(ctx, runId);
    const def = this.def(ctx, run.flowId);
    const step = def.steps.find(s => s.id === run.currentStep);
    if (!step || step.kind !== 'human_gate') throw new FlowError('not_awaiting_human');
    this.store.audit(ctx.tenantId, actor, role, 'human_gate', `${run.flowId}:${step.id}:${action}`);
    this.advance(ctx, run, def, step);
    return this.store.flowRun(ctx, run.id)!;
  }

  private async enterStep(ctx: Ctx, run: FlowRun, def: FlowDef, step: FlowStepDef): Promise<void> {
    run.currentStep = step.id;
    run.status = 'running';
    this.store.updateFlowRun(ctx, run.id, { currentStep: step.id, status: 'running', stepStates: run.stepStates });
    if (step.kind === 'human_gate') {
      run.status = 'awaiting_human';
      this.store.updateFlowRun(ctx, run.id, { status: 'awaiting_human' });
      this.store.emit(ctx.tenantId, 'flow.awaiting_human', { runId: run.id, step: step.id });
      return;
    }
    if (step.kind === 'auto') { await this.runAutoStep(ctx, run, def, step); return; }
    if (step.kind === 'agent' && !step.interactive) { await this.runAgentStep(ctx, run, def, step); return; }
    /* Interactive agent steps wait for turns. */
  }

  private async runAutoStep(ctx: Ctx, run: FlowRun, def: FlowDef, step: FlowStepDef): Promise<void> {
    if (step.id === 'intake') {
      /* Submission Builder intake check: resume required, 4 of 4 gates compose. */
      const arts = this.store.artifacts(ctx, run.candidateId)
        .filter(a => a.quarantine !== 'rejected');
      const have = {
        resume: arts.some(a => a.kind === 'resume'),
        transcript: arts.some(a => a.kind === 'transcript'),
        linkedin_snapshot: arts.some(a => a.kind === 'linkedin_snapshot'),
        jd: arts.some(a => a.kind === 'jd'),
      };
      const count = Object.values(have).filter(Boolean).length;
      run.stepStates['intake'] = JSON.stringify({ have, count });
      if (count === 4) { await this.advance(ctx, run, def, step); return; }
      run.stepStates['compose_blocked'] = JSON.stringify({ count, need: 4 - count });
      this.store.updateFlowRun(ctx, run.id, { stepStates: run.stepStates, status: 'awaiting_human' });
      this.store.emit(ctx.tenantId, 'flow.awaiting_sources', { runId: run.id, count });
      return;
    }
    if (step.id === 'open_session') {
      const practice = def.id === 'interview_screener'
        ? run.stepStates['_practice'] === '1'
        : true;
      const mode: 'practice' | 'verified' = practice ? 'practice' : 'verified';
      const consentId = run.stepStates['_consent'] ?? null;
      if (mode === 'verified' && !consentId) throw new FlowError('consent_required');
      const session = this.createSession(ctx, run.candidateId, mode, consentId, run.id);
      run.stepStates['_session'] = session.id;
      await this.advance(ctx, run, def, step);
      return;
    }
    await this.advance(ctx, run, def, step);
  }

  private async runAgentStep(ctx: Ctx, run: FlowRun, def: FlowDef, step: FlowStepDef): Promise<void> {
    const t = this.toolContext(ctx, run, step);
    const started = Date.now();
    let output: unknown;
    let prompt: { version: number; body: string } | null = null;
    this.lastProducer = 'scripted';
    try {
      prompt = custodyPrompt(this.store, def.id as never, step.agent!);
      switch (step.agent) {
        /* Verification and measurement: deterministic by design. A model
           does not get a vote on whether two dates conflict or on what a
           STAR ratio is (ADR-0012). */
        case 'conflict_detector': output = agentConflictDetector(t); break;
        case 'session_evaluator': output = agentSessionEvaluator(t, run.stepStates['_session']); break;
        case 'stage_advisor': output = agentStageAdvisor(t); break;
        case 'resume_handoff': output = agentResumeHandoff(t); break;

        /* Language and judgment: model first, scripted fallback. */
        case 'submission_composer': {
          const composed = await agentSubmissionComposer(t, this.llm);
          this.lastProducer = composed.producer;
          output = composed.output;
          break;
        }
        case 'research_analyst': {
          const ev = gatherResearchEvidence(t);
          const { findings, producer } = await researchFindings(this.llm, ev);
          this.lastProducer = producer;
          output = writeResearchReport(t, ev, findings);
          break;
        }
        default: throw new FlowError('no_agent:' + step.agent);
      }
    } catch (e) {
      if (e instanceof FlowError) { this.failRun(ctx, run, step, e.message); return; }
      if (e instanceof ToolError) { this.bumpRetry(ctx, run, step, e.message); return; }
      throw e;
    }
    this.trace(ctx, run, step, prompt?.body.length ?? 0, output, step.modelTier ?? 'cheap',
      Date.now() - started);

    /* A7: schema validation then deterministic post-processors. */
    const c = this.contractCtx(ctx, run.candidateId, step.outputSchema === 'submission_deliverable');
    const clientPart = (output as { client?: unknown }).client ?? output;
    const internalPart = (output as { internal?: unknown }).internal;
    const clientCheck = runContract(clientPart, { ...c, clientFacing: step.outputSchema === 'submission_deliverable' });
    const internalCheck = internalPart !== undefined ? runContract(internalPart, { ...c, clientFacing: false }) : { ok: true, errors: [] };
    if (!clientCheck.ok || !internalCheck.ok) {
      this.bumpRetry(ctx, run, step, `output contract failed: ${[...clientCheck.errors, ...internalCheck.errors].join('; ')}`);
      return;
    }
    run.stepStates = { ...run.stepStates, [`out:${step.id}`]: JSON.stringify(output) };
    run.toolCalls = { ...run.toolCalls, ...Object.fromEntries([...t.usedKeys].map(k => [k, true])) };
    this.store.updateFlowRun(ctx, run.id, { stepStates: run.stepStates, toolCalls: run.toolCalls });
    this.advance(ctx, run, def, step);
  }

  /* ---- helpers shared by agent paths ---- */
  private toolContext(ctx: Ctx, run: FlowRun, step: FlowStepDef): ToolContext {
    return makeToolContext({
      store: this.store, ctx, run, step: step.id, candidateId: run.candidateId,
      actor: `agent:${step.agent}`, role: run.actorRole, seq: run.trace.length,
      usedKeys: new Set(Object.keys(run.toolCalls)), allowlist: step.tools,
    });
  }

  private readForAgent(ctx: Ctx, run: FlowRun) {
    const t = this.toolContext(ctx, run, { id: 'read', kind: 'agent', description: '' });
    return invokeTool(t, 'read_spine', {}) as {
      candidate: Record<string, unknown>;
      artifacts: Array<{ kind: string; quarantine: string; fields: Record<string, unknown> }>;
    };
  }

  private resumeFields(spine: { artifacts: Array<{ kind: string; fields: Record<string, unknown> }> }): ResumeFields {
    const res = spine.artifacts.find(a => a.kind === 'resume');
    return (res?.fields as unknown as ResumeFields) ?? { positioning: '', location: '', phone: '', email: '', roles: [], skills: [], tools: [], education: [] };
  }

  private contractCtx(ctx: Ctx, candidateId: string, clientFacing: boolean): ContractContext {
    const c = this.store.candidate(ctx, candidateId)!;
    return {
      clientFacing, currentCompensation: c.currentCompensation,
      cvTenureStart: c.cvTenureStart, cvTenureEnd: c.cvTenureEnd,
    };
  }

  private validateDeclaration(ctx: Ctx, run: FlowRun, step: FlowStepDef, declaration: unknown): boolean {
    const d = declaration as Record<string, unknown>;
    switch (step.completeWhen) {
      case 'era_bullet_count':
        return typeof d.bullets === 'number' && d.bullets >= 2;
      case 'six_sections':
        return d.sections === 6;
      default:
        return true;
    }
  }

  private bumpRetry(ctx: Ctx, run: FlowRun, step: FlowStepDef, reason: string): void {
    const n = (run.retries[step.id] ?? 0) + 1;
    run.retries[step.id] = n;
    /* A retry re-executes the step, so its earlier tool call keys are reset. */
    for (const k of Object.keys(run.toolCalls)) {
      if (k.startsWith(`${run.id}:${step.id}:`)) delete run.toolCalls[k];
    }
    this.store.updateFlowRun(ctx, run.id, { retries: run.retries, toolCalls: run.toolCalls });
    this.store.audit(ctx.tenantId, `agent:${step.agent}`, 'system', 'step_retry', `${run.flowId}:${step.id}:${reason}`);
    if (n >= 2) this.failRun(ctx, run, step, reason);
  }

  private failRun(ctx: Ctx, run: FlowRun, step: FlowStepDef, reason: string): void {
    run.status = 'failed';
    run.error = `${step.id}: ${reason}`;
    this.store.updateFlowRun(ctx, run.id, { status: 'failed', error: run.error });
    this.store.emit(ctx.tenantId, 'flow.failed', { runId: run.id, error: run.error });
    /* A5: visible error state with a human resume path. */
    this.store.audit(ctx.tenantId, 'system', 'system', 'flow_failed', `${run.id}:${reason}`);
  }

  /* Human resume path for a failed run: reset the failing step. */
  async retryFailed(ctx: Ctx, runId: string, actor: string, role: string): Promise<FlowRun> {
    const run = this.mustRun(ctx, runId);
    if (run.status !== 'failed') throw new FlowError('not_failed');
    const def = this.def(ctx, run.flowId);
    const step = def.steps.find(s => s.id === run.currentStep)!;
    run.retries[step.id] = 0;
    run.error = null;
    this.store.audit(ctx.tenantId, actor, role, 'flow_resumed', run.id);
    await this.enterStep(ctx, run, def, step);
    return this.store.flowRun(ctx, run.id)!;
  }

  private nextStep(def: FlowDef, current: FlowStepDef): FlowStepDef {
    const i = def.steps.findIndex(s => s.id === current.id);
    if (i < 0 || i >= def.steps.length - 1) throw new FlowError('flow_exhausted');
    return def.steps[i + 1]!;
  }

  /* Advance from a completed step. Completing the last step completes the run. */
  private async advance(ctx: Ctx, run: FlowRun, def: FlowDef, current: FlowStepDef): Promise<void> {
    const i = def.steps.findIndex(s => s.id === current.id);
    if (i < 0 || i >= def.steps.length - 1) { this.complete(ctx, run, def); return; }
    await this.enterStep(ctx, run, def, def.steps[i + 1]!);
  }

  private complete(ctx: Ctx, run: FlowRun, def: FlowDef): void {
    run.status = 'complete';
    this.store.updateFlowRun(ctx, run.id, { status: 'complete' });
    this.store.audit(ctx.tenantId, 'system', 'system', 'flow_complete', `${def.id}:${run.id}`);
    this.store.emit(ctx.tenantId, 'flow.complete', { runId: run.id, flowId: def.id });
  }

  private appendTurn(ctx: Ctx, sessionId: string, turn: TranscriptTurn): void {
    const s = this.store.session(ctx, sessionId);
    if (!s) return;
    this.store.updateSession(ctx, sessionId, { transcript: [...s.transcript, turn] });
  }

  private timecode(ctx: Ctx, sessionId: string): string {
    const s = this.store.session(ctx, sessionId);
    const n = (s?.transcript.length ?? 0);
    const total = 41 + n * 37;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  private durationOf(ctx: Ctx, sessionId: string): string {
    const s = this.store.session(ctx, sessionId);
    const turns = s?.transcript.length ?? 0;
    const secs = Math.min(842, 120 + turns * 42);
    return `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  }

  private trace(ctx: Ctx, run: FlowRun, step: FlowStepDef, input: unknown, output: unknown,
    tier: 'cheap' | 'strong', latencyMs = 12): void {
    const tokens = Math.ceil(JSON.stringify({ input, output }).length / 4);
    /* The trace names the producer that actually served the step, so the
       admin flow inspector distinguishes a model answer from a fallback.
       L3: the prompt length is recorded, never the prompt body. */
    const model = this.lastProducer === 'model' ? `${this.llm.name}:${tier}` : `scripted-${tier}`;
    const entry = {
      seq: run.trace.length, step: step.id, tool: null, input, output,
      model, latencyMs, costUsd: tokens * TIER_COST[tier],
      ts: new Date().toISOString(),
    };
    run.trace.push(entry);
    this.store.updateFlowRun(ctx, run.id, { trace: run.trace });
    this.store.recordUsage({
      id: randomUUID(), tenantId: ctx.tenantId, kind: 'llm_tokens',
      quantity: tokens, refId: run.id, ts: new Date().toISOString(),
    });
  }

  private mustRun(ctx: Ctx, runId: string): FlowRun {
    const run = this.store.flowRun(ctx, runId);
    if (!run) throw new FlowError('run_not_found');
    return run;
  }
}

/* Submission composer agent: builds the three deliverables and the QA
   checklist from spine evidence. Reads through the projection-scoped tool. */
export async function agentSubmissionComposer(t: ToolContext, llm: LlmProvider = nullProvider):
  Promise<{ output: unknown; producer: 'model' | 'scripted' }> {
  const spine = invokeTool(t, 'read_spine', {}) as {
    candidate: Record<string, unknown>;
    artifacts: Array<{ kind: string; fields: Record<string, unknown> }>;
    flags: Array<{ type: string; status: string; title: string; body: string }>;
    sessions: Array<{ star: unknown; status: string }>;
  };
  const cand = spine.candidate as unknown as {
    name: string; targetRole: string; employer: string; tenure: string;
    compExpectations: string | null;
    currentCompensation: string | null; noticePeriod: string | null; motivation: string | null;
  };
  const resume = (spine.artifacts.find(a => a.kind === 'resume')?.fields ?? null) as unknown as ResumeFields;
  const confirmed = spine.sessions.some(s => s.status === 'complete');
  const conflicts = spine.flags.filter(f => f.type === 'source_conflict' && f.status !== 'resolved').map(f => f.body);
  const gaps = spine.flags.filter(f => f.type === 'jd_gap' && f.status !== 'resolved').map(f => f.title);
  const claims = spine.flags.filter(f => f.type === 'claim_missing_from_cv' && f.status !== 'resolved').map(f => f.title);

  /* The executive summary is the one genuinely written part of the
     deliverable. Everything else here is assembly from the spine and stays
     deterministic. A null summary keeps the scripted five-part framework,
     so the QA checklist's five-bullet assertion holds either way. */
  const summaryOverride = await modelExecutiveSummary(llm, {
    name: cand.name, targetRole: cand.targetRole, resume,
    confirmedMetric: confirmed ? 'the verified session' : null,
  });

  const out = composeSubmission({
    candidate: cand,
    resume,
    confirmedMetric: confirmed ? 'the verified session' : null,
    conflicts, gaps, toVerify: claims,
    summaryOverride: summaryOverride ?? undefined,
  });
  /* Deliverables land in the spine as artifacts (A0: agents produce state). */
  invokeTool(t, 'write_artifact', { kind: 'submission_doc', title: `Candidate Introduction - ${cand.name} - ${cand.targetRole}`, content: out.doc, clientFacing: true });
  invokeTool(t, 'write_artifact', { kind: 'client_email', title: 'Client email draft', content: out.email, clientFacing: true });
  invokeTool(t, 'write_artifact', { kind: 'recruiter_notes', title: 'Recruiter notes', content: out.notes, clientFacing: false });
  return {
    output: {
      client: { doc: out.doc, email: out.email },
      internal: { notes: out.notes },
      qa: out.qa,
    },
    producer: summaryOverride ? 'model' : 'scripted',
  };
}

/* Resume handoff agent: bullets as a text block artifact. Never spoken. */
export function agentResumeHandoff(t: ToolContext): unknown {
  const run = t.run;
  const stateRaw = run.stepStates['state:interview'];
  if (!stateRaw) throw new FlowError('no_handoff_state');
  const state = JSON.parse(stateRaw) as SessionState;
  const roleKey = run.stepStates['_roleKey'] ?? '';
  const bullets = state.areas.map(a => a.bullet);
  const block = bullets.map((b, i) => `${i + 1}. ${b}`).join('\n');
  invokeTool(t, 'write_artifact', {
    kind: 'handoff_block',
    title: `Your bullets: ${run.stepStates['_roleTitle'] ?? 'this role'}`,
    content: block,
    fields: { roleKey, bullets },
  });
  return { handoff: block, bullets: state.areas.length };
}

export { agentStageAdvisor };

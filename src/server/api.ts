/* HTTP API. Role-projected responses only (L2). Tenant id always comes from
   the session, never from client input (L9). Mutations are audited (L6). */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Store, Ctx } from '../spine/db.ts';
import type { Engine } from '../spine/flows/engine.ts';
import { FlowError } from '../spine/flows/engine.ts';
import type { User, Role } from '../spine/types.ts';
import { STAGES } from '../spine/types.ts';
import {
  assertNoInternalFields, candidateSelfView, recruiterCandidateView, candidatePublic,
} from '../spine/projections.ts';
import { advance, park } from '../spine/stages.ts';
import { quarantine } from '../spine/quarantine.ts';
import { assertModule, MODULES, invoice } from '../spine/billing.ts';
import {
  livekitConfigFromEnv, voiceChain, mintVoiceToken, verifyVoiceWebhook,
  ingestVoicePayload, VoiceError,
} from './livekit.ts';
import { applyRetention, gdprErase, gdprExport } from '../spine/retention.ts';
import { provisionCandidate } from '../spine/profile.ts';
import { journeyState } from '../spine/journey.ts';
import { login, logout, loginRateLimited, recordFailure, clearFailures } from './auth.ts';
import { randomUUID } from 'node:crypto';
import { extractDocument, decodeUpload, DocumentError, MAX_DOCUMENT_BYTES } from '../spine/documents.ts';
import {
  PROVIDERS, ConnectorError, normalizeUsername, verificationCode, fetchSnapshot, bioHasCode, profileUrl,
  type Provider, type FetchLike,
} from '../spine/connectors.ts';
import { connectorStates, profileInsight } from '../spine/insight.ts';
import { hashPassword, verifyPassword } from '../spine/seed.ts';

export class ApiError extends Error {
  status: number; code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}

/* `fetch` is injectable so connector tests never touch the network. */
export interface ApiDeps { store: Store; engine: Engine; fetch?: FetchLike }

interface ReqCtx {
  deps: ApiDeps; user: User; csrf: string; ctx: Ctx;
  params: Record<string, string>; body: any;
  query: (k: string) => string | null;
  send: (status: number, data: unknown) => void;
}

type Handler = (r: ReqCtx) => Promise<void> | void;

const routes: Array<{ method: string; re: RegExp; roles: Role[] | null; handler: Handler; maxBody: number }> = [];
const DEFAULT_MAX_BODY = 2_000_000;
/* Base64 inflates by a third; document routes get room for one file. */
const UPLOAD_MAX_BODY = Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4 + 64_000;
function route(method: string, pattern: string, roles: Role[] | null, handler: Handler, opts: { maxBody?: number } = {}): void {
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$');
  routes.push({ method, re, roles, handler, maxBody: opts.maxBody ?? DEFAULT_MAX_BODY });
}

/* ---------- helpers ---------- */
function candidateIdFor(r: ReqCtx, asked?: string): string {
  if (r.user.role === 'candidate') {
    const c = r.deps.store.candidateByUser(r.ctx, r.user.id);
    if (!c) throw new ApiError(404, 'no_candidate_record');
    return c.id;
  }
  return asked ?? '';
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionToken(req: IncomingMessage): string | null {
  return parseCookies(req)['certainty_s'] ?? null;
}

function checkCsrf(req: IncomingMessage, csrf: string): void {
  const cookie = parseCookies(req)['certainty_csrf'];
  const header = req.headers['x-csrf'];
  if (!cookie || cookie !== csrf || header !== csrf) throw new ApiError(403, 'csrf');
}

/* ---------- auth ---------- */
export async function handleAuth(req: IncomingMessage, res: ServerResponse, deps: ApiDeps,
  url: URL, send: (s: number, d: unknown) => void): Promise<boolean> {
  const body = await readBody(req);
  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    const ip = req.socket.remoteAddress ?? 'unknown';
    if (loginRateLimited(ip)) { send(429, { error: 'too_many_attempts' }); return true; }
    const result = login(deps.store, String(body?.email ?? ''), String(body?.password ?? ''));
    if (!result) {
      recordFailure(ip);
      send(401, { error: 'invalid_credentials' });
      return true;
    }
    clearFailures(ip);
    deps.store.audit(result.user.tenantId, result.user.displayName, result.user.role, 'login', result.user.id);
    res.setHeader('Set-Cookie', [
      `certainty_s=${result.token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=43200`,
      `certainty_csrf=${result.csrf}; Path=/; SameSite=Lax; Max-Age=43200`,
    ]);
    send(200, { user: { id: result.user.id, email: result.user.email, role: result.user.role, displayName: result.user.displayName, tenantId: result.user.tenantId } });
    return true;
  }
  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    const token = sessionToken(req);
    if (token) logout(token);
    res.setHeader('Set-Cookie', 'certainty_s=; HttpOnly; Path=/; Max-Age=0');
    send(200, { ok: true });
    return true;
  }
  return false;
}

/* ---------- public (unauthenticated) ---------- */
/* No session, so no tenant to scope by: the artifact id in the path is
   itself the capability token (see Store.publicProfilePage). Kept
   entirely separate from the authenticated route table below it. */
export function handlePublicProfile(deps: ApiDeps, url: URL, send: (s: number, d: unknown) => void,
  auth: { user: User } | null = null): boolean {
  if (url.pathname === '/api/public/config') {
    /* Demo affordances (the demo account list on the login page) are on
       unless a deployment turns them off with CERTAINTY_DEMO=off. */
    send(200, { demo: process.env.CERTAINTY_DEMO !== 'off' });
    return true;
  }
  const m = /^\/api\/public\/profile\/([^/]+)$/.exec(url.pathname);
  if (!m) return false;
  const page = deps.store.publicProfilePage(m[1]!);
  if (!page) { send(404, { error: 'not_found' }); return true; }
  /* A link works only while the candidate's approval stands and has not
     expired; revoked and expired links answer like missing ones. */
  const ctx = { tenantId: page.tenantId };
  /* The candidate (and their agency) can preview a page before approving
     it; to anyone else an unapproved page does not exist. */
  const insider = !!auth && auth.user.tenantId === page.tenantId && (
    auth.user.role !== 'candidate' || deps.store.candidateByUser(ctx, auth.user.id)?.id === page.candidateId);
  const live = shareIsLive(page.fields);
  if (!live && !insider) { send(410, { error: 'link_inactive' }); return true; }
  const cv = deps.store.artifacts(ctx, page.candidateId, 'cv').at(-1);
  const insight = profileInsight(deps.store, ctx, page.candidateId);
  const fields = { ...page.fields };
  delete (fields as Record<string, unknown>).share;
  send(200, { profile: fields, insight, cv: cv ? cv.fields : null, tenantName: deps.store.tenantName(ctx), preview: !live });
  return true;
}

interface ShareState { enabled: boolean; approvedAt: string | null; expiresAt: string | null }
const SHARE_DAYS = 30;
function shareOf(fields: Record<string, unknown>): ShareState {
  const s = fields.share as Partial<ShareState> | undefined;
  return { enabled: !!s?.enabled, approvedAt: s?.approvedAt ?? null, expiresAt: s?.expiresAt ?? null };
}
function shareIsLive(fields: Record<string, unknown>): boolean {
  const s = shareOf(fields);
  return s.enabled && !!s.expiresAt && Date.parse(s.expiresAt) > Date.now();
}
const PASSWORD_GATE_ALLOWED = new Set(['/api/me', '/api/auth/password']);

/* Raw body for signature verification. The webhook never goes through the
   generic JSON path: the signature covers the exact bytes. */
function readRawBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_000_000) { reject(new ApiError(413, 'too_large')); req.destroy(); return; }
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function handleVoiceWebhook(req: IncomingMessage, deps: ApiDeps,
  send: (status: number, data: unknown) => void): Promise<void> {
  const cfg = livekitConfigFromEnv();
  if (!cfg) { send(503, { error: 'livekit_not_configured' }); return; }
  let raw: string;
  try {
    raw = await readRawBody(req);
  } catch {
    send(413, { error: 'too_large' });
    return;
  }
  const authHeader = req.headers['authorization'] as string | undefined;
  const event = await verifyVoiceWebhook(cfg, raw, authHeader);
  if (!event) { send(401, { error: 'invalid_signature' }); return; }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    send(400, { error: 'bad_json' });
    return;
  }
  try {
    const result = ingestVoicePayload(deps.store, body);
    send(200, { success: true, ingested: result.ingested });
  } catch (e) {
    if (e instanceof VoiceError) {
      const status = e.code === 'missing_candidate_id' ? 400
        : e.code === 'candidate_not_found' ? 404 : 409;
      send(status, { error: e.code });
      return;
    }
    console.error('voice webhook error', e);
    send(500, { error: 'internal' });
  }
}

function readBody(req: IncomingMessage, limit = DEFAULT_MAX_BODY): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > limit) { reject(new ApiError(413, 'too_large')); req.destroy(); } });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new ApiError(400, 'bad_json')); }
    });
    req.on('error', reject);
  });
}

/* ---------- routes: shared ---------- */
route('GET', '/api/me', null, r => {
  const store = r.deps.store;
  let candidateId: string | null = null;
  if (r.user.role === 'candidate') {
    candidateId = store.candidateByUser(r.ctx, r.user.id)?.id ?? null;
  }
  const entitlements = store.entitlements(r.ctx.tenantId).filter(e => e.enabled).map(e => e.module);
  r.send(200, {
    user: { id: r.user.id, email: r.user.email, role: r.user.role, displayName: r.user.displayName, tenantId: r.user.tenantId,
      mustChangePassword: !!r.user.mustChangePassword },
    tenantName: store.tenantName(r.ctx), candidateId, entitlements, stages: STAGES,
  });
});

route('GET', '/api/events', null, () => { /* handled by SSE hub before routing */ });

/* Any signed-in user can change their password; a recruiter-generated one
   must be changed before anything else works (PASSWORD_GATE_ALLOWED). */
route('POST', '/api/auth/password', null, r => {
  const current = String(r.body?.current ?? '');
  const next = String(r.body?.next ?? '');
  if (!verifyPassword(current, r.user.passwordHash)) throw new ApiError(403, 'wrong_password');
  if (next.length < 10) throw new ApiError(400, 'password_too_short');
  if (next === current) throw new ApiError(400, 'password_unchanged');
  r.deps.store.setPassword(r.user.id, hashPassword(next), false);
  r.deps.store.audit(r.ctx.tenantId, r.user.displayName, r.user.role, 'password_changed', r.user.id);
  r.send(200, { ok: true });
});

/* ---------- recruiter: pipeline and candidates ---------- */
route('POST', '/api/recruiter/candidates', ['recruiter', 'admin'], r => {
  assertModule(r.deps.store, r.ctx.tenantId, 'pipeline');
  try {
    const result = provisionCandidate(r.deps.store, r.ctx, {
      email: String(r.body?.email ?? ''),
      name: String(r.body?.name ?? ''),
      targetRole: String(r.body?.targetRole ?? ''),
      targetCompany: r.body?.targetCompany ? String(r.body.targetCompany) : null,
    }, r.user.displayName);
    /* The client's job description belongs to the recruiter, so it is
       attached here and the candidate is never asked for it. */
    const jd = String(r.body?.jd ?? '').trim();
    if (jd) {
      quarantine(r.deps.store, r.ctx, { candidateId: result.candidate.id, kind: 'jd', title: 'Client job description', raw: jd, createdBy: r.user.id });
    }
    /* The generated password is returned exactly once, for the recruiter to
       hand over. It is temporary: the candidate replaces it at first login. */
    r.send(200, { candidateId: result.candidate.id, credentials: result.credentials });
  } catch (e) {
    const code = e instanceof Error ? e.message : 'provision_failed';
    r.send(code === 'email_exists' ? 409 : 400, { error: code });
  }
});

route('GET', '/api/recruiter/candidates/:id/journey', ['recruiter', 'admin'], r => {
  const view = journeyState(r.deps.store, r.ctx, r.params.id!);
  r.send(200, { journey: view });
});

route('GET', '/api/recruiter/pipeline', ['recruiter', 'admin'], r => {
  assertModule(r.deps.store, r.ctx.tenantId, 'pipeline');
  const store = r.deps.store;
  const candidates = store.candidates(r.ctx).map(c => {
    const flags = store.flags(r.ctx, c.id);
    return {
      ...candidatePublic(c),
      openFlags: flags.filter(f => f.status === 'open').length,
      verifyFlags: flags.filter(f => f.type === 'source_conflict' && f.status === 'open').length,
    };
  });
  const suggestions = store.flowRuns(r.ctx)
    .filter(run => run.stepStates['out:suggest'])
    .map(run => ({ candidateId: run.candidateId, stage: (JSON.parse(run.stepStates['out:suggest']!) as { suggestion: string }).suggestion }));
  r.send(200, { candidates, stages: STAGES, suggestions });
});

route('GET', '/api/recruiter/candidates/:id', ['recruiter', 'admin'], r => {
  const view = recruiterCandidateView(r.ctx, r.deps.store, r.params.id!);
  if (!view) throw new ApiError(404, 'not_found');
  const suggestionRun = r.deps.store.flowRuns(r.ctx, r.params.id!)
    .find(run => run.stepStates['out:suggest']);
  r.send(200, {
    ...view,
    suggestion: suggestionRun ? (JSON.parse(suggestionRun.stepStates['out:suggest']!) as { suggestion: string }).suggestion : null,
  });
});

route('POST', '/api/recruiter/candidates/:id/advance', ['recruiter', 'admin'], r => {
  const stage = advance(r.ctx, r.deps.store, r.params.id!, r.user.displayName, r.user.role);
  r.send(200, { stage });
});

route('POST', '/api/recruiter/candidates/:id/park', ['recruiter', 'admin'], r => {
  const parked = park(r.ctx, r.deps.store, r.params.id!, true, r.user.displayName, r.user.role);
  r.send(200, { parked });
});
route('POST', '/api/recruiter/candidates/:id/restore', ['recruiter', 'admin'], r => {
  const parked = park(r.ctx, r.deps.store, r.params.id!, false, r.user.displayName, r.user.role);
  r.send(200, { parked });
});

/* SuggestedGaps: AI-proposed improvements wait for recruiter approval.
   Only an approval writes a candidate task (ADR-0007). */
const SUGGESTION_PHRASING: Record<string, (title: string, body: string) => { title: string; body: string; type: 'task' | 'warn' }> = {
  claim_missing_from_cv: (title, body) => ({
    type: 'task', title: 'Add the missing line to your CV',
    body: `${body} Your recruiter agrees, it is earned.`,
  }),
  jd_gap: (title, body) => ({
    type: 'task', title: `Build a story for: ${title}`,
    body: `This appears in your target role requirements. Build a story you can evidence.`,
  }),
  source_conflict: (_title, body) => ({
    type: 'warn', title: 'Align your dates',
    body,
  }),
  metric_confirmed: (title) => ({
    type: 'task', title: `Make sure this is on your CV: ${title}`,
    body: 'This is confirmed and should be visible on your CV.',
  }),
};

route('POST', '/api/recruiter/candidates/:id/flags/:flagId/action', ['recruiter', 'admin'], r => {
  const store = r.deps.store;
  const flag = store.flag(r.ctx, r.params.flagId!);
  if (!flag || flag.candidateId !== r.params.id) throw new ApiError(404, 'not_found');
  const action = String(r.body?.action ?? '');
  if (action === 'feed' || action === 'approve') {
    const phrasing = SUGGESTION_PHRASING[flag.type]?.(flag.title, flag.body)
      ?? { type: 'task' as const, title: flag.title, body: flag.body };
    store.setFlagStatus(r.ctx, flag.id, 'actioned');
    store.insertTask({
      id: randomUUID(), tenantId: r.ctx.tenantId, candidateId: flag.candidateId,
      type: phrasing.type, done: false, source: 'recruiter',
      title: phrasing.title, body: phrasing.body,
      flagId: flag.id, createdAt: new Date().toISOString(),
    });
    store.audit(r.ctx.tenantId, r.user.displayName, r.user.role, 'suggestion_approved', flag.id);
    r.send(200, { status: 'actioned', approved: true });
    return;
  }
  if (action === 'notes' || action === 'resolve' || action === 'discard') {
    store.setFlagStatus(r.ctx, flag.id, action === 'notes' ? 'actioned' : 'resolved');
    store.audit(r.ctx.tenantId, r.user.displayName, r.user.role,
      action === 'discard' ? 'suggestion_discarded' : `flag_${action}`, flag.id);
    r.send(200, { status: action === 'notes' ? 'actioned' : 'resolved' });
    return;
  }
  throw new ApiError(400, 'unknown_action');
});

route('POST', '/api/recruiter/candidates/:id/artifacts', ['recruiter', 'admin'], r => {
  const kind = String(r.body?.kind ?? '');
  const title = String(r.body?.title ?? 'Document');
  const text = String(r.body?.text ?? '');
  if (!['resume', 'linkedin_snapshot', 'jd', 'transcript'].includes(kind)) throw new ApiError(400, 'bad_kind');
  if (!text.trim()) throw new ApiError(400, 'empty_document');
  const result = quarantine(r.deps.store, r.ctx, {
    candidateId: r.params.id!, kind: kind as 'resume', title, raw: text, createdBy: r.user.id,
  });
  r.send(200, {
    artifact: { id: result.artifact.id, kind: result.artifact.kind, quarantine: result.artifact.quarantine, injectionAttempts: result.artifact.injectionAttempts },
    events: result.events,
  });
});

route('POST', '/api/recruiter/candidates/:id/builder/start', ['recruiter', 'admin'], async r => {
  assertModule(r.deps.store, r.ctx.tenantId, 'builder');
  const run = await r.deps.engine.startRun(r.ctx, {
    flowId: 'submission_builder', candidateId: r.params.id!,
    actorRole: r.user.role, actor: r.user.displayName,
  });
  r.send(200, { run });
});

route('GET', '/api/recruiter/candidates/:id/builder', ['recruiter', 'admin'], r => {
  assertModule(r.deps.store, r.ctx.tenantId, 'builder');
  const store = r.deps.store;
  const run = store.flowRuns(r.ctx, r.params.id!).find(x => x.flowId === 'submission_builder');
  if (!run) { r.send(200, { run: null, qa: null, deliverables: [] }); return; }
  const out = run.stepStates['out:compose'] ? JSON.parse(run.stepStates['out:compose']!) as {
    client: { doc: string; email: string }; internal: { notes: string }; qa: Array<{ check: string; pass: boolean }>;
  } : null;
  const runStatus = run.status === 'awaiting_human' && run.stepStates['compose_blocked']
    ? { blocked: true, ...(JSON.parse(run.stepStates['compose_blocked']!) as { count: number; need: number }) }
    : { blocked: false };
  r.send(200, {
    run: { id: run.id, status: run.status, currentStep: run.currentStep, error: run.error, gate: runStatus },
    qa: out?.qa ?? null,
    deliverables: out ? [
      { kind: 'submission_doc', content: out.client.doc, internal: false },
      { kind: 'client_email', content: out.client.email, internal: false },
      { kind: 'recruiter_notes', content: out.internal.notes, internal: true },
    ] : [],
  });
});

/* ---------- flows ---------- */
route('POST', '/api/flows/:flowId/start/:candidateId', ['recruiter', 'admin'], async r => {
  const run = await r.deps.engine.startRun(r.ctx, {
    flowId: r.params.flowId!, candidateId: r.params.candidateId!,
    actorRole: r.user.role, actor: r.user.displayName,
  });
  r.send(200, { run });
});

route('POST', '/api/candidate/flows/:flowId/start', ['candidate'], async r => {
  const candidateId = candidateIdFor(r);
  /* The screener flow is gated by the practice module; studios gate by name. */
  const FLOW_MODULE: Record<string, string> = {
    interview_screener: 'practice', resume_studio: 'resume_studio', linkedin_studio: 'linkedin_studio',
  };
  const module = FLOW_MODULE[r.params.flowId!] ?? r.params.flowId!;
  assertModule(r.deps.store, r.ctx.tenantId, module);

  /* Journey gates (ADR-0009): the sequence is enforced server-side. */
  const journey = journeyState(r.deps.store, r.ctx, candidateId);
  if (r.params.flowId === 'resume_studio') {
    if (journey.onboarding !== 'complete' || journey.research !== 'complete') throw new ApiError(409, 'journey_locked');
    if (!r.body?.roleKey) throw new ApiError(400, 'role_required');
  }
  if (r.params.flowId === 'linkedin_studio' && journey.linkedin === 'locked') throw new ApiError(409, 'linkedin_locked');
  if (r.params.flowId === 'interview_screener') {
    const practice = r.body?.mode === 'practice';
    if (practice && journey.practice === 'locked') throw new ApiError(409, 'practice_locked');
    if (!practice && journey.interview === 'locked') throw new ApiError(409, 'interview_locked');
  }

  const run = await r.deps.engine.startRun(r.ctx, {
    flowId: r.params.flowId!, candidateId, actorRole: 'candidate', actor: r.user.displayName,
    mode: r.body?.mode === 'practice' ? 'practice' : undefined,
    roleKey: r.body?.roleKey ? String(r.body.roleKey) : undefined,
  });
  r.send(200, { run });
});

route('GET', '/api/flows/runs/:id', null, r => {
  const run = r.deps.store.flowRun(r.ctx, r.params.id!);
  if (!run) throw new ApiError(404, 'not_found');
  if (r.user.role === 'candidate' && run.candidateId !== candidateIdFor(r)) throw new ApiError(403, 'forbidden');
  r.send(200, { run });
});

route('POST', '/api/flows/runs/:id/turn', ['candidate', 'recruiter', 'admin'], async r => {
  const run = r.deps.store.flowRun(r.ctx, r.params.id!);
  if (!run) throw new ApiError(404, 'not_found');
  if (r.user.role === 'candidate' && run.candidateId !== candidateIdFor(r)) throw new ApiError(403, 'forbidden');
  const { run: updated, reply } = await r.deps.engine.turn(r.ctx, run.id, String(r.body?.text ?? ''), r.user.displayName);
  r.send(200, { run: updated, reply });
});

route('POST', '/api/flows/runs/:id/resume', ['recruiter', 'admin'], async r => {
  const { run } = { run: await r.deps.engine.resume(r.ctx, r.params.id!, r.user.displayName, r.user.role, String(r.body?.action ?? 'approve')) };
  r.send(200, { run });
});

route('POST', '/api/flows/runs/:id/consent', ['candidate'], async r => {
  const run = await r.deps.engine.grantConsent(r.ctx, r.params.id!, r.user.displayName, String(r.body?.scope ?? 'recording and sharing'));
  r.send(200, { run });
});

route('POST', '/api/flows/runs/:id/retry', ['recruiter', 'admin'], async r => {
  const run = await r.deps.engine.retryFailed(r.ctx, r.params.id!, r.user.displayName, r.user.role);
  r.send(200, { run });
});

/* ---------- candidate ---------- */
route('GET', '/api/candidate/journey', ['candidate'], r => {
  const view = journeyState(r.deps.store, r.ctx, candidateIdFor(r));
  r.send(200, { journey: view });
});

/* ---------- documents: one upload, reused everywhere (ADR-0022) ---------- */
type DocKind = 'resume' | 'jd';
const DOC_TITLE: Record<DocKind, string> = { resume: 'CV', jd: 'Job description' };

/* Shared by the candidate and recruiter routes. The file is read to text
   (LiteParse for PDF, direct XML for Word), the text goes through
   quarantine like any document, and the artifact records where it came
   from. A pasted JD (`text`) takes the same path minus the file read. */
async function ingestDocument(r: ReqCtx, candidateId: string): Promise<void> {
  const store = r.deps.store;
  const kind = String(r.body?.kind ?? '') as DocKind;
  if (kind !== 'resume' && kind !== 'jd') throw new ApiError(400, 'bad_kind');
  if (!store.candidate(r.ctx, candidateId)) throw new ApiError(404, 'not_found');
  const filename = String(r.body?.filename ?? '').replace(/[^\w .()-]/g, '').slice(0, 120);
  let text: string;
  let source: Record<string, unknown>;
  if (kind === 'jd' && typeof r.body?.text === 'string' && r.body.text.trim()) {
    text = r.body.text;
    source = { pasted: true };
  } else {
    try {
      const doc = await extractDocument(decodeUpload(r.body?.dataBase64));
      text = doc.text;
      source = { filename: filename || DOC_TITLE[kind], format: doc.format, parser: doc.parser, pages: doc.pages, bytes: doc.bytes, sha256: doc.sha256 };
    } catch (e) {
      if (e instanceof DocumentError) throw new ApiError(e.code === 'document_too_large' ? 413 : 400, e.code);
      throw e;
    }
  }
  const result = quarantine(store, r.ctx, {
    candidateId, kind, title: filename ? `${DOC_TITLE[kind]}: ${filename}` : DOC_TITLE[kind], raw: text, createdBy: r.user.id,
  });
  const fields = {
    ...result.artifact.fields,
    source: { ...source, uploadedBy: r.user.displayName, uploadedByRole: r.user.role, uploadedAt: result.artifact.createdAt },
  };
  store.updateArtifactFields(r.ctx, result.artifact.id, fields);
  store.audit(r.ctx.tenantId, r.user.displayName, r.user.role, 'document_uploaded', `${kind}:${result.artifact.id}`);
  const f = fields as { roles?: Array<{ title: string; company: string; start: string; end: string; bullets: string[] }>; mustHave?: string[]; skills?: Array<{ items: string[] }>; education?: string[]; positioning?: string };
  r.send(200, {
    artifact: { id: result.artifact.id, kind, quarantine: result.artifact.quarantine, injectionAttempts: result.artifact.injectionAttempts },
    /* What we read, for the confirmation screen. */
    read: kind === 'resume'
      ? {
        positioning: f.positioning ?? '',
        roles: (f.roles ?? []).map(x => ({ title: x.title, company: x.company, start: x.start, end: x.end, bullets: x.bullets.length })),
        skills: (f.skills ?? []).reduce((n, g) => n + g.items.length, 0),
        education: (f.education ?? []).length,
      }
      : { mustHave: f.mustHave ?? [] },
    events: result.events,
  });
}

route('POST', '/api/candidate/documents', ['candidate'], r => ingestDocument(r, candidateIdFor(r)), { maxBody: UPLOAD_MAX_BODY });
route('POST', '/api/recruiter/candidates/:id/documents', ['recruiter', 'admin'], r => ingestDocument(r, r.params.id!), { maxBody: UPLOAD_MAX_BODY });

route('POST', '/api/candidate/onboarding', ['candidate'], async r => {
  const candidateId = candidateIdFor(r);
  const store = r.deps.store;
  const c = store.candidate(r.ctx, candidateId)!;
  const has = (kind: string) => store.artifacts(r.ctx, candidateId, kind).some(a => a.quarantine !== 'rejected');
  /* The target is the recruiter's when they set it; the candidate fills it
     only when it is empty. */
  const company = c.targetCompany?.trim() || String(r.body?.targetCompany ?? '').trim();
  const role = String(r.body?.targetRole ?? '').trim();
  const linkedinUrl = String(r.body?.linkedinUrl ?? '').trim();
  const linkedinText = String(r.body?.linkedinText ?? '').trim();
  if (!company) throw new ApiError(400, 'company_required');
  /* Documents arrive through /api/candidate/documents, once. Onboarding
     only confirms they are on file, whoever uploaded them. */
  if (!has('resume')) throw new ApiError(400, 'resume_required');
  if (!has('jd')) throw new ApiError(400, 'jd_required');
  if (!linkedinUrl && !linkedinText) throw new ApiError(400, 'linkedin_required');
  if (linkedinUrl && !/^https?:\/\//.test(linkedinUrl)) throw new ApiError(400, 'linkedin_url_invalid');

  if (!c.targetCompany) store.updateCandidate(r.ctx, candidateId, { targetCompany: company });
  if (role && (!c.targetRole || c.targetRole === 'Target role')) store.updateCandidate(r.ctx, candidateId, { targetRole: role });
  if (linkedinText) {
    quarantine(store, r.ctx, { candidateId, kind: 'linkedin_snapshot', title: 'LinkedIn profile', raw: linkedinText, createdBy: r.user.id });
  }
  if (linkedinUrl && !store.artifacts(r.ctx, candidateId).some(a => a.kind === 'linkedin_link')) {
    store.insertArtifact({
      id: randomUUID(), tenantId: r.ctx.tenantId, candidateId, kind: 'linkedin_link',
      title: 'LinkedIn profile link', quarantine: 'clean', fields: { url: linkedinUrl },
      sanitizedText: null, content: null, injectionAttempts: 0,
      createdBy: r.user.id, createdAt: new Date().toISOString(),
    });
  }
  store.audit(r.ctx.tenantId, r.user.displayName, 'candidate', 'onboarding_submitted', candidateId);

  /* Research Agent fires automatically once the sources are in (linked flow). */
  const run = await r.deps.engine.startRun(r.ctx, {
    flowId: 'research', candidateId, actorRole: 'candidate', actor: r.user.displayName,
  });
  r.send(200, { run, journey: journeyState(store, r.ctx, candidateId) });
});

/* ---------- profile page: candidate approval, expiry, revocation ---------- */
function latestProfilePage(r: ReqCtx, candidateId: string) {
  return r.deps.store.artifacts(r.ctx, candidateId, 'profile_page').filter(a => a.quarantine !== 'rejected').at(-1) ?? null;
}

route('GET', '/api/candidate/profile', ['candidate'], r => {
  const candidateId = candidateIdFor(r);
  const page = latestProfilePage(r, candidateId);
  r.send(200, {
    page: page ? { id: page.id, share: shareOf(page.fields), live: shareIsLive(page.fields) } : null,
    insight: profileInsight(r.deps.store, r.ctx, candidateId),
  });
});

/* Nothing is shared with a company until the candidate approves it. An
   approval lasts SHARE_DAYS; turning sharing off kills the link at once. */
route('POST', '/api/candidate/profile/share', ['candidate'], r => {
  const candidateId = candidateIdFor(r);
  const page = latestProfilePage(r, candidateId);
  if (!page) throw new ApiError(409, 'profile_not_ready');
  const enabled = r.body?.enabled === true;
  const now = new Date();
  const share: ShareState = enabled
    ? { enabled: true, approvedAt: now.toISOString(), expiresAt: new Date(now.getTime() + SHARE_DAYS * 86400_000).toISOString() }
    : { ...shareOf(page.fields), enabled: false };
  r.deps.store.updateArtifactFields(r.ctx, page.id, { ...page.fields, share });
  r.deps.store.audit(r.ctx.tenantId, r.user.displayName, 'candidate', enabled ? 'profile_share_approved' : 'profile_share_stopped', page.id);
  r.send(200, { share, live: shareIsLive({ share }) });
});

route('POST', '/api/recruiter/candidates/:id/profile/revoke', ['recruiter', 'admin'], r => {
  const page = latestProfilePage(r, r.params.id!);
  if (!page) throw new ApiError(404, 'not_found');
  const share = { ...shareOf(page.fields), enabled: false };
  r.deps.store.updateArtifactFields(r.ctx, page.id, { ...page.fields, share });
  r.deps.store.audit(r.ctx.tenantId, r.user.displayName, r.user.role, 'profile_share_revoked', page.id);
  r.send(200, { share });
});

route('GET', '/api/recruiter/candidates/:id/insight', ['recruiter', 'admin'], r => {
  const page = latestProfilePage(r, r.params.id!);
  r.send(200, {
    page: page ? { id: page.id, share: shareOf(page.fields), live: shareIsLive(page.fields) } : null,
    insight: profileInsight(r.deps.store, r.ctx, r.params.id!),
  });
});

/* ---------- portfolio connectors (ADR-0022) ---------- */
function connectorView(r: ReqCtx, candidateId: string) {
  const store = r.deps.store;
  const links = store.artifacts(r.ctx, candidateId, 'connector_link');
  const states = connectorStates(store, r.ctx, candidateId);
  return PROVIDERS.map(provider => {
    const link = links.find(l => (l.fields as { provider?: string }).provider === provider);
    const state = states.find(s => s.provider === provider);
    const f = (link?.fields ?? {}) as { username?: string; code?: string; verified?: boolean; verifiedAt?: string | null };
    return {
      provider,
      linked: !!link,
      username: f.username ?? null,
      url: f.username ? profileUrl(provider, f.username) : null,
      verified: !!f.verified,
      verifiedAt: f.verifiedAt ?? null,
      /* The code is shown to the candidate only, to place in their bio. */
      code: r.user.role === 'candidate' && !f.verified ? (f.code ?? null) : null,
      syncedAt: state?.syncedAt || null,
      snapshot: state?.snapshot ?? null,
    };
  });
}

async function syncConnector(r: ReqCtx, candidateId: string, provider: Provider): Promise<void> {
  const store = r.deps.store;
  const link = store.artifacts(r.ctx, candidateId, 'connector_link').find(l => (l.fields as { provider?: string }).provider === provider);
  if (!link) throw new ApiError(404, 'not_linked');
  const f = link.fields as { username: string; code: string; verified?: boolean };
  let snapshot;
  try {
    snapshot = await fetchSnapshot(provider, f.username, r.deps.fetch ?? fetch, process.env.GITHUB_TOKEN || undefined);
  } catch (e) {
    if (e instanceof ConnectorError) throw new ApiError(e.code === 'account_not_found' ? 404 : 502, e.code);
    throw e;
  }
  /* Ownership: the one-time code in the public bio. Once proven it stays
     proven for this link; a new link starts over. */
  const proven = !!f.verified || bioHasCode(snapshot, f.code);
  if (proven && !f.verified) {
    store.updateArtifactFields(r.ctx, link.id, { ...link.fields, verified: true, verifiedAt: new Date().toISOString() });
    store.audit(r.ctx.tenantId, r.user.displayName, r.user.role, 'connector_verified', `${provider}:${f.username}`);
  }
  for (const old of store.artifacts(r.ctx, candidateId, 'connector_snapshot').filter(a => (a.fields as { provider?: string }).provider === provider)) {
    store.deleteArtifact(r.ctx, old.id);
  }
  store.insertArtifact({
    id: randomUUID(), tenantId: r.ctx.tenantId, candidateId, kind: 'connector_snapshot',
    title: `${provider} snapshot`, quarantine: snapshot.injectionAttempts > 0 ? 'sanitized' : 'clean',
    fields: { provider, username: f.username, fetchedAt: new Date().toISOString(), data: snapshot },
    sanitizedText: null, content: null, injectionAttempts: snapshot.injectionAttempts,
    createdBy: `connector:${provider}`, createdAt: new Date().toISOString(),
  });
  store.audit(r.ctx.tenantId, r.user.displayName, r.user.role, 'connector_synced', `${provider}:${f.username}`);
}

function providerParam(r: ReqCtx): Provider {
  const p = r.params.provider as Provider;
  if (!PROVIDERS.includes(p)) throw new ApiError(404, 'unknown_provider');
  return p;
}

route('GET', '/api/candidate/connectors', ['candidate'], r => {
  r.send(200, { connectors: connectorView(r, candidateIdFor(r)) });
});

/* Linking is a consented act: a ConsentRecord with scope connect:<provider>
   is created, and disconnecting withdraws it and deletes the data. */
route('POST', '/api/candidate/connectors/:provider', ['candidate'], async r => {
  const store = r.deps.store;
  const candidateId = candidateIdFor(r);
  const provider = providerParam(r);
  let username: string;
  try { username = normalizeUsername(provider, String(r.body?.username ?? '')); }
  catch { throw new ApiError(400, 'invalid_username'); }
  if (store.artifacts(r.ctx, candidateId, 'connector_link').some(l => (l.fields as { provider?: string }).provider === provider)) {
    throw new ApiError(409, 'already_linked');
  }
  const now = new Date().toISOString();
  const consentId = randomUUID();
  store.insertConsent({
    id: consentId, tenantId: r.ctx.tenantId, candidateId, sessionId: null, scope: `connect:${provider}`,
    grantedAt: now, withdrawnAt: null, retentionPolicy: 'until disconnected', createdAt: now,
  });
  store.insertArtifact({
    id: randomUUID(), tenantId: r.ctx.tenantId, candidateId, kind: 'connector_link',
    title: `${provider} account`, quarantine: 'clean',
    fields: { provider, username, code: verificationCode(), verified: false, verifiedAt: null, consentId, linkedAt: now },
    sanitizedText: null, content: null, injectionAttempts: 0, createdBy: r.user.id, createdAt: now,
  });
  store.audit(r.ctx.tenantId, r.user.displayName, 'candidate', 'connector_linked', `${provider}:${username}`);
  /* A first sync right away; a failure leaves the link in place to retry. */
  let syncError: string | null = null;
  try { await syncConnector(r, candidateId, provider); }
  catch (e) { syncError = e instanceof ApiError ? e.code : 'sync_failed'; }
  r.send(200, { connectors: connectorView(r, candidateId), syncError });
});

route('POST', '/api/candidate/connectors/:provider/sync', ['candidate'], async r => {
  const candidateId = candidateIdFor(r);
  await syncConnector(r, candidateId, providerParam(r));
  r.send(200, { connectors: connectorView(r, candidateId) });
});

route('POST', '/api/candidate/connectors/:provider/disconnect', ['candidate'], r => {
  const store = r.deps.store;
  const candidateId = candidateIdFor(r);
  const provider = providerParam(r);
  const mine = (kind: string) => store.artifacts(r.ctx, candidateId, kind).filter(a => (a.fields as { provider?: string }).provider === provider);
  const link = mine('connector_link')[0];
  if (!link) throw new ApiError(404, 'not_linked');
  const consentId = (link.fields as { consentId?: string }).consentId;
  if (consentId) store.withdrawConsent(r.ctx, consentId);
  for (const a of [...mine('connector_link'), ...mine('connector_snapshot')]) store.deleteArtifact(r.ctx, a.id);
  store.audit(r.ctx.tenantId, r.user.displayName, 'candidate', 'connector_disconnected', provider);
  r.send(200, { connectors: connectorView(r, candidateId) });
});

route('GET', '/api/recruiter/candidates/:id/connectors', ['recruiter', 'admin'], r => {
  if (!r.deps.store.candidate(r.ctx, r.params.id!)) throw new ApiError(404, 'not_found');
  r.send(200, { connectors: connectorView(r, r.params.id!) });
});

route('GET', '/api/candidate/me', ['candidate'], r => {
  const view = candidateSelfView(r.ctx, r.deps.store, candidateIdFor(r));
  if (!view) throw new ApiError(404, 'no_candidate_record');
  assertNoInternalFields(view);
  r.send(200, view);
});

route('POST', '/api/candidate/tasks/:id/done', ['candidate'], r => {
  const store = r.deps.store;
  const candidateId = candidateIdFor(r);
  const task = store.db.prepare('SELECT * FROM tasks WHERE tenant_id = ? AND id = ?').get(r.ctx.tenantId, r.params.id!) as any;
  if (!task || task.candidate_id !== candidateId) throw new ApiError(404, 'not_found');
  store.setTaskDone(r.ctx, task.id, true);
  store.audit(r.ctx.tenantId, r.user.displayName, 'candidate', 'task_done', task.id);
  r.send(200, { ok: true });
});

route('POST', '/api/candidate/sessions', ['candidate'], r => {
  assertModule(r.deps.store, r.ctx.tenantId, 'practice');
  const mode = r.body?.mode === 'verified' ? 'verified' : 'practice';
  if (mode === 'verified') throw new ApiError(403, 'verified_requires_consent_flow');
  const candidateId = candidateIdFor(r);
  const session = {
    id: randomUUID(), tenantId: r.ctx.tenantId, candidateId, flowRunId: null,
    mode: 'practice' as const, status: 'active' as const, date: new Date().toISOString().slice(0, 10),
    duration: '', star: null, targets: { S: 15, T: 10, A: 50, R: 25 },
    ownership: null, trailing: null, transcript: [], debrief: null,
    consentId: null, createdAt: new Date().toISOString(),
  };
  r.deps.store.insertSession(session);
  r.deps.store.audit(r.ctx.tenantId, r.user.displayName, 'candidate', 'practice_session_started', session.id);
  r.send(200, { sessionId: session.id });
});

route('GET', '/api/candidate/consents', ['candidate'], r => {
  const candidateId = candidateIdFor(r);
  const rows = r.deps.store.db.prepare(
    'SELECT id, scope, granted_at, withdrawn_at, retention_policy FROM consents WHERE tenant_id = ? AND candidate_id = ? ORDER BY created_at')
    .all(r.ctx.tenantId, candidateId) as unknown as Array<{ id: string; scope: string; granted_at: string | null; withdrawn_at: string | null; retention_policy: string }>;
  r.send(200, {
    consents: rows.map(c => ({
      id: c.id, scope: c.scope, grantedAt: c.granted_at, withdrawnAt: c.withdrawn_at,
      retention: c.retention_policy, active: !!c.granted_at && !c.withdrawn_at,
    })),
  });
});

route('POST', '/api/consents/:id/withdraw', ['candidate'], r => {
  const candidateId = candidateIdFor(r);
  const consent = r.deps.store.consent(r.ctx, r.params.id!);
  if (!consent || consent.candidateId !== candidateId) throw new ApiError(404, 'not_found');
  r.deps.engine.withdrawConsent(r.ctx, consent.id, r.user.displayName);
  r.send(200, { ok: true });
});

/* ---------- admin ---------- */
route('GET', '/api/admin/audit', ['admin'], r => {
  assertModule(r.deps.store, r.ctx.tenantId, 'admin');
  r.send(200, { events: r.deps.store.auditList(r.ctx, 500) });
});
route('GET', '/api/admin/entitlements', ['admin'], r => {
  r.send(200, { modules: MODULES, entitlements: r.deps.store.entitlements(r.ctx.tenantId) });
});
route('POST', '/api/admin/entitlements', ['admin'], r => {
  assertModule(r.deps.store, r.ctx.tenantId, 'admin');
  const { module, enabled } = r.body ?? {};
  if (!MODULES.includes(module)) throw new ApiError(400, 'unknown_module');
  r.deps.store.setEntitlement(r.ctx.tenantId, module, !!enabled);
  r.deps.store.audit(r.ctx.tenantId, r.user.displayName, 'admin', 'entitlement_changed', `${module}:${!!enabled}`);
  r.send(200, { ok: true });
});
route('GET', '/api/admin/usage', ['admin'], r => {
  assertModule(r.deps.store, r.ctx.tenantId, 'billing');
  r.send(200, invoice(r.deps.store, r.ctx.tenantId));
});
route('GET', '/api/admin/users', ['admin'], r => {
  r.send(200, { users: r.deps.store.listUsers(r.ctx) });
});
route('GET', '/api/admin/flows', ['admin'], r => {
  r.send(200, { flows: r.deps.store.flowDefs(r.ctx).map(f => ({ id: f.id, version: f.version, title: f.title, enabled: f.enabled, steps: f.steps.map(s => ({ id: s.id, kind: s.kind, agent: s.agent, description: s.description })) })) });
});
route('POST', '/api/admin/retention/run', ['admin'], r => {
  const affected = applyRetention(r.deps.store);
  r.send(200, { affected });
});

/* ---------- LiveKit Webhook ----------
   Signature-verified and consent-gated; handled in the dispatcher before
   the generic JSON body path because verification needs the raw body. */

/* ---------- LiveKit Voice token (L4: consent chain required) ---------- */
route('POST', '/api/candidate/livekit/token', ['candidate'], async r => {
  const cfg = livekitConfigFromEnv();
  if (!cfg) throw new ApiError(503, 'livekit_not_configured');
  const candidateId = candidateIdFor(r);
  const runId = String(r.body?.runId ?? '');
  /* No run id means no consent chain: refused without minting. */
  if (!runId) throw new ApiError(409, 'consent_required');
  let chain;
  try {
    chain = voiceChain(r.deps.store, r.ctx, candidateId, runId);
  } catch (e) {
    if (e instanceof VoiceError) {
      throw new ApiError(e.code === 'voice_run_not_found' ? 404 : 409, e.code);
    }
    throw e;
  }
  const token = await mintVoiceToken(cfg, chain, r.user.displayName);
  r.deps.store.audit(r.ctx.tenantId, r.user.displayName, 'candidate', 'voice_token_minted',
    `${chain.session.id}:${chain.consentId}`);
  r.send(200, { token, url: cfg.url, sessionId: chain.session.id });
});

/* ---------- GDPR ---------- */
route('GET', '/api/gdpr/export', ['candidate', 'admin'], r => {
  const candidateId = candidateIdFor(r, r.query('candidateId') ?? undefined);
  const data = gdprExport(r.deps.store, r.ctx, candidateId);
  if (r.user.role === 'candidate') assertNoInternalFields(data.sessions ?? []);
  r.send(200, data);
});
route('POST', '/api/gdpr/erase', ['candidate', 'admin'], r => {
  const candidateId = candidateIdFor(r, r.body?.candidateId ?? undefined);
  gdprErase(r.deps.store, r.ctx, candidateId, r.user.displayName);
  r.send(200, { ok: true });
});

/* ---------- dispatcher ---------- */
export async function handleApi(req: IncomingMessage, res: ServerResponse, deps: ApiDeps,
  url: URL, auth: { user: User; csrf: string } | null): Promise<boolean> {
  const send = (status: number, data: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };
  if (url.pathname === '/api/auth/login' || url.pathname === '/api/auth/logout') {
    await handleAuth(req, res, deps, url, send);
    return true;
  }
  if (req.method === 'GET' && handlePublicProfile(deps, url, send, auth)) return true;
  /* The webhook is public but signature-authenticated: it is verified
     against the raw body before anything else runs. */
  if (url.pathname === '/api/webhooks/livekit' && req.method === 'POST') {
    await handleVoiceWebhook(req, deps, send);
    return true;
  }
  if (!auth) { send(401, { error: 'unauthenticated' }); return true; }
  const match = routes.find(rt => rt.method === req.method && rt.re.test(url.pathname));
  if (!match) { send(404, { error: 'no_route' }); return true; }
  if (match.roles && !match.roles.includes(auth.user.role)) { send(403, { error: 'forbidden' }); return true; }
  const params = (url.pathname.match(match.re)!.groups ?? {}) as Record<string, string>;
  try {
    if (req.method === 'POST') checkCsrf(req, auth.csrf);
    /* A password someone else chose (a recruiter-generated one) unlocks
       nothing but the screen that replaces it. */
    if (auth.user.mustChangePassword && !PASSWORD_GATE_ALLOWED.has(url.pathname)) {
      throw new ApiError(403, 'password_change_required');
    }
    const body = req.method === 'POST' ? await readBody(req, match.maxBody) : {};
    await match.handler({
      deps, user: auth.user, csrf: auth.csrf,
      ctx: { tenantId: auth.user.tenantId },
      params, body, send,
      query: (k: string) => url.searchParams.get(k),
    });
  } catch (e) {
    if (e instanceof ApiError) send(e.status, { error: e.code });
    else if (e instanceof FlowError) send(e.code === 'active_session_exists' ? 409 : 409, { error: e.code });
    else if (e instanceof Error && e.message.startsWith('module_not_entitled')) send(402, { error: e.message });
    else {
      send(500, { error: 'internal' });
      console.error('api error', url.pathname, e);
    }
  }
  return true;
}

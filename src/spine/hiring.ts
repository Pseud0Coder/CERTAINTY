/* Requisitions and applications (ADR-0024): the hiring lifecycle around the
   candidate record. The candidate remains the single source of truth; an
   application is candidate x requisition, and the pipeline is a projection.

   Division of labour: scoring, knockouts, ranking and progression are
   deterministic and live in scoring.ts. This module orchestrates them, keeps
   the tenant stage set, and writes the audit (L6). Agents may suggest a
   stage; only a human action changes one (A9). */

import { randomUUID } from 'node:crypto';
import type { Store, Ctx } from './db.ts';
import type {
  Application, ApplicationStatus, Candidate, Requisition, RequisitionCriteria, RequisitionStatus, Stage, TenantSettings,
} from './types.ts';
import { STAGE_SETS, DEFAULT_TENANT_SETTINGS } from './types.ts';
import {
  candidateYears, effectiveScore, findDuplicate, progressionStatus, rankApplications,
  scoreApplication, type ApplicationRankRow,
} from './scoring.ts';
import { queueForEvent } from './communications.ts';

export class HiringError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}

/* Who can do what. Approval is deliberately narrower than authorship, and
   the approver may never be the submitter (ADR-0024). */
export const STAFF_ROLES = ['recruiter', 'hr', 'admin'];
export const APPROVER_ROLES = ['hr', 'admin'];

export interface Actor { id: string; name: string; role: string }

function requireReq(store: Store, ctx: Ctx, id: string): Requisition {
  const r = store.requisition(ctx, id);
  if (!r) throw new HiringError('not_found');
  return r;
}

export function stagesFor(store: Store, ctx: Ctx): Stage[] {
  const settings: TenantSettings = store.tenantSettings(ctx) ?? DEFAULT_TENANT_SETTINGS;
  return STAGE_SETS[settings.hiringModel] ?? STAGE_SETS.agency;
}

export function firstStage(store: Store, ctx: Ctx): Stage {
  return stagesFor(store, ctx)[0]!;
}

function normalizeCriteria(input?: Partial<RequisitionCriteria>): RequisitionCriteria {
  const mustHaves = (input?.mustHaves ?? []).map((m, i) => ({
    id: m.id ?? `m${i}`,
    label: String(m.label ?? '').trim(),
    weight: Math.min(3, Math.max(1, Math.round(Number(m.weight) || 1))),
    required: !!m.required,
  })).filter(m => m.label);
  return {
    mustHaves,
    minYears: input?.minYears ?? null,
    locations: (input?.locations ?? []).map(l => String(l).trim()).filter(Boolean),
    remoteOk: !!input?.remoteOk,
    workAuthRequired: !!input?.workAuthRequired,
  };
}

export interface RequisitionInput {
  title: string;
  department?: string;
  location?: string;
  client?: string | null;
  headcount?: number;
  salaryMin?: number | null;
  salaryMax?: number | null;
  currency?: string;
  description?: string;
  criteria?: Partial<RequisitionCriteria>;
  shortlistAt?: number | null;
}

export function createRequisition(store: Store, ctx: Ctx, actor: Actor, input: RequisitionInput): Requisition {
  const title = String(input.title ?? '').trim();
  if (!title) throw new HiringError('title_required');
  if (input.salaryMin != null && input.salaryMax != null && input.salaryMin > input.salaryMax) {
    throw new HiringError('salary_band_invalid');
  }
  const now = new Date().toISOString();
  const r: Requisition = {
    id: randomUUID(), tenantId: ctx.tenantId, title,
    department: String(input.department ?? '').trim(),
    location: String(input.location ?? '').trim(),
    client: input.client ? String(input.client).trim() : null,
    headcount: Math.max(1, Math.round(Number(input.headcount) || 1)),
    salaryMin: input.salaryMin ?? null, salaryMax: input.salaryMax ?? null,
    currency: String(input.currency ?? 'AED'),
    description: String(input.description ?? ''),
    status: 'draft', criteria: normalizeCriteria(input.criteria),
    shortlistAt: input.shortlistAt ?? null,
    approvals: [], createdBy: actor.id, createdAt: now, updatedAt: now,
  };
  store.insertRequisition(r);
  store.audit(ctx.tenantId, actor.name, actor.role, 'requisition_created', r.id);
  return r;
}

/* Editable only while a draft or after changes were requested. */
export function updateRequisition(store: Store, ctx: Ctx, actor: Actor, id: string, input: RequisitionInput): Requisition {
  const r = requireReq(store, ctx, id);
  if (r.status !== 'draft') throw new HiringError('not_editable');
  const title = String(input.title ?? r.title).trim();
  if (!title) throw new HiringError('title_required');
  Object.assign(r, {
    title,
    department: input.department !== undefined ? String(input.department).trim() : r.department,
    location: input.location !== undefined ? String(input.location).trim() : r.location,
    client: input.client !== undefined ? (input.client ? String(input.client).trim() : null) : r.client,
    headcount: input.headcount !== undefined ? Math.max(1, Math.round(Number(input.headcount) || 1)) : r.headcount,
    salaryMin: input.salaryMin !== undefined ? input.salaryMin : r.salaryMin,
    salaryMax: input.salaryMax !== undefined ? input.salaryMax : r.salaryMax,
    currency: input.currency !== undefined ? String(input.currency) : r.currency,
    description: input.description !== undefined ? String(input.description) : r.description,
    criteria: input.criteria !== undefined ? normalizeCriteria(input.criteria) : r.criteria,
    shortlistAt: input.shortlistAt !== undefined ? input.shortlistAt : r.shortlistAt,
  });
  store.updateRequisition(ctx, r);
  store.audit(ctx.tenantId, actor.name, actor.role, 'requisition_updated', r.id);
  return store.requisition(ctx, id)!;
}

export function submitRequisition(store: Store, ctx: Ctx, actor: Actor, id: string): Requisition {
  const r = requireReq(store, ctx, id);
  if (r.status !== 'draft' && r.status !== 'rejected') throw new HiringError('not_submittable');
  r.status = 'pending_approval';
  r.approvals.push({ action: 'submitted', by: actor.id, byName: actor.name, role: actor.role, comment: '', at: new Date().toISOString() });
  store.updateRequisition(ctx, r);
  store.audit(ctx.tenantId, actor.name, actor.role, 'requisition_submitted', r.id);
  return store.requisition(ctx, id)!;
}

export function decideRequisition(
  store: Store, ctx: Ctx, actor: Actor, id: string,
  decision: 'approved' | 'rejected' | 'changes_requested', comment = '',
): Requisition {
  if (!APPROVER_ROLES.includes(actor.role)) throw new HiringError('not_approver');
  const r = requireReq(store, ctx, id);
  if (r.status !== 'pending_approval') throw new HiringError('not_pending');
  const submitter = [...r.approvals].reverse().find(a => a.action === 'submitted');
  if (submitter && submitter.by === actor.id) throw new HiringError('approver_is_submitter');
  r.status = decision === 'approved' ? 'open' : decision === 'rejected' ? 'rejected' : 'draft';
  r.approvals.push({ action: decision, by: actor.id, byName: actor.name, role: actor.role, comment, at: new Date().toISOString() });
  store.updateRequisition(ctx, r);
  store.audit(ctx.tenantId, actor.name, actor.role, `requisition_${decision}`, r.id);
  return store.requisition(ctx, id)!;
}

export function closeRequisition(store: Store, ctx: Ctx, actor: Actor, id: string): Requisition {
  const r = requireReq(store, ctx, id);
  if (r.status === 'closed') throw new HiringError('already_closed');
  r.status = 'closed';
  r.approvals.push({ action: 'closed', by: actor.id, byName: actor.name, role: actor.role, comment: '', at: new Date().toISOString() });
  store.updateRequisition(ctx, r);
  store.audit(ctx.tenantId, actor.name, actor.role, 'requisition_closed', r.id);
  return store.requisition(ctx, id)!;
}

export interface ApplyInput {
  requisitionId: string;
  candidateId?: string | null;
  name?: string;
  email?: string | null;
  phone?: string | null;
  employer?: string;
  targetCompany?: string;
  answers?: Record<string, string>;
  source?: Application['source'];
  cvHash?: string | null;
}

export interface ApplyResult { application: Application; candidateId: string; dedup: string | null }

/* Attach a candidate to an open requisition. A duplicate (same email, phone,
   CV hash, or name plus overlapping employer) attaches to the existing
   candidate and records why; otherwise a candidate with no login is created.
   The application is scored and progressed immediately, deterministically. */
export function applyToRequisition(store: Store, ctx: Ctx, actor: Actor, input: ApplyInput): ApplyResult {
  const req = requireReq(store, ctx, input.requisitionId);
  if (req.status !== 'open') throw new HiringError('requisition_not_open');

  let candidateId = input.candidateId ?? null;
  let dedup: string | null = null;
  if (!candidateId) {
    const existing = findDuplicate(store, ctx, {
      email: input.email, phone: input.phone, name: input.name, employer: input.employer, cvHash: input.cvHash,
    });
    if (existing) { candidateId = existing.candidateId; dedup = existing.reason; }
  } else {
    if (!store.candidate(ctx, candidateId)) throw new HiringError('candidate_not_found');
    dedup = 'Existing candidate.';
  }

  if (!candidateId) {
    const now = new Date().toISOString();
    const c: Candidate = {
      id: randomUUID(), tenantId: ctx.tenantId, userId: null,
      name: String(input.name ?? '').trim() || 'Unnamed candidate',
      targetRole: req.title, targetCompany: req.client ?? String(input.targetCompany ?? ''),
      employer: String(input.employer ?? ''), tenure: '', cvTenureStart: null, cvTenureEnd: null,
      stage: firstStage(store, ctx), parked: false, linkedinStatus: '',
      email: input.email ? String(input.email).trim().toLowerCase() : null,
      phone: input.phone ? String(input.phone).trim() : null,
      source: input.source ?? 'recruiter',
      currentCompensation: null, compExpectations: null, noticePeriod: null, motivation: null,
      createdAt: now,
    };
    store.insertCandidate(c);
    candidateId = c.id;
  }

  if (store.applicationFor(ctx, req.id, candidateId)) throw new HiringError('already_applied');

  const now = new Date().toISOString();
  const isFirst = store.applications(ctx, { candidateId }).length === 0;
  const app: Application = {
    id: randomUUID(), tenantId: ctx.tenantId, requisitionId: req.id, candidateId,
    stage: firstStage(store, ctx), status: 'new', source: input.source ?? 'recruiter',
    primary: isFirst, answers: input.answers ?? {}, score: null, override: null,
    dedup: dedup ? { reason: dedup } : null, createdAt: now, updatedAt: now,
  };
  app.score = scoreApplication(store, ctx, req, candidateId, app.answers);
  app.status = progressionStatus(req, app);
  store.insertApplication(app);
  store.audit(ctx.tenantId, actor.name, actor.role, 'application_created', app.id);
  if (app.status !== 'new') store.audit(ctx.tenantId, 'agent:screening', 'agent', 'application_screened', app.id);
  if (app.primary) store.updateCandidate(ctx, candidateId, { stage: app.stage });
  /* Automated acknowledgement (ADR-0024): queued, never a flow side effect. */
  queueForEvent(store, ctx, { candidateId, applicationId: app.id, template: 'application_received', vars: { role: req.title } });
  return { application: app, candidateId, dedup };
}

/* Recompute every application on a requisition. Overrides are never cleared
   (a re-score keeps the human's adjust/include/exclude), and a status change
   is audited as agent:screening. */
export function rescoreRequisition(store: Store, ctx: Ctx, requisitionId: string): { changed: number; scored: number } {
  const req = requireReq(store, ctx, requisitionId);
  let changed = 0;
  const apps = store.applications(ctx, { requisitionId });
  for (const app of apps) {
    app.score = scoreApplication(store, ctx, req, app.candidateId, app.answers);
    const before = app.status;
    app.status = progressionStatus(req, app);
    app.updatedAt = new Date().toISOString();
    store.updateApplication(ctx, app);
    if (app.status !== before) {
      changed += 1;
      store.audit(ctx.tenantId, 'agent:screening', 'agent', 'application_screened', app.id);
    }
  }
  return { changed, scored: apps.length };
}

export interface OverrideInput { kind: 'adjust' | 'include' | 'exclude'; delta?: number; reason: string }

export function overrideApplication(
  store: Store, ctx: Ctx, actor: Actor, applicationId: string, input: OverrideInput,
): Application {
  const app = store.application(ctx, applicationId);
  if (!app) throw new HiringError('not_found');
  const reason = String(input.reason ?? '').trim();
  if (!reason) throw new HiringError('reason_required');
  const req = requireReq(store, ctx, app.requisitionId);
  const delta = input.kind === 'adjust' ? Math.max(-100, Math.min(100, Math.round(Number(input.delta) || 0))) : 0;
  app.override = { kind: input.kind, delta, reason, by: actor.id, role: actor.role, at: new Date().toISOString() };
  app.status = progressionStatus(req, app);
  app.updatedAt = new Date().toISOString();
  store.updateApplication(ctx, app);
  store.audit(ctx.tenantId, actor.name, actor.role, `application_override_${input.kind}`, app.id);
  return app;
}

export interface BulkRow { name: string; email?: string | null; phone?: string | null; employer?: string }
export interface BulkResult { created: number; attached: number; skipped: number; errors: number; applicationIds: string[] }

/* Bulk add to an open requisition. One bad row never fails the batch: it is
   counted and the rest proceed. Capped so a single request cannot run away. */
export function bulkApply(store: Store, ctx: Ctx, actor: Actor, requisitionId: string, rows: BulkRow[]): BulkResult {
  const result: BulkResult = { created: 0, attached: 0, skipped: 0, errors: 0, applicationIds: [] };
  for (const row of rows.slice(0, 500)) {
    const name = String(row.name ?? '').trim();
    if (!name) { result.errors += 1; continue; }
    try {
      const before = store.candidates(ctx).length;
      const applied = applyToRequisition(store, ctx, actor, {
        requisitionId, name, email: row.email ?? null, phone: row.phone ?? null,
        employer: row.employer ?? '', source: 'bulk',
      });
      if (store.candidates(ctx).length > before) result.created += 1; else result.attached += 1;
      result.applicationIds.push(applied.application.id);
    } catch (e) {
      if (e instanceof HiringError && e.code === 'already_applied') result.skipped += 1;
      else result.errors += 1;
    }
  }
  return result;
}

export interface PipelineRow extends ApplicationRankRow {
  candidate: { id: string; name: string; email: string | null; years: number | null };
}

/* The ranked pipeline for a requisition. Internal view only (salary, scores,
   knockouts, overrides); the projection layer keeps it off candidate
   surfaces. */
export function requisitionPipeline(store: Store, ctx: Ctx, requisitionId: string): { requisition: Requisition; rows: PipelineRow[] } {
  const req = requireReq(store, ctx, requisitionId);
  const rows = rankApplications(store.applications(ctx, { requisitionId })).map(row => {
    const c = store.candidate(ctx, row.application.candidateId);
    return {
      ...row,
      candidate: {
        id: row.application.candidateId,
        name: c?.name ?? 'Unknown',
        email: c?.email ?? null,
        /* The years scoring used (all dated CV roles), so the list and the
           score never disagree; the one-role tenure is only a fallback. */
        years: row.application.score?.years ?? (c ? candidateYears(c) : null),
      },
    };
  });
  return { requisition: req, rows };
}

export interface RequisitionReport {
  requisitionId: string;
  title: string;
  status: RequisitionStatus;
  applications: number;
  byStatus: Record<ApplicationStatus, number>;
  byStage: Record<string, number>;
  knockedOut: number;
  overridden: number;
  averageScore: number | null;
}

export interface HiringReport {
  generatedAt: string;
  totals: { requisitions: number; open: number; applications: number; knockedOut: number; overridden: number; hired: number };
  requisitions: RequisitionReport[];
  /* Where applications came from, and why knocked-out ones were. */
  bySource: Record<string, number>;
  knockoutReasons: Array<{ rule: string; label: string; count: number }>;
  offers: { sent: number; accepted: number; declined: number; acceptanceRate: number | null };
  /* Average whole days spent in each stage, over completed stage moves
     only (an application still in a stage is not counted, so the figure is
     never biased by today's date). Stage history is the audit trail. */
  daysInStage: Array<{ stage: string; averageDays: number | null; moves: number }>;
}

export interface PendingApprovals {
  requisitions: Array<{ id: string; title: string; submittedBy: string; submittedAt: string }>;
  /* The approver decides on the terms, so the latest version's salary and
     the requisition band travel with the item (staff-only route). */
  offers: Array<{
    id: string; requisitionId: string; requisitionTitle: string; candidateName: string; submittedAt: string; submittedBy: string;
    salary: number | null; currency: string; startDate: string; bandMin: number | null; bandMax: number | null;
  }>;
}

/* What is waiting on an approver. The submitter is shown so an approver can
   see at a glance which items they may not approve themselves. */
export function pendingApprovals(store: Store, ctx: Ctx): PendingApprovals {
  const reqs = store.requisitions(ctx).filter(r => r.status === 'pending_approval').map(r => {
    const sub = [...r.approvals].reverse().find(a => a.action === 'submitted');
    return { id: r.id, title: r.title, submittedBy: sub?.byName ?? '', submittedAt: sub?.at ?? r.updatedAt };
  });
  const offers = store.offers(ctx).filter(o => o.status === 'pending_approval').map(o => {
    const req = store.requisition(ctx, o.requisitionId);
    const c = store.candidate(ctx, o.candidateId);
    const sub = [...o.approvals].reverse().find(a => a.action === 'submitted');
    const terms = o.versions.at(-1)?.terms;
    return {
      id: o.id, requisitionId: o.requisitionId, requisitionTitle: req?.title ?? '', candidateName: c?.name ?? '',
      submittedAt: sub?.at ?? o.updatedAt, submittedBy: sub?.byName ?? '',
      salary: terms?.salary ?? null, currency: terms?.currency ?? req?.currency ?? '', startDate: terms?.startDate ?? '',
      bandMin: req?.salaryMin ?? null, bandMax: req?.salaryMax ?? null,
    };
  });
  return { requisitions: reqs, offers };
}

const APPLICATION_STATUSES: ApplicationStatus[] = ['new', 'screened', 'shortlisted', 'knocked_out', 'rejected', 'withdrawn', 'hired'];

/* Deterministic management reporting (ADR-0024): counts and averages only,
   never a model. HR and admin see this; recruiters see their pipeline. */
export function hiringReports(store: Store, ctx: Ctx): HiringReport {
  const requisitions = store.requisitions(ctx);
  const reports: RequisitionReport[] = requisitions.map(r => {
    const apps = store.applications(ctx, { requisitionId: r.id });
    const byStatus = Object.fromEntries(APPLICATION_STATUSES.map(s => [s, 0])) as Record<ApplicationStatus, number>;
    const byStage: Record<string, number> = {};
    let scoreSum = 0; let scoreCount = 0; let overridden = 0;
    for (const a of apps) {
      byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
      byStage[a.stage] = (byStage[a.stage] ?? 0) + 1;
      const s = effectiveScore(a);
      if (s !== null) { scoreSum += s; scoreCount += 1; }
      if (a.override) overridden += 1;
    }
    return {
      requisitionId: r.id, title: r.title, status: r.status,
      applications: apps.length, byStatus, byStage,
      knockedOut: byStatus.knocked_out, overridden,
      averageScore: scoreCount > 0 ? Math.round(scoreSum / scoreCount) : null,
    };
  });
  const totals = reports.reduce((acc, r) => ({
    requisitions: acc.requisitions + 1,
    open: acc.open + (r.status === 'open' ? 1 : 0),
    applications: acc.applications + r.applications,
    knockedOut: acc.knockedOut + r.knockedOut,
    overridden: acc.overridden + r.overridden,
    hired: acc.hired + (r.byStatus.hired ?? 0),
  }), { requisitions: 0, open: 0, applications: 0, knockedOut: 0, overridden: 0, hired: 0 });

  const apps = store.applications(ctx);
  const bySource: Record<string, number> = {};
  const reasons = new Map<string, { rule: string; label: string; count: number }>();
  for (const a of apps) {
    bySource[a.source] = (bySource[a.source] ?? 0) + 1;
    if (a.status !== 'knocked_out') continue;
    for (const k of a.score?.knockouts ?? []) {
      if (k.outcome !== 'knocked_out') continue;
      const key = `${k.rule}:${k.label}`;
      const cur = reasons.get(key) ?? { rule: k.rule, label: k.label, count: 0 };
      cur.count += 1; reasons.set(key, cur);
    }
  }

  const offers = store.offers(ctx);
  const accepted = offers.filter(o => o.status === 'accepted').length;
  const declined = offers.filter(o => o.status === 'declined').length;
  const sent = offers.filter(o => ['sent', 'accepted', 'declined'].includes(o.status)).length;

  /* Stage history: each application enters its first stage when created,
     then every audited stage_advance "<applicationId>:<stage>" moves it. */
  const stages = stagesFor(store, ctx);
  const durations = new Map<string, number[]>();
  /* Oldest first; the sort below is stable, so two moves in the same
     millisecond (a bulk advance) keep the order they were written in. */
  const advances = store.auditList(ctx, 100000).filter(e => e.action === 'stage_advance').reverse();
  for (const a of apps) {
    const moves = advances.filter(e => e.target.startsWith(`${a.id}:`))
      .map(e => ({ stage: e.target.slice(a.id.length + 1), at: Date.parse(e.ts) }))
      .sort((x, y) => x.at - y.at);
    let stage = stages[0]!; let enteredAt = Date.parse(a.createdAt);
    for (const m of moves) {
      const list = durations.get(stage) ?? [];
      list.push((m.at - enteredAt) / 86_400_000);
      durations.set(stage, list);
      stage = m.stage; enteredAt = m.at;
    }
  }
  const daysInStage = stages.map(stage => {
    const list = durations.get(stage) ?? [];
    return { stage, moves: list.length, averageDays: list.length ? Math.round((list.reduce((x, y) => x + y, 0) / list.length) * 10) / 10 : null };
  });

  return {
    generatedAt: new Date().toISOString(), totals, requisitions: reports,
    bySource, knockoutReasons: [...reasons.values()].sort((a, b) => b.count - a.count),
    offers: { sent, accepted, declined, acceptanceRate: sent ? Math.round((accepted / sent) * 100) : null },
    daysInStage,
  };
}

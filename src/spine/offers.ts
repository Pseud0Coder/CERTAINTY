/* Offers (ADR-0024): versioned offer letters behind an internal approval
   workflow, then a candidate accept or decline.

   A version is frozen when written: editing appends a new version, so the
   history and the candidate-facing letter never drift. The letter is
   generated deterministically, no model, and obeys the string rules (L8):
   no em dashes, no emoji. Approval mirrors the requisition rule, the
   approver may never be the submitter. */

import { randomUUID } from 'node:crypto';
import type { Store, Ctx } from './db.ts';
import type { Application, Offer, OfferTerms, OfferVersion, Requisition } from './types.ts';
import { stagesFor, type Actor } from './hiring.ts';
import { queueForEvent } from './communications.ts';

export class OfferError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}

export const OFFER_APPROVERS = ['hr', 'admin'];

export function generateOfferLetter(input: {
  tenantName: string; candidateName: string; requisition: Requisition; terms: OfferTerms;
}): string {
  const salary = input.terms.salary != null
    ? `${input.terms.currency} ${input.terms.salary.toLocaleString('en-US')} per year`
    : 'To be confirmed';
  const lines = [
    input.tenantName,
    '',
    `Dear ${input.candidateName},`,
    '',
    `We are pleased to offer you the position of ${input.requisition.title}${input.requisition.department ? ` in ${input.requisition.department}` : ''}.`,
    '',
    `Salary: ${salary}`,
    `Start date: ${input.terms.startDate || 'To be confirmed'}`,
    `Location: ${input.terms.location || input.requisition.location || 'To be confirmed'}`,
  ];
  if (input.terms.notes) lines.push('', input.terms.notes);
  lines.push('',
    'This offer is subject to the internal approvals recorded on this application.',
    'Please confirm your acceptance or decline from your candidate dashboard.',
    '',
    'We look forward to welcoming you.');
  return lines.join('\n');
}

function requireOffer(store: Store, ctx: Ctx, id: string): Offer {
  const o = store.offer(ctx, id);
  if (!o) throw new OfferError('not_found');
  return o;
}

function requireApplication(store: Store, ctx: Ctx, applicationId: string): Application {
  const a = store.application(ctx, applicationId);
  if (!a) throw new OfferError('application_not_found');
  return a;
}

function requireRequisition(store: Store, ctx: Ctx, id: string): Requisition {
  const r = store.requisition(ctx, id);
  if (!r) throw new OfferError('requisition_not_found');
  return r;
}

function normalizeTerms(input: Partial<OfferTerms>, fallback?: OfferTerms): OfferTerms {
  return {
    salary: input.salary !== undefined ? (input.salary === null ? null : Number(input.salary)) : (fallback?.salary ?? null),
    currency: input.currency !== undefined ? String(input.currency) : (fallback?.currency ?? 'AED'),
    startDate: input.startDate !== undefined ? String(input.startDate) : (fallback?.startDate ?? ''),
    location: input.location !== undefined ? String(input.location) : (fallback?.location ?? ''),
    notes: input.notes !== undefined ? String(input.notes) : (fallback?.notes ?? ''),
  };
}

export function createOffer(store: Store, ctx: Ctx, actor: Actor, applicationId: string, terms: Partial<OfferTerms>): Offer {
  const app = requireApplication(store, ctx, applicationId);
  const req = requireRequisition(store, ctx, app.requisitionId);
  if (store.offerForApplication(ctx, applicationId)) throw new OfferError('offer_exists');
  if (['rejected', 'withdrawn'].includes(app.status)) throw new OfferError('application_not_offereable');
  const now = new Date().toISOString();
  const normalized = normalizeTerms({ currency: req.currency, location: req.location, ...terms });
  const version: OfferVersion = {
    version: 1, terms: normalized,
    letter: generateOfferLetter({ tenantName: store.tenantName(ctx) ?? '', candidateName: store.candidate(ctx, app.candidateId)?.name ?? '', requisition: req, terms: normalized }),
    createdBy: actor.id, createdAt: now,
  };
  const offer: Offer = {
    id: randomUUID(), tenantId: ctx.tenantId, requisitionId: req.id, applicationId,
    candidateId: app.candidateId, status: 'draft', versions: [version], approvals: [],
    decidedAt: null, decisionNote: null, createdBy: actor.id, createdAt: now, updatedAt: now,
  };
  store.insertOffer(offer);
  store.audit(ctx.tenantId, actor.name, actor.role, 'offer_created', offer.id);
  return offer;
}

/* Editing a draft appends a version. Approved or sent offers are not edited;
   a new offer or a version after changes_requested is required. */
export function updateOffer(store: Store, ctx: Ctx, actor: Actor, offerId: string, terms: Partial<OfferTerms>): Offer {
  const offer = requireOffer(store, ctx, offerId);
  if (offer.status !== 'draft') throw new OfferError('not_editable');
  const req = requireRequisition(store, ctx, offer.requisitionId);
  const current = offer.versions.at(-1)!;
  const next = normalizeTerms(terms, current.terms);
  offer.versions.push({
    version: current.version + 1, terms: next,
    letter: generateOfferLetter({ tenantName: store.tenantName(ctx) ?? '', candidateName: store.candidate(ctx, offer.candidateId)?.name ?? '', requisition: req, terms: next }),
    createdBy: actor.id, createdAt: new Date().toISOString(),
  });
  store.updateOffer(ctx, offer);
  store.audit(ctx.tenantId, actor.name, actor.role, 'offer_version_added', offer.id);
  return store.offer(ctx, offerId)!;
}

export function submitOffer(store: Store, ctx: Ctx, actor: Actor, offerId: string): Offer {
  const offer = requireOffer(store, ctx, offerId);
  if (offer.status !== 'draft') throw new OfferError('not_submittable');
  offer.status = 'pending_approval';
  offer.approvals.push({ action: 'submitted', by: actor.id, byName: actor.name, role: actor.role, comment: '', at: new Date().toISOString() });
  store.updateOffer(ctx, offer);
  store.audit(ctx.tenantId, actor.name, actor.role, 'offer_submitted', offer.id);
  return store.offer(ctx, offerId)!;
}

export function decideOffer(
  store: Store, ctx: Ctx, actor: Actor, offerId: string,
  decision: 'approved' | 'rejected' | 'changes_requested', comment = '',
): Offer {
  if (!OFFER_APPROVERS.includes(actor.role)) throw new OfferError('not_approver');
  const offer = requireOffer(store, ctx, offerId);
  if (offer.status !== 'pending_approval') throw new OfferError('not_pending');
  const submitter = [...offer.approvals].reverse().find(a => a.action === 'submitted');
  if (submitter && submitter.by === actor.id) throw new OfferError('approver_is_submitter');
  offer.status = decision === 'approved' ? 'approved' : decision === 'rejected' ? 'rejected' : 'draft';
  offer.approvals.push({ action: decision, by: actor.id, byName: actor.name, role: actor.role, comment, at: new Date().toISOString() });
  store.updateOffer(ctx, offer);
  store.audit(ctx.tenantId, actor.name, actor.role, `offer_${decision}`, offer.id);
  return store.offer(ctx, offerId)!;
}

/* Sending is a human action and advances the application to the offer stage. */
export function sendOffer(store: Store, ctx: Ctx, actor: Actor, offerId: string): Offer {
  const offer = requireOffer(store, ctx, offerId);
  if (offer.status !== 'approved') throw new OfferError('not_approved');
  offer.status = 'sent';
  store.updateOffer(ctx, offer);
  advanceToStage(store, ctx, offer.applicationId, 'Offer');
  store.audit(ctx.tenantId, actor.name, actor.role, 'offer_sent', offer.id);
  const req = store.requisition(ctx, offer.requisitionId);
  queueForEvent(store, ctx, { candidateId: offer.candidateId, applicationId: offer.applicationId, template: 'offer_sent', vars: { role: req?.title ?? '' } });
  return store.offer(ctx, offerId)!;
}

export function respondOffer(store: Store, ctx: Ctx, offerId: string, accept: boolean, note = ''): Offer {
  const offer = requireOffer(store, ctx, offerId);
  if (offer.status !== 'sent') throw new OfferError('not_sent');
  offer.status = accept ? 'accepted' : 'declined';
  offer.decidedAt = new Date().toISOString();
  offer.decisionNote = note;
  store.updateOffer(ctx, offer);
  store.audit(ctx.tenantId, 'candidate', 'candidate', accept ? 'offer_accepted' : 'offer_declined', offer.id);
  if (accept) advanceToStage(store, ctx, offer.applicationId, null, true);
  return store.offer(ctx, offerId)!;
}

/* Move an application to a named stage, or to the final stage when `final`.
   Mirrors the candidate stage and audits like any human stage change. */
function advanceToStage(store: Store, ctx: Ctx, applicationId: string, stage: string | null, final = false): void {
  const app = store.application(ctx, applicationId);
  if (!app) return;
  const stages = stagesFor(store, ctx);
  const target = final ? stages.at(-1)! : stage;
  if (!target || !stages.includes(target)) return;
  app.stage = target;
  app.updatedAt = new Date().toISOString();
  if (final) app.status = 'hired';
  store.updateApplication(ctx, app);
  if (app.primary) store.updateCandidate(ctx, app.candidateId, { stage: target });
  store.audit(ctx.tenantId, 'system', 'system', 'offer_stage_advance', `${app.id}:${target}`);
}

/* Candidate-safe projection: their own terms and letter, never the internal
   approval history or the salary of anyone else. */
export function candidateOfferView(offer: Offer): {
  id: string; status: Offer['status']; version: number; terms: OfferTerms; letter: string;
  decidedAt: string | null; decisionNote: string | null;
} {
  const current = offer.versions.at(-1)!;
  return {
    id: offer.id, status: offer.status, version: current.version,
    terms: current.terms, letter: current.letter,
    decidedAt: offer.decidedAt, decisionNote: offer.decisionNote,
  };
}

/* ADR-0024 offers: versioned terms, an internal approval workflow, then a
   candidate accept or decline. The letter is deterministic and obeys the
   string rules (L8). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/spine/db.ts';
import { seedDemo } from '../src/spine/seed.ts';
import {
  applyToRequisition, createRequisition, decideRequisition, submitRequisition, type Actor,
} from '../src/spine/hiring.ts';
import {
  candidateOfferView, createOffer, decideOffer, generateOfferLetter, respondOffer,
  sendOffer, submitOffer, updateOffer,
} from '../src/spine/offers.ts';

function boot() {
  const store = new Store(':memory:');
  const ids = seedDemo(store);
  const ctx = { tenantId: ids.tenantId };
  const recruiter = store.userByEmail('recruiter@gennext.demo')!;
  const hr = store.createUser(ids.tenantId, 'hr@gennext.demo', 'x', 'hr', 'H. Manager');
  const rec: Actor = { id: recruiter.id, name: recruiter.displayName, role: 'recruiter' };
  const hrm: Actor = { id: hr.id, name: hr.displayName, role: 'hr' };
  const req = createRequisition(store, ctx, rec, { title: 'Senior Platform Engineer', department: 'Platform', location: 'Dubai' });
  submitRequisition(store, ctx, rec, req.id);
  decideRequisition(store, ctx, hrm, req.id, 'approved');
  const { application, candidateId } = applyToRequisition(store, ctx, rec, { requisitionId: req.id, candidateId: ids.candidateId });
  return { store, ids, ctx, rec, hrm, req, application, candidateId };
}

test('an offer is versioned, approved by someone else, then sent', () => {
  const { store, ctx, rec, hrm, application } = boot();
  const offer = createOffer(store, ctx, rec, application.id, { salary: 420000, currency: 'AED', startDate: '2026-11-01' });
  assert.equal(offer.status, 'draft');
  assert.equal(offer.versions.length, 1);

  const edited = updateOffer(store, ctx, rec, offer.id, { salary: 450000 });
  assert.equal(edited.versions.length, 2, 'editing appends a version');
  assert.equal(edited.versions.at(-1)!.terms.salary, 450000);
  assert.equal(edited.versions[0]!.terms.salary, 420000, 'the old version is frozen');

  assert.throws(() => decideOffer(store, ctx, hrm, offer.id, 'approved'), /not_pending/);
  submitOffer(store, ctx, rec, offer.id);
  /* The recruiter is not an approver, and the submitter may not approve. */
  assert.throws(() => decideOffer(store, ctx, rec, offer.id, 'approved'), /not_approver/);
  const approved = decideOffer(store, ctx, hrm, offer.id, 'approved');
  assert.equal(approved.status, 'approved');

  const sent = sendOffer(store, ctx, rec, offer.id);
  assert.equal(sent.status, 'sent');
  assert.equal(store.application(ctx, application.id)!.stage, 'Offer');
  assert.ok(store.auditList(ctx).some(e => e.action === 'offer_sent'));
});

test('the approver may not be the submitter on an offer either', () => {
  const { store, ctx, hrm, application } = boot();
  const offer = createOffer(store, ctx, hrm, application.id, { salary: 1 });
  submitOffer(store, ctx, hrm, offer.id);
  assert.throws(() => decideOffer(store, ctx, hrm, offer.id, 'approved'), /approver_is_submitter/);
});

test('a candidate accepts and the application is hired, on the final stage', () => {
  const { store, ctx, rec, hrm, application } = boot();
  const offer = createOffer(store, ctx, rec, application.id, { salary: 500000, startDate: '2026-12-01' });
  submitOffer(store, ctx, rec, offer.id);
  decideOffer(store, ctx, hrm, offer.id, 'approved');
  sendOffer(store, ctx, rec, offer.id);

  const accepted = respondOffer(store, ctx, offer.id, true, 'Delighted to accept.');
  assert.equal(accepted.status, 'accepted');
  const app = store.application(ctx, application.id)!;
  assert.equal(app.status, 'hired');
  assert.equal(app.stage, 'Placed', 'the agency final stage');
  assert.equal(store.candidate(ctx, application.candidateId)!.stage, 'Placed');
});

test('a candidate declines and the application does not advance', () => {
  const { store, ctx, rec, hrm, application } = boot();
  const offer = createOffer(store, ctx, rec, application.id, { salary: 500000 });
  submitOffer(store, ctx, rec, offer.id);
  decideOffer(store, ctx, hrm, offer.id, 'approved');
  sendOffer(store, ctx, rec, offer.id);
  const declined = respondOffer(store, ctx, offer.id, false, 'Accepted another role.');
  assert.equal(declined.status, 'declined');
  assert.notEqual(store.application(ctx, application.id)!.status, 'hired');
});

test('the letter is deterministic and free of em dashes and emoji (L8)', () => {
  const { store, ctx, application, req } = boot();
  const offer = createOffer(store, ctx, { id: 'r', name: 'R. Osei', role: 'recruiter' }, application.id, { salary: 420000, currency: 'AED', startDate: '2026-11-01', notes: 'Relocation support available.' });
  const letter = offer.versions.at(-1)!.letter;
  assert.ok(letter.includes('Senior Platform Engineer'));
  assert.ok(letter.includes('AED 420,000 per year'));
  assert.ok(!/[\u2014\u2013]/.test(letter), 'no em or en dash');
  assert.ok(!/\p{Extended_Pictographic}/u.test(letter), 'no emoji');
  const again = generateOfferLetter({ tenantName: store.tenantName(ctx)!, candidateName: 'Nadia Rowe', requisition: req, terms: offer.versions.at(-1)!.terms });
  assert.equal(again, letter, 'generation is deterministic');
});

test('the candidate view hides the internal approval history', () => {
  const { store, ctx, rec, hrm, application } = boot();
  const offer = createOffer(store, ctx, rec, application.id, { salary: 500000 });
  submitOffer(store, ctx, rec, offer.id);
  decideOffer(store, ctx, hrm, offer.id, 'approved');
  const view = candidateOfferView(store.offer(ctx, offer.id)!);
  assert.equal('approvals' in view, false);
  assert.equal(view.version, 1);
  assert.ok(view.letter.length > 0);
});

test('a second offer for the same application is refused', () => {
  const { store, ctx, rec, application } = boot();
  createOffer(store, ctx, rec, application.id, { salary: 1 });
  assert.throws(() => createOffer(store, ctx, rec, application.id, { salary: 2 }), /offer_exists/);
});

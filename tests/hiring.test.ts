/* ADR-0024 requisitions and applications through the service: the approval
   rule (the approver may never be the submitter), apply-time de-duplication,
   deterministic scoring on attach, audited overrides, and the tenant stage
   set. The API surface is exercised end to end in the demo-path test. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/spine/db.ts';
import { seedDemo } from '../src/spine/seed.ts';
import { STAGE_SETS } from '../src/spine/types.ts';
import {
  applyToRequisition, createRequisition, decideRequisition, overrideApplication,
  bulkApply, hiringReports, requisitionPipeline, rescoreRequisition, stagesFor, submitRequisition, type Actor,
} from '../src/spine/hiring.ts';

function boot() {
  const store = new Store(':memory:');
  const ids = seedDemo(store);
  const ctx = { tenantId: ids.tenantId };
  const recruiter = store.userByEmail('recruiter@gennext.demo')!;
  const hr = store.createUser(ids.tenantId, 'hr@gennext.demo', 'x', 'hr', 'H. Manager');
  const rec: Actor = { id: recruiter.id, name: recruiter.displayName, role: 'recruiter' };
  const hrm: Actor = { id: hr.id, name: hr.displayName, role: 'hr' };
  const strong = { mustHaves: [{ id: 'a', label: 'REST API design at scale', weight: 3, required: true }] };
  return { store, ids, ctx, rec, hrm, strong };
}

test('approval: draft, submit, approve; the approver may never be the submitter', () => {
  const { store, ctx, rec, hrm, strong } = boot();
  const r = createRequisition(store, ctx, rec, { title: 'Senior Engineer', criteria: strong });
  assert.equal(r.status, 'draft');
  assert.throws(() => decideRequisition(store, ctx, hrm, r.id, 'approved'), /not_pending/);
  const submitted = submitRequisition(store, ctx, rec, r.id);
  assert.equal(submitted.status, 'pending_approval');
  /* A recruiter is not an approver. */
  assert.throws(() => decideRequisition(store, ctx, rec, r.id, 'approved'), /not_approver/);
  const approved = decideRequisition(store, ctx, hrm, r.id, 'approved');
  assert.equal(approved.status, 'open');
  assert.equal(approved.approvals.at(-1)!.by, hrm.id);
  assert.equal(approved.approvals.at(-1)!.byName, 'H. Manager');
  assert.ok(store.auditList(ctx).some(e => e.action === 'requisition_approved'));
});

test('an hr submitter cannot approve their own requisition', () => {
  const { store, ctx, hrm, strong } = boot();
  const r = createRequisition(store, ctx, hrm, { title: 'Ops Lead', criteria: strong });
  submitRequisition(store, ctx, hrm, r.id);
  assert.throws(() => decideRequisition(store, ctx, hrm, r.id, 'approved'), /approver_is_submitter/);
});

test('applying scores immediately and creates a candidate with no login', () => {
  const { store, ids, ctx, rec } = boot();
  const r = createRequisition(store, ctx, rec, { title: 'Senior Engineer' });
  submitRequisition(store, ctx, rec, r.id);
  decideRequisition(store, ctx, { ...rec, id: 'approver', role: 'admin' }, r.id, 'approved');

  const before = store.candidates(ctx).length;
  const result = applyToRequisition(store, ctx, rec, { requisitionId: r.id, name: 'Amara Okafor', email: 'amara@example.test' });
  assert.equal(result.dedup, null);
  assert.equal(store.candidates(ctx).length, before + 1);
  assert.equal(store.candidate(ctx, result.candidateId)!.userId, null, 'no login until invited');
  assert.ok(result.application.score, 'scored on attach');
  assert.equal(store.application(ctx, result.application.id)!.status, 'screened');
  assert.ok(store.auditList(ctx).some(e => e.action === 'application_created'));
  assert.equal(ids.candidateId === result.candidateId, false);
});

test('de-duplication attaches a second application to the existing candidate', () => {
  const { store, ctx, rec } = boot();
  const approval = { ...rec, id: 'approver', role: 'admin' };
  const make = (title: string) => {
    const r = createRequisition(store, ctx, rec, { title });
    submitRequisition(store, ctx, rec, r.id);
    decideRequisition(store, ctx, approval, r.id, 'approved');
    return r;
  };
  const r1 = make('Engineer I');
  const r2 = make('Engineer II');
  const before = store.candidates(ctx).length;
  const first = applyToRequisition(store, ctx, rec, { requisitionId: r1.id, name: 'Same Person', email: 'same@example.test' });
  const second = applyToRequisition(store, ctx, rec, { requisitionId: r2.id, name: 'Same Person', email: 'SAME@example.test' });
  assert.equal(second.candidateId, first.candidateId);
  assert.equal(second.dedup, 'Same email.');
  assert.equal(store.candidates(ctx).length, before + 1, 'no second candidate record');
  assert.equal(second.application.primary, false, 'only the first application is primary');
});

test('a required must-have with no evidence knocks out, and an override includes it, audited', () => {
  const { store, ids, ctx, rec } = boot();
  const r = createRequisition(store, ctx, rec, {
    title: 'Mainframe Engineer',
    criteria: { mustHaves: [{ id: 'a', label: 'Arabic simultaneous interpretation', weight: 2, required: true }] },
  });
  submitRequisition(store, ctx, rec, r.id);
  decideRequisition(store, ctx, { ...rec, id: 'approver', role: 'admin' }, r.id, 'approved');

  const { application } = applyToRequisition(store, ctx, rec, { requisitionId: r.id, candidateId: ids.candidateId });
  assert.equal(application.status, 'knocked_out');
  assert.equal(requisitionPipeline(store, ctx, r.id).rows[0]!.rank, null, 'knocked out is not ranked');

  assert.throws(() => overrideApplication(store, ctx, rec, application.id, { kind: 'adjust', delta: 10, reason: '' }), /reason_required/);
  const overridden = overrideApplication(store, ctx, rec, application.id, { kind: 'include', reason: 'Direct mainframe experience confirmed by reference.' });
  assert.equal(overridden.status, 'screened');
  assert.equal(requisitionPipeline(store, ctx, r.id).rows[0]!.rank, 1);
  assert.ok(store.auditList(ctx).some(e => e.action === 'application_override_include' && e.actor === rec.name));

  /* Re-scoring never clears the override. */
  rescoreRequisition(store, ctx, r.id);
  assert.equal(store.application(ctx, application.id)!.override!.kind, 'include');
});

test('the stage set follows the tenant hiring model', () => {
  const { store, ctx } = boot();
  assert.deepEqual(stagesFor(store, ctx), STAGE_SETS.agency);
  store.setTenantSettings(ctx, { hiringModel: 'in_house' });
  assert.deepEqual(stagesFor(store, ctx), STAGE_SETS.in_house);
});

test('management reporting counts applications, knockouts and overrides', () => {
  const { store, ids, ctx, rec, hrm } = boot();
  const r = createRequisition(store, ctx, rec, {
    title: 'Report Role',
    criteria: { mustHaves: [{ id: 'a', label: 'Arabic simultaneous interpretation', weight: 1, required: true }] },
  });
  submitRequisition(store, ctx, rec, r.id);
  decideRequisition(store, ctx, hrm, r.id, 'approved');
  const { application } = applyToRequisition(store, ctx, rec, { requisitionId: r.id, candidateId: ids.candidateId });
  assert.equal(application.status, 'knocked_out');
  overrideApplication(store, ctx, rec, application.id, { kind: 'include', reason: 'Verified.' });

  const report = hiringReports(store, ctx);
  const row = report.requisitions.find(x => x.requisitionId === r.id)!;
  assert.equal(row.applications, 1);
  assert.equal(row.knockedOut, 0, 'the include moved it out of knocked_out');
  assert.equal(row.overridden, 1);
  assert.equal(report.totals.overridden, 1);
});

test('bulk apply creates, attaches and skips without failing the batch', () => {
  const { store, ctx, rec } = boot();
  const open = (title: string) => {
    const r = createRequisition(store, ctx, rec, { title });
    submitRequisition(store, ctx, rec, r.id);
    decideRequisition(store, ctx, { ...rec, id: 'approver', role: 'admin' }, r.id, 'approved');
    return r;
  };
  const r = open('Bulk Role');
  const r2 = open('Other Role');
  /* C already exists on another requisition, so the bulk row attaches. */
  applyToRequisition(store, ctx, rec, { requisitionId: r2.id, name: 'C', email: 'c@example.test' });
  const result = bulkApply(store, ctx, rec, r.id, [
    { name: 'A', email: 'a@example.test' },
    { name: 'B', email: 'b@example.test' },
    { name: 'C', email: 'c@example.test' },
    { name: 'A', email: 'a@example.test' },
    { name: '' },
  ]);
  assert.equal(result.created, 2);
  assert.equal(result.attached, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.errors, 1);
  assert.equal(result.applicationIds.length, 3);
});

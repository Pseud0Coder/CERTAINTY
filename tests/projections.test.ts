/* L2 invariant tests. The candidate API surface physically cannot return
   internal fields, enforced as a contract, not code review. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/spine/db.ts';
import { seedDemo } from '../src/spine/seed.ts';
import { assertNoInternalFields, candidateSelfView, recruiterCandidateView } from '../src/spine/projections.ts';
import type { Ctx } from '../src/spine/db.ts';

function setup() {
  const store = new Store(':memory:');
  const ids = seedDemo(store);
  return { store, ids, ctx: { tenantId: ids.tenantId } as Ctx };
}

test('candidate projection carries no internal fields', () => {
  const { store, ids, ctx } = setup();
  const view = candidateSelfView(ctx, store, ids.candidateId)!;
  assert.doesNotThrow(() => assertNoInternalFields(view));
  const serialized = JSON.stringify(view);
  assert.ok(!serialized.includes('68,000'), 'current compensation leaked');
  assert.ok(!serialized.includes('Platform work'), 'motivation leaked');
  assert.ok(!serialized.includes('4 weeks'), 'notice period leaked');
});

test('recruiter projection carries internal fields by design', () => {
  const { store, ids, ctx } = setup();
  const view = recruiterCandidateView(ctx, store, ids.candidateId)!;
  assert.equal(view.candidate.currentCompensation, '68,000 GBP');
  assert.equal(view.candidate.motivation, 'Platform work, away from agency accounts');
});

test('assertNoInternalFields rejects a leaked key anywhere in the tree', () => {
  assert.throws(() => assertNoInternalFields({ a: { b: [{ motivation: 'x' }] } }));
  assert.throws(() => assertNoInternalFields({ currentCompensation: '1' }));
});

test('practice sessions are invisible to recruiters', () => {
  const { store, ids, ctx } = setup();
  store.insertSession({
    id: 'p1', tenantId: ctx.tenantId, candidateId: ids.candidateId, flowRunId: null,
    mode: 'practice', status: 'complete', date: '2026-09-13', duration: '05:00',
    star: null, targets: { S: 15, T: 10, A: 50, R: 25 }, ownership: null, trailing: null,
    transcript: [{ t: '00:01', who: 'Nadia', text: 'private answer' }], debrief: null,
    consentId: null, createdAt: new Date().toISOString(),
  });
  const recruiterView = recruiterCandidateView(ctx, store, ids.candidateId)!;
  assert.ok(!recruiterView.sessions.some(s => s.mode === 'practice'));
  const candidateView = candidateSelfView(ctx, store, ids.candidateId)!;
  assert.ok(candidateView.sessions.some(s => s.id === 'p1'));
});

test('candidate never sees recruiter notes artifacts or rejected documents', () => {
  const { store, ids, ctx } = setup();
  store.insertArtifact({
    id: 'rn1', tenantId: ctx.tenantId, candidateId: ids.candidateId, kind: 'recruiter_notes',
    title: 'notes', quarantine: 'clean', fields: {}, sanitizedText: null,
    content: 'compensation details', injectionAttempts: 0, createdBy: 'system',
    createdAt: new Date().toISOString(),
  });
  store.insertArtifact({
    id: 'rj1', tenantId: ctx.tenantId, candidateId: ids.candidateId, kind: 'jd',
    title: 'rejected', quarantine: 'rejected', fields: {}, sanitizedText: 'evil',
    content: null, injectionAttempts: 5, createdBy: 'system', createdAt: new Date().toISOString(),
  });
  const view = candidateSelfView(ctx, store, ids.candidateId)!;
  assert.ok(!view.artifacts.some(a => a.id === 'rn1'));
  assert.ok(!view.artifacts.some(a => a.id === 'rj1'));
});

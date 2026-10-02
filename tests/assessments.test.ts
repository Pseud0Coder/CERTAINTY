/* ADR-0024 assessments: deterministic scoring, cohort normalization, and
   anomaly flags that aid a human rather than replace one. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/spine/db.ts';
import { seedDemo } from '../src/spine/seed.ts';
import {
  candidateAttemptView, createAssessment, detectAnomalies, inviteAttempt, normalize,
  rescoreAssessment, scoreAnswers, startAttempt, submitAttempt,
} from '../src/spine/assessments.ts';
import type { Assessment, Candidate } from '../src/spine/types.ts';

function boot() {
  const store = new Store(':memory:');
  const ids = seedDemo(store);
  const ctx = { tenantId: ids.tenantId };
  const actor = { id: 'u1', name: 'R. Osei', role: 'recruiter' };
  store.updateCandidate(ctx, ids.candidateId, { email: 'nadia@example.test' });
  const assessment = createAssessment(store, ctx, actor, {
    title: 'Platform technical screen', kind: 'technical', durationMinutes: 40, passScore: 60,
    questions: [
      { id: 'q1', prompt: 'Pick the API style.', type: 'mcq', options: ['REST', 'SOAP'], correct: 'REST', points: 2, competency: 'APIs' },
      { id: 'q2', prompt: 'Describe caching.', type: 'text', options: [], correct: null, points: 3, competency: 'Performance', rubric: ['cache', 'ttl', 'invalidation'] },
    ],
  });
  return { store, ids, ctx, actor, assessment };
}

function addCandidate(store: Store, tenantId: string, name: string, email: string): string {
  const now = new Date().toISOString();
  const c: Candidate = {
    id: randomUUID(), tenantId, userId: null, name, targetRole: 'Engineer', targetCompany: '',
    employer: '', tenure: '', cvTenureStart: null, cvTenureEnd: null, stage: 'Screening',
    parked: false, linkedinStatus: '', email, phone: null, source: 'recruiter',
    currentCompensation: null, compExpectations: null, noticePeriod: null, motivation: null, createdAt: now,
  };
  store.insertCandidate(c);
  return c.id;
}

test('multiple choice is exact; text scores on rubric coverage', () => {
  const { assessment } = boot();
  const perfect = scoreAnswers(assessment, { q1: 'rest', q2: 'Use a cache with a TTL and invalidation on write.' });
  assert.equal(perfect.raw, 100);
  assert.equal(perfect.questions[0]!.points, 2, 'case-insensitive exact match');
  const partial = scoreAnswers(assessment, { q1: 'SOAP', q2: 'A cache helps.' });
  assert.equal(partial.questions[0]!.points, 0);
  assert.equal(partial.questions[1]!.points, 1, 'one of three rubric terms');
  assert.equal(partial.raw, 20);
});

test('an invited attempt queues a message; start then submit scores it', () => {
  const { store, ids, ctx, actor, assessment } = boot();
  const attempt = inviteAttempt(store, ctx, actor, assessment.id, ids.candidateId);
  assert.equal(store.messages(ctx, { candidateId: ids.candidateId }).filter(m => m.template === 'assessment_invite').length, 1);
  startAttempt(store, ctx, attempt.id);
  const scored = submitAttempt(store, ctx, attempt.id, { q1: 'REST', q2: 'cache ttl invalidation' }, 30);
  assert.equal(scored.status, 'scored');
  assert.equal(scored.score!.raw, 100);
  assert.equal(scored.score!.normalized, 100, 'single attempt normalizes to 100');
});

test('cohort scores are min-max normalized', () => {
  const { store, ids, ctx, actor, assessment } = boot();
  const c2 = addCandidate(store, ctx.tenantId, 'B', 'b@example.test');
  const c3 = addCandidate(store, ctx.tenantId, 'C', 'c@example.test');
  const a1 = inviteAttempt(store, ctx, actor, assessment.id, ids.candidateId);
  const a2 = inviteAttempt(store, ctx, actor, assessment.id, c2);
  const a3 = inviteAttempt(store, ctx, actor, assessment.id, c3);
  submitAttempt(store, ctx, a1.id, { q1: 'REST', q2: 'cache ttl invalidation' }, 30); // 100
  submitAttempt(store, ctx, a2.id, { q1: 'REST', q2: 'cache' }, 30);                  // 60
  submitAttempt(store, ctx, a3.id, { q1: 'SOAP', q2: 'nothing' }, 30);                // 0
  const attempts = store.attempts(ctx, { assessmentId: assessment.id });
  const byRaw = Object.fromEntries(attempts.map(a => [a.score!.raw, a.score!.normalized]));
  assert.deepEqual(byRaw, { 100: 100, 60: 60, 0: 0 });
});

test('normalize is stable and handles a flat cohort', () => {
  assert.deepEqual(normalize([50, 100]), [0, 100]);
  assert.deepEqual(normalize([70, 70]), [100, 100]);
  assert.deepEqual(normalize([0, 0]), [0, 0]);
});

test('fast completion, straightlining and duplicate attempts are flagged', () => {
  const { store, ids, ctx, actor, assessment } = boot();
  const c2 = addCandidate(store, ctx.tenantId, 'B', 'b@example.test');
  const a1 = submitAttempt(store, ctx, inviteAttempt(store, ctx, actor, assessment.id, ids.candidateId).id, { q1: 'REST', q2: 'cache ttl invalidation' }, 5);
  // second attempt by the same candidate
  store.insertAttempt({ ...store.attempt(ctx, a1.id)!, id: randomUUID(), status: 'invited', answers: {}, score: null, submittedAt: null });
  submitAttempt(store, ctx, inviteAttempt(store, ctx, actor, assessment.id, ids.candidateId).id, { q1: 'REST', q2: 'cache' }, 5);
  const flags = store.attempt(ctx, a1.id)!.score!.flags.map(f => f.type);
  assert.ok(flags.includes('fast_completion'), 'fast completion flagged');
  assert.ok(flags.includes('duplicate_attempt'), 'duplicate flagged');

  const straight = submitAttempt(store, ctx, inviteAttempt(store, ctx, actor, assessment.id, c2).id, { q1: 'REST', q2: '' }, 30);
  // Only one mcq, so straightlining needs two: assert the pure detector instead.
  const synthetic = { ...store.attempt(ctx, straight.id)! };
  const a2 = { ...assessment, questions: [...assessment.questions, { id: 'q3', prompt: 'Pick.', type: 'mcq' as const, options: ['x', 'y'], correct: 'x', points: 1, competency: '', rubric: [] }] } as Assessment;
  const flagged = detectAnomalies(a2, { ...synthetic, answers: { q1: 'REST', q3: 'REST' } }, []);
  assert.ok(flagged.some(f => f.type === 'straightlining'));
});

test('the candidate view hides anomaly flags and correct answers', () => {
  const { store, ids, ctx, actor, assessment } = boot();
  const attempt = submitAttempt(store, ctx, inviteAttempt(store, ctx, actor, assessment.id, ids.candidateId).id, { q1: 'SOAP', q2: '' }, 30);
  const view = candidateAttemptView(attempt);
  assert.deepEqual(Object.keys(view).sort(), ['assessmentId', 'id', 'normalized', 'raw', 'status', 'submittedAt']);
  assert.equal('flags' in view, false);
});

test('creating an assessment needs a title and questions', () => {
  const { store, ctx, actor } = boot();
  assert.throws(() => createAssessment(store, ctx, actor, { title: '' }), /title_required/);
  assert.throws(() => createAssessment(store, ctx, actor, { title: 'Empty', questions: [] }), /questions_required/);
});

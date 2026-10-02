/* ADR-0024 scoring by rules, not by eye. The three invariants the plan
   names must always hold: adding evidence never lowers a score, a knockout
   always excludes a candidate, and every override records who and why. Also
   pinned here: scoring and the profile insight judge a requirement the same
   way, because both call the one matcher. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/spine/db.ts';
import { seedDemo } from '../src/spine/seed.ts';
import { profileInsight } from '../src/spine/insight.ts';
import { FIT_STRENGTH, normalizeRequirement, type RequirementMatch } from '../src/spine/requirement.ts';
import {
  candidateYears, computeScore, effectiveScore, findDuplicate, isEligible,
  progressionStatus, rankApplications, scoreApplication,
} from '../src/spine/scoring.ts';
import type {
  Application, ApplicationScore, MustHave, Requisition, RequisitionCriteria,
} from '../src/spine/types.ts';

const must = (id: string, label: string, weight = 1, required = false): MustHave => ({ id, label, weight, required });
const criteria = (mustHaves: MustHave[], over: Partial<RequisitionCriteria> = {}): RequisitionCriteria =>
  ({ mustHaves, minYears: null, locations: [], remoteOk: false, workAuthRequired: false, ...over });

function req(c: RequisitionCriteria): Requisition {
  return {
    id: 'r1', tenantId: 't1', title: 'Engineer', department: 'Eng', location: 'Dubai', client: null,
    headcount: 1, salaryMin: null, salaryMax: null, currency: 'AED', description: '',
    status: 'open', criteria: c, shortlistAt: null, approvals: [], createdBy: 'u1',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  };
}

const match = (status: RequirementMatch['status']): RequirementMatch =>
  ({ requirement: 'x', status, sources: [], partial: [] });

test('the weighted total is the percentage of requirement weight met', () => {
  const score = computeScore({
    criteria: criteria([must('a', 'A', 3), must('b', 'B', 1)]),
    matches: [match('verified'), match('gap')],
    years: null, location: null, workAuthorized: null,
  });
  assert.equal(score.total, 75, 'three of four weighted points');
  assert.equal(score.components[0]!.points, 3);
  assert.equal(score.components[1]!.points, 0);
});

test('adding evidence never lowers a score', () => {
  const order: RequirementMatch['status'][] = ['gap', 'partial', 'claimed', 'verified'];
  assert.ok(FIT_STRENGTH.gap < FIT_STRENGTH.partial && FIT_STRENGTH.partial < FIT_STRENGTH.claimed && FIT_STRENGTH.claimed < FIT_STRENGTH.verified);
  let previous = -1;
  for (const status of order) {
    const score = computeScore({
      criteria: criteria([must('a', 'A', 2), must('b', 'B', 1)]),
      matches: [match(status), match(status)], years: null, location: null, workAuthorized: null,
    });
    assert.ok(score.total >= previous, `${status} did not lower the score`);
    previous = score.total;
  }
  assert.equal(previous, 100);
});

test('a required must-have with no evidence is a knockout; an optional one is not', () => {
  const score = computeScore({
    criteria: criteria([must('a', 'Kubernetes', 1, true), must('b', 'Nice to have', 1, false)]),
    matches: [match('gap'), match('gap')], years: null, location: null, workAuthorized: null,
  });
  const k = score.knockouts.filter(x => x.outcome === 'knocked_out');
  assert.equal(k.length, 1);
  assert.equal(k[0]!.label, 'Kubernetes');
});

test('an unknown value is a check, never a knockout', () => {
  const score = computeScore({
    criteria: criteria([], { minYears: 5, locations: ['Dubai'], workAuthRequired: true }),
    matches: [], years: null, location: null, workAuthorized: null,
  });
  assert.deepEqual(score.knockouts.map(x => x.outcome), ['check', 'check', 'check']);
  assert.ok(!score.knockouts.some(x => x.outcome === 'knocked_out'));
});

test('years below the minimum is a knockout, at or above it is not', () => {
  const below = computeScore({ criteria: criteria([], { minYears: 5 }), matches: [], years: 3, location: null, workAuthorized: null });
  assert.ok(below.knockouts.some(x => x.rule === 'min_years' && x.outcome === 'knocked_out'));
  const above = computeScore({ criteria: criteria([], { minYears: 5 }), matches: [], years: 7, location: null, workAuthorized: null });
  assert.ok(above.knockouts.some(x => x.rule === 'min_years' && x.outcome === 'pass'));
});

function app(over: Partial<Application>): Application {
  return {
    id: over.id ?? randomUUID(), tenantId: 't1', requisitionId: 'r1', candidateId: 'c1',
    stage: 'Screening', status: 'new', source: 'recruiter', primary: false, answers: {},
    score: null, override: null, dedup: null,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...over,
  };
}

function scoreOf(total: number, verified = 0): ApplicationScore {
  return {
    total, years: null, computedAt: '2026-01-01T00:00:00Z', knockouts: [],
    components: Array.from({ length: 3 }, (_, i) => ({
      mustHaveId: `m${i}`, label: 'x', weight: 1, required: false,
      status: i < verified ? 'verified' : 'gap', strength: i < verified ? 1 : 0,
      points: i < verified ? 1 : 0, maxPoints: 1, sources: [],
    })),
  };
}

test('ranking: score first, then verified count, then earlier application', () => {
  const a = app({ id: 'a', candidateId: 'a', score: scoreOf(60, 0), createdAt: '2026-01-01T00:00:00Z' });
  const b = app({ id: 'b', candidateId: 'b', score: scoreOf(80, 0), createdAt: '2026-01-02T00:00:00Z' });
  const c = app({ id: 'c', candidateId: 'c', score: scoreOf(80, 2), createdAt: '2026-01-03T00:00:00Z' });
  const rows = rankApplications([a, b, c]);
  const rank = (id: string) => rows.find(r => r.application.id === id)!.rank;
  assert.equal(rank('c'), 1, 'same score, more verified');
  assert.equal(rank('b'), 2);
  assert.equal(rank('a'), 3);
});

test('a knockout is excluded from the ranking unless a human includes it', () => {
  const knocked = app({ id: 'k', candidateId: 'k', score: computeScore({
    criteria: criteria([must('a', 'Kubernetes', 1, true)]), matches: [match('gap')], years: null, location: null, workAuthorized: null,
  }) });
  assert.equal(isEligible(knocked), false);
  assert.equal(rankApplications([knocked])[0]!.rank, null);

  const included = { ...knocked, override: { kind: 'include' as const, delta: 0, reason: 'Strong portfolio.', by: 'r1', role: 'recruiter', at: '2026-01-01T00:00:00Z' } };
  assert.equal(isEligible(included), true);
});

test('an override records who and why and moves the effective score', () => {
  const base = app({ score: scoreOf(50) });
  const overridden = {
    ...base,
    override: { kind: 'adjust' as const, delta: 20, reason: 'Equivalent enterprise experience.', by: 'hr1', role: 'hr', at: '2026-01-01T00:00:00Z' },
  };
  assert.equal(effectiveScore(base), 50);
  assert.equal(effectiveScore(overridden), 70);
  assert.equal(overridden.override!.by, 'hr1');
  assert.ok(overridden.override!.reason.length > 0);
  /* Re-scoring never clears the override: a fresh score keeps it. */
  const rescored = { ...overridden, score: scoreOf(40) };
  assert.equal(effectiveScore(rescored), 60);
});

test('progression sets screened and shortlisted by threshold, never downgrades', () => {
  const r = { ...req(criteria([])), shortlistAt: 70 };
  assert.equal(progressionStatus(r, app({ status: 'new', score: scoreOf(50) })), 'screened');
  assert.equal(progressionStatus(r, app({ status: 'screened', score: scoreOf(75) })), 'shortlisted');
  assert.equal(progressionStatus({ ...r, shortlistAt: 90 }, app({ status: 'shortlisted', score: scoreOf(75) })), 'shortlisted');
  assert.equal(progressionStatus(r, app({ status: 'hired', score: scoreOf(90) })), 'hired');
});

test('scoring and the profile insight judge every must-have identically', () => {
  const store = new Store(':memory:');
  const ids = seedDemo(store);
  const ctx = { tenantId: ids.tenantId };
  const jd = store.artifacts(ctx, ids.candidateId, 'jd').at(-1)!;
  const musts = (jd.fields as { mustHave: string[] }).mustHave;
  const score = scoreApplication(store, ctx, req(criteria(musts.map((label, i) => must(`m${i}`, label, 1, true)))), ids.candidateId);
  const insight = profileInsight(store, ctx, ids.candidateId)!;
  assert.equal(score.components.length, musts.length);
  for (let i = 0; i < musts.length; i++) {
    const fit = insight.fit.find(f => f.requirement === normalizeRequirement(musts[i]!))!;
    assert.equal(score.components[i]!.status, fit.status, `status agrees on "${musts[i]}"`);
    assert.deepEqual(score.components[i]!.sources, fit.sources);
  }
});

test('candidate years come from the conservative CV tenure, one decimal', () => {
  const store = new Store(':memory:');
  const ids = seedDemo(store);
  const c = store.candidate({ tenantId: ids.tenantId }, ids.candidateId)!;
  assert.equal(candidateYears(c), 5.2, '08/2015 to 10/2020');
  assert.equal(candidateYears({ ...c, cvTenureStart: null }), null);
});

test('de-duplication matches email, phone, or name with an overlapping employer', () => {
  const store = new Store(':memory:');
  const ids = seedDemo(store);
  const ctx = { tenantId: ids.tenantId };
  const nadia = store.candidate(ctx, ids.candidateId)!;
  store.updateCandidate(ctx, ids.candidateId, { email: 'nadia@example.test', phone: '+971 50 123 4567' });
  assert.equal(findDuplicate(store, ctx, { email: 'NADIA@example.test' })!.candidateId, nadia.id);
  assert.equal(findDuplicate(store, ctx, { phone: '971501234567' })!.candidateId, nadia.id);
  assert.equal(findDuplicate(store, ctx, { name: '  Nadia   Rowe ', employer: 'northline qa labs' })!.candidateId, nadia.id);
  assert.equal(findDuplicate(store, ctx, { email: 'nobody@example.test', name: 'Someone Else' }), null);
});

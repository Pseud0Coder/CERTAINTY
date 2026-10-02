/* The permanent demo scenario (master prompt section 15). If a regression
   breaks this, the build is broken. Also proves tenant isolation (L9). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/spine/db.ts';
import type { Ctx } from '../src/spine/db.ts';
import { seedDemo } from '../src/spine/seed.ts';
import { Engine } from '../src/spine/flows/engine.ts';
import { advance } from '../src/spine/stages.ts';
import { candidateSelfView, recruiterCandidateView } from '../src/spine/projections.ts';

function setup() {
  const store = new Store(':memory:');
  const ids = seedDemo(store);
  const engine = new Engine(store);
  const ctx: Ctx = { tenantId: ids.tenantId };
  return { store, ids, engine, ctx };
}

test('demo loop: flag feeds to candidate, gap resolves, submission generates, QA passes, stage advances', async () => {
  const { store, ids, engine, ctx } = setup();

  /* 1. Recruiter sees one flag of each type on the pipeline. */
  const view = recruiterCandidateView(ctx, store, ids.candidateId)!;
  const types = new Set(view.flags.map(f => f.type));
  for (const t of ['claim_missing_from_cv', 'jd_gap', 'source_conflict', 'metric_confirmed'] as const) {
    assert.ok(types.has(t), `seed carries a ${t} flag`);
  }
  const conflict = view.flags.find(f => f.type === 'source_conflict')!;
  assert.ok(conflict.body.includes('10/2022') && conflict.body.includes('10/2020'), 'both versions stated');

  /* 2. Recruiter feeds the claim flag to the candidate app. */
  const claim = view.flags.find(f => f.type === 'claim_missing_from_cv')!;
  store.setFlagStatus(ctx, claim.id, 'actioned');
  store.insertTask({
    id: 'fed1', tenantId: ctx.tenantId, candidateId: ids.candidateId, type: 'task',
    done: false, source: 'recruiter', title: 'Add the missing line to your CV',
    body: `${claim.body} Your recruiter agrees, it is earned.`, flagId: claim.id,
    createdAt: new Date().toISOString(),
  });

  /* 3. Candidate sees it as a task, severity stripped, and resolves it. */
  const self = candidateSelfView(ctx, store, ids.candidateId)!;
  const fed = self.tasks.find(t => t.id === 'fed1')!;
  assert.ok(!JSON.stringify(fed).includes('Warning'), 'severity stripped from task phrasing');
  store.setTaskDone(ctx, fed.id, true);

  /* 4. Four of four sources: builder generates deliverables, QA green. */
  const run = await engine.startRun(ctx, {
    flowId: 'submission_builder', candidateId: ids.candidateId,
    actorRole: 'recruiter', actor: 'R. Osei',
  });
  assert.equal(run.status, 'awaiting_human', 'run reaches the recruiter review gate');
  assert.equal(run.currentStep, 'deliver');
  const compose = JSON.parse(run.stepStates['out:compose']!) as { qa: Array<{ check: string; pass: boolean }> };
  assert.ok(compose.qa.length >= 5);
  assert.ok(compose.qa.every(q => q.pass), `QA checklist green: ${JSON.stringify(compose.qa.filter(q => !q.pass))}`);
  const arts = store.artifacts(ctx, ids.candidateId);
  assert.ok(arts.some(a => a.kind === 'submission_doc' && a.content));
  assert.ok(arts.some(a => a.kind === 'client_email' && a.content));
  assert.ok(arts.some(a => a.kind === 'recruiter_notes' && a.content));

  /* 5. Human gate: recruiter approves, run completes, stage advances by hand. */
  const resumed = await engine.resume(ctx, run.id, 'R. Osei', 'recruiter', 'approve');
  assert.equal(resumed.status, 'complete');
  const stage = advance(ctx, store, ids.candidateId, 'R. Osei', 'recruiter');
  assert.equal(stage, 'Submission draft');
});

test('demo loop: verified screener needs consent, then yields transcript, metrics and debrief', async () => {
  const { store, ids, engine, ctx } = setup();

  /* L4: the flow waits at the consent gate. No consent, no recording. */
  const run = await engine.startRun(ctx, {
    flowId: 'interview_screener', candidateId: ids.candidateId,
    actorRole: 'candidate', actor: 'Nadia Rowe',
  });
  assert.equal(run.currentStep, 'consent');
  assert.equal(run.status, 'awaiting_human');
  await assert.rejects(() => engine.turn(ctx, run.id, 'start', 'Nadia Rowe'));

  const g = await engine.grantConsent(ctx, run.id, 'Nadia Rowe', 'recording and sharing');
  assert.equal(g.status, 'running');
  const consentId = g.stepStates['_consent']!;
  const consent = store.consent(ctx, consentId)!;
  assert.ok(consent.grantedAt, 'consent stored with a timestamp before capture');

  await engine.turn(ctx, run.id, '', 'Nadia Rowe');
  let last = { run: g };
  const answer = 'I led the work personally and delivered it, reducing effort by 25%';
  for (let i = 0; i < 40 && last.run.status === 'running'; i++) {
    last = await engine.turn(ctx, run.id, answer, 'Nadia Rowe');
  }
  assert.equal(last.run.status, 'complete');

  const session = store.sessions(ctx, ids.candidateId).find(s => s.id === last.run.stepStates['_session'])!;
  assert.equal(session.mode, 'verified');
  assert.equal(session.status, 'complete');
  assert.ok(session.transcript.length >= 10, 'transcript with timecodes');
  assert.ok(session.transcript.every(t => /^\d{2}:\d{2}$/.test(t.t)), 'every turn carries a timecode');
  assert.ok(session.star && session.star.A > session.star.T, 'STAR metrics written');
  assert.ok(typeof session.ownership === 'number');
  assert.ok(session.debrief && session.debrief.includes('Interview debrief'), 'debrief as a text block');

  /* Session evaluator and stage advisor ran as pipeline steps. */
  const flags = store.flags(ctx, ids.candidateId);
  assert.ok(flags.some(f => f.type === 'jd_gap'), 'unevidenced must-have flagged');
  const suggestionRun = store.flowRuns(ctx, ids.candidateId)
    .find(r => r.flowId === 'interview_screener' && r.stepStates['out:suggest']);
  assert.ok(suggestionRun, 'stage advisor wrote a suggestion, advanced nothing');
  assert.equal(store.candidate(ctx, ids.candidateId)!.stage, 'Screening', 'stage unchanged by agents');

  /* Withdrawal stops recording and flags downstream artifacts (L4). */
  engine.withdrawConsent(ctx, consentId, 'Nadia Rowe');
  assert.ok(store.consent(ctx, consent.id)!.withdrawnAt);
});

test('tenant name: each tenant reads only its own name', () => {
  const { store, ids, ctx } = setup();
  const own = store.tenantName(ctx);
  const other = store.tenantName({ tenantId: ids.tenant2Id });
  assert.ok(own && other, 'both seeded tenants are named');
  assert.notEqual(own, other);
  assert.equal(store.tenantName({ tenantId: 'no-such-tenant' }), null);
});

test('tenant isolation: the second tenant sees only its own candidate', async () => {
  const { store, ids, engine } = setup();
  const ctx2: Ctx = { tenantId: ids.tenant2Id };
  /* Iris Vale plus the six seeded applicants to the in-house data role. */
  const candidates = store.candidates(ctx2);
  assert.equal(candidates.length, 7);
  const iris = candidates.find(c => c.name === 'Iris Vale')!;
  assert.ok(iris);
  assert.ok(!candidates.some(c => ['Nadia Rowe', 'Priya Anand', 'Owen Castel'].includes(c.name)));
  assert.equal(store.flags(ctx2, iris.id).length, 0);
  /* Nadia (complete), Priya (halfway through onboarding) and Owen (just starting). */
  assert.equal(store.candidates({ tenantId: ids.tenantId } as Ctx).length, 3);

  /* Flow runs are tenant-scoped too. */
  const run = await engine.startRun(ctx2, {
    flowId: 'submission_builder', candidateId: iris.id,
    actorRole: 'recruiter', actor: 'T. Ellison',
  });
  assert.equal(run.status, 'awaiting_human', 'intake gate: 0 of 4 sources');
  assert.ok(JSON.parse(run.stepStates['compose_blocked']!).count === 0);
  await assert.rejects(
    () => engine.startRun(ctx2, { flowId: 'submission_builder', candidateId: ids.candidateId, actorRole: 'recruiter', actor: 'T. Ellison' }),
    /not found|candidate_not_found/,
  );
});

test('entitlements: the second tenant runs the pipeline module only', () => {
  const { store, ids } = setup();
  const ents = store.entitlements(ids.tenant2Id);
  assert.ok(ents.find(e => e.module === 'pipeline')!.enabled);
  assert.ok(!ents.find(e => e.module === 'screener')!.enabled);
  assert.ok(!ents.find(e => e.module === 'builder')!.enabled);
});

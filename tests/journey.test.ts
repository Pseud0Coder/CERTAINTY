/* The candidate journey (ADR-0009): provisioning, research, gating, CV
   assembly. The recruiter-seeded candidate must walk the chain in order. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/spine/db.ts';
import { quarantine } from '../src/spine/quarantine.ts';
import type { Ctx } from '../src/spine/db.ts';
import { seedDemo, DEMO_PASSWORD } from '../src/spine/seed.ts';
import { Engine } from '../src/spine/flows/engine.ts';
import { provisionCandidate } from '../src/spine/profile.ts';
import { verifyPassword } from '../src/spine/seed.ts';
import { journeyState } from '../src/spine/journey.ts';
import { agentCvAssembler } from '../src/spine/agents.ts';
import { makeToolContext } from '../src/spine/flows/tools.ts';
import { login } from '../src/server/auth.ts';
import type { FlowRun } from '../src/spine/types.ts';
import { randomUUID } from 'node:crypto';

function setup() {
  const store = new Store(':memory:');
  const ids = seedDemo(store);
  const engine = new Engine(store);
  const ctx: Ctx = { tenantId: ids.tenantId };
  return { store, ids, engine, ctx };
}

test('profile agent provisions a candidate with a one-time credential', () => {
  const { store, ctx } = setup();
  const result = provisionCandidate(store, ctx, {
    email: 'new.person@example.test', name: 'New Person',
    targetRole: 'Data Analyst', targetCompany: 'Fenwick Data',
  }, 'R. Osei');
  assert.equal(result.credentials.email, 'new.person@example.test');
  assert.ok(result.credentials.password.length >= 8);
  assert.notEqual(result.credentials.password, DEMO_PASSWORD);
  /* The password is shown once and stored hashed; login works with it. */
  const tryLogin = login(store, 'new.person@example.test', result.credentials.password);
  assert.ok(tryLogin, 'candidate can sign in with the generated password');
  assert.equal(tryLogin!.user.role, 'candidate');
  const stored = store.userByEmail('new.person@example.test')!;
  assert.ok(!stored.passwordHash.includes(result.credentials.password), 'never stored in clear');
  assert.equal(stored.mustChangePassword, true, 'the recruiter-generated password is temporary');
  assert.throws(() => provisionCandidate(store, ctx, {
    email: 'new.person@example.test', name: 'Dup', targetRole: 'x',
  }, 'R. Osei'), /email_exists/);
});

test('research agent writes a report with good, improve and needs work findings', async () => {
  const { store, ids, engine, ctx } = setup();
  const run = await engine.startRun(ctx, {
    flowId: 'research', candidateId: ids.candidateId,
    actorRole: 'candidate', actor: 'Nadia Rowe',
  });
  assert.equal(run.status, 'complete');
  const report = store.artifacts(ctx, ids.candidateId).find(a => a.kind === 'research_report')!;
  const findings = (report.fields as { findings: Array<{ kind: string }> }).findings;
  assert.ok(findings.some(f => f.kind === 'good'), 'green findings');
  assert.ok(findings.some(f => f.kind === 'improve'), 'blue findings');
  assert.ok(findings.some(f => f.kind === 'needs_work'), 'red findings');
});

test('journey gates the sequence: onboarding, research, roles, CV, LinkedIn, interview', async () => {
  const { store, ids, engine, ctx } = setup();
  const provisioned = provisionCandidate(store, ctx, {
    email: 'gate@example.test', name: 'Gate Check', targetRole: 'Analyst', targetCompany: 'Fenwick Data',
  }, 'R. Osei');
  const cid = provisioned.candidate.id;

  /* Fresh candidate: everything locked. */
  let j = journeyState(store, ctx, cid);
  assert.equal(j.onboarding, 'pending');
  assert.equal(j.research, 'pending');
  assert.equal(j.linkedin, 'locked');
  assert.equal(j.interview, 'locked');
  assert.ok(j.unlockNotes['interview']);

  /* Onboarding sources land; research runs automatically in the API, here direct. */
  store.updateCandidate(ctx, cid, { targetCompany: 'Fenwick Data' });
  quarantine(store, ctx, { candidateId: cid, kind: 'jd', title: 'jd', raw: 'Must-have: SQL\nMust-have: Tableau', createdBy: 'test' });
  quarantine(store, ctx, { candidateId: cid, kind: 'resume', title: 'cv', raw: 'Gate Check\nAnalyst\nLondon | +44 | g@example.test\nSKILLS\nData: SQL | Reporting\nTOOLS\nExcel\nEDUCATION\nBSc\nEXPERIENCE\nFenwick Data | Junior Analyst | 01/2021 - 06/2024 | single\n- Built weekly SQL reports for the ops team.', createdBy: 'test' });
  store.insertArtifact({
    id: randomUUID(), tenantId: ctx.tenantId, candidateId: cid, kind: 'linkedin_link',
    title: 'link', quarantine: 'clean', fields: { url: 'https://www.linkedin.com/in/x' },
    sanitizedText: null, content: null, injectionAttempts: 0, createdBy: 'test', createdAt: new Date().toISOString(),
  });
  j = journeyState(store, ctx, cid);
  assert.equal(j.onboarding, 'complete');

  await engine.startRun(ctx, { flowId: 'research', candidateId: cid, actorRole: 'candidate', actor: 'Gate Check' });
  j = journeyState(store, ctx, cid);
  assert.equal(j.research, 'complete');
  assert.equal(j.linkedin, 'locked', 'LinkedIn waits for every role');
  assert.ok(j.roles.length >= 1 && !j.roles[0]!.done);

  /* Every role needs its handoff before the CV assembles. */
  const run: FlowRun = {
    id: randomUUID(), tenantId: ctx.tenantId, flowId: 'resume_studio', flowVersion: 1,
    candidateId: cid, actorRole: 'candidate', status: 'complete', currentStep: null,
    stepStates: {}, retries: {}, error: null, trace: [], toolCalls: {},
    createdAt: new Date().toISOString(),
  };
  const t = makeToolContext({
    store, ctx, run, step: 'cv_assembler', candidateId: cid, actor: 'agent:cv_assembler',
    role: 'system', seq: 0, usedKeys: new Set(), allowlist: ['read_spine', 'write_artifact', 'emit_event'],
  });
  let assembled = agentCvAssembler(t) as { assembled: boolean };
  assert.equal(assembled.assembled, false, 'no CV before the roles are done');
  j = journeyState(store, ctx, cid);
  assert.equal(j.linkedin, 'locked');

  store.insertArtifact({
    id: randomUUID(), tenantId: ctx.tenantId, candidateId: cid, kind: 'handoff_block',
    title: 'bullets', quarantine: 'clean',
    fields: { roleKey: j.roles[0]!.key, bullets: ['Built weekly SQL reports for the ops team, cutting prep time by 40%.'] },
    sanitizedText: null, content: '1. ...', injectionAttempts: 0, createdBy: 'system', createdAt: new Date().toISOString(),
  });
  j = journeyState(store, ctx, cid);
  assert.ok(j.rolesDone, 'all roles done');
  assert.equal(j.linkedin, 'unlocked', 'LinkedIn unlocks after the roles');
  assembled = agentCvAssembler(t) as { assembled: boolean };
  assert.equal(assembled.assembled, true);
  const cv = store.artifacts(ctx, cid).find(a => a.kind === 'cv')!;
  assert.ok(cv.content!.includes('Built weekly SQL reports'), 'CV carries the revamped bullet');
  j = journeyState(store, ctx, cid);
  assert.equal(j.cv, 'complete');
  assert.equal(j.interview, 'locked', 'interview waits for LinkedIn');

  store.insertFlowRun({
    ...run, id: randomUUID(), flowId: 'linkedin_studio', status: 'complete',
  });
  j = journeyState(store, ctx, cid);
  assert.equal(j.linkedin, 'complete');
  assert.equal(j.interview, 'unlocked');
});

test('resume studio runs are per role and validated', async () => {
  const { store, ids, engine, ctx } = setup();
  await assert.rejects(() => engine.startRun(ctx, {
    flowId: 'resume_studio', candidateId: ids.candidateId, actorRole: 'candidate',
    actor: 'Nadia Rowe', roleKey: '99:Nowhere Ltd',
  }), /role_not_found/);
  const roles = journeyState(store, ctx, ids.candidateId).roles;
  const run = await engine.startRun(ctx, {
    flowId: 'resume_studio', candidateId: ids.candidateId, actorRole: 'candidate',
    actor: 'Nadia Rowe', roleKey: roles[1]!.key,
  });
  assert.equal(run.stepStates['_roleKey'], roles[1]!.key);
  assert.equal(run.stepStates['_roleTitle'], roles[1]!.title);
});

test('one candidate can hold one active session per flow', async () => {
  const { store, ids, engine, ctx } = setup();
  const roles = journeyState(store, ctx, ids.candidateId).roles;
  await engine.startRun(ctx, {
    flowId: 'resume_studio', candidateId: ids.candidateId, actorRole: 'candidate',
    actor: 'Nadia Rowe', roleKey: roles[0]!.key,
  });
  await assert.rejects(() => engine.startRun(ctx, {
    flowId: 'resume_studio', candidateId: ids.candidateId, actorRole: 'candidate',
    actor: 'Nadia Rowe', roleKey: roles[1]!.key,
  }), /active_session_exists/);
});

/* Output contracts (A7) and golden transcript evals (A10). Regression in a
   golden transcript blocks release, same severity as a failing unit test. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/spine/db.ts';
import type { Ctx } from '../src/spine/db.ts';
import { seedDemo } from '../src/spine/seed.ts';
import { runContract } from '../src/spine/contracts.ts';
import { evaluateTranscript } from '../src/spine/agents.ts';
import { composeSubmission } from '../src/spine/agents.ts';
import type { ResumeFields } from '../src/spine/agents.ts';

/* The golden transcript: the seed session, verbatim from the demo scenario. */
const GOLDEN = [
  { t: '00:41', who: 'Interviewer', text: 'Tell me about the accessibility automation project. What did you personally own?' },
  { t: '01:03', who: 'Nadia', text: 'The team ran manual WCAG audits, which took weeks. I built the assessment framework and exposed it as a REST API so the checks ran automatically.' },
  { t: '02:15', who: 'Interviewer', text: 'You said "coordinated four engineers". Formal team or project ownership?' },
  { t: '02:31', who: 'Nadia', text: 'Project ownership. They reported to my manager, but I ran the workstream day to day. After the SQL work, processing time dropped by about 30%.' },
  { t: '04:02', who: 'Interviewer', text: 'The client JD lists Kubernetes as a must-have. Where have you run it?' },
  { t: '04:10', who: 'Nadia', text: 'I have not, honestly. We had containerized CI, but I never owned the clusters.' },
  { t: '04:58', who: 'Nadia', text: 'So that was basically it.' },
];

test('golden transcript: metrics are stable across runs', () => {
  const a = evaluateTranscript(GOLDEN);
  const b = evaluateTranscript(GOLDEN);
  assert.deepEqual(a.star, b.star);
  assert.equal(a.ownership, b.ownership);
  assert.equal(a.trailing, b.trailing);
  /* Qualitative expectations: action heavy, ownership mostly first person,
     the trailing end caught, the confirmed metric and the JD gap annotated. */
  assert.ok(a.star.A > a.star.S && a.star.A > a.star.T, `action dominates: ${JSON.stringify(a.star)}`);
  assert.ok(a.ownership >= 55 && a.ownership <= 90, `ownership in band: ${a.ownership}`);
  assert.equal(a.trailing, 1);
  const marks = a.annotations.map(x => x.mark);
  assert.ok(marks.includes('confirmed'), 'metric confirmed annotation');
  assert.ok(marks.includes('gap'), 'gap annotation');
});

test('golden transcript: seed data agrees with the evaluator', () => {
  const store = new Store(':memory:');
  const ids = seedDemo(store);
  const ctx: Ctx = { tenantId: ids.tenantId };
  const session = store.sessions(ctx, ids.candidateId).find(s => s.id === ids.sessionId)!;
  const ev = evaluateTranscript(session.transcript.filter(t => t.who !== 'Interviewer'));
  /* The seed star values are hand-authored demo data (L7); the evaluator must
     agree on the shape: action dominates, ownership is majority first person,
     and trailing ends are caught. */
  const seedMax = Object.entries(session.star!).sort((a, b) => b[1] - a[1])[0]![0];
  const evalMax = Object.entries(ev.star).sort((a, b) => b[1] - a[1])[0]![0];
  assert.equal(evalMax, seedMax, `dominant component agrees: seed ${seedMax} eval ${evalMax}`);
  assert.equal(session.trailing, 2, 'seed records two trailing ends, the evaluator catches the verbatim one');
  assert.ok(ev.annotations.some(a => a.mark === 'confirmed'), 'evaluator confirms the metric the seed confirms');
});

test('em dash lint fails any output containing one', () => {
  const result = runContract({ text: 'a fine sentence' }, { clientFacing: false, currentCompensation: null, cvTenureStart: null, cvTenureEnd: null });
  assert.ok(result.ok);
  const bad = runContract({ text: 'a rushed sentence \u2014 with a dash' }, { clientFacing: false, currentCompensation: null, cvTenureStart: null, cvTenureEnd: null });
  assert.ok(!bad.ok);
  assert.ok(bad.errors.some(e => e.includes('em dash')));
});

test('emoji and all-caps lint', () => {
  const emoji = runContract({ text: 'great job \u{1F389}' }, { clientFacing: false, currentCompensation: null, cvTenureStart: null, cvTenureEnd: null });
  assert.ok(!emoji.ok);
  const caps = runContract({ text: 'MEETING THE OBJECTIVES NOW' }, { clientFacing: false, currentCompensation: null, cvTenureStart: null, cvTenureEnd: null });
  assert.ok(!caps.ok);
});

test('compensation scrubber blocks current comp in client-facing output only', () => {
  const ctxBase = { currentCompensation: '68,000 GBP', cvTenureStart: null, cvTenureEnd: null };
  const leak = runContract({ doc: 'the candidate currently earns 68,000 GBP' }, { ...ctxBase, clientFacing: true });
  assert.ok(!leak.ok, 'client-facing leak must fail');
  const internal = runContract({ notes: 'current compensation 68,000 GBP' }, { ...ctxBase, clientFacing: false });
  assert.ok(internal.ok, 'internal notes may carry it');
});

test('date consistency blocks dates outside the conservative record, client-facing only', () => {
  const ctxBase = { currentCompensation: null, cvTenureStart: '08/2015', cvTenureEnd: '10/2020' };
  const bad = runContract({ doc: 'role ran 09/2022 - 11/2022' }, { ...ctxBase, clientFacing: true });
  assert.ok(!bad.ok);
  const notes = runContract({ notes: 'snapshot says 10/2022, cv says 10/2020' }, { ...ctxBase, clientFacing: false });
  assert.ok(notes.ok, 'notes state all versions by design');
});

test('single-role date exception renders once on the company line', () => {
  const resume: ResumeFields = {
    positioning: 'Senior Software Engineer, FinTech', location: 'London', phone: '+44', email: 'n@example.com',
    roles: [{ company: 'Northline QA Labs', title: 'Senior Software Engineer', start: '07/2019', end: '10/2020', singleRole: true,
      bullets: ['Led WCAG compliance automation: cut audit cycles from weeks to hours.'] }],
    skills: [{ group: 'Engineering', items: ['API design'] }], tools: [], education: [],
  };
  const out = composeSubmission({
    candidate: { name: 'Nadia Rowe', targetRole: 'Senior Software Engineer', employer: 'x', tenure: 'y',
      compExpectations: '75,000', currentCompensation: '68,000', noticePeriod: '4 weeks', motivation: 'm' },
    resume, confirmedMetric: '30% reduction', conflicts: [], gaps: [], toVerify: [],
  });
  const occurrences = out.doc.split('10/2020').length - 1;
  assert.equal(occurrences, 1, 'single-role dates appear exactly once');
  assert.ok(out.qa.every(q => q.pass), `QA green: ${JSON.stringify(out.qa.filter(q => !q.pass))}`);
  assert.ok(!out.email.includes('68,000'), 'email carries expectations, not current comp');
  assert.ok(out.email.includes('75,000'), 'email carries expectations');
});

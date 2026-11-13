/* ADR-0030: batches. One JD read once, many CVs, ranked, triaged, shared by
   the tenant's staff and nobody else. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { Store } from '../src/spine/db.ts';
import { seedDemo, DEMO_PASSWORD } from '../src/spine/seed.ts';
import { Engine } from '../src/spine/flows/engine.ts';
import { handleApi, type ApiDeps } from '../src/server/api.ts';
import { login, userForToken } from '../src/server/auth.ts';
import { candidateName } from '../src/spine/screening.ts';
import { BatchQueue, QueueFullError } from '../src/spine/jobs.ts';
import type { LlmProvider, LlmRequest } from '../src/spine/providers/llm.ts';
import { GOLDEN } from './golden-data.ts';

const jd = GOLDEN.find(c => c.id === 'java-strong')!.jd;
const cvOf = (id: string) => GOLDEN.find(c => c.id === id)!.cv;

async function boot(llm?: LlmProvider) {
  const store = new Store(':memory:');
  const ids = seedDemo(store);
  const deps: ApiDeps = { store, engine: new Engine(store), llm };
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const cookie = (req.headers.cookie ?? '').split(';').map(c => c.trim()).find(c => c.startsWith('certainty_s='));
    const auth = cookie ? userForToken(store, cookie.slice('certainty_s='.length)) : null;
    if (!(await handleApi(req, res, deps, url, auth))) { res.writeHead(404); res.end(); }
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  const as = (email: string) => {
    const s = login(store, email, DEMO_PASSWORD)!;
    const headers = { cookie: `certainty_s=${s.token}; certainty_csrf=${s.csrf}`, 'x-csrf': s.csrf, 'content-type': 'application/json' };
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, body: await res.json().catch(() => ({})) as any };
    };
    const api = { get: (p: string) => call('GET', p), post: (p: string, b: unknown = {}) => call('POST', p, b), del: (p: string) => call('DELETE', p) };
    /* Waits until the batch queue has nothing left to run. */
    const settle = async (batchId: string) => {
      for (let i = 0; i < 300; i++) {
        const b = (await call('GET', `/api/batches/${batchId}`)).body;
        if (!b.queue.some((q: any) => q.status === 'queued' || q.status === 'running')) return b;
        await new Promise(r => setTimeout(r, 10));
      }
      throw new Error('batch did not settle');
    };
    return { ...api, settle };
  };
  return { store, ids, as, close: () => new Promise<void>(r => server.close(() => r())) };
}

test('candidate names come from the top of the CV, else the file name', () => {
  assert.equal(candidateName('Karthik Subramanian\nkarthik@example.com\n', null), 'Karthik Subramanian');
  assert.equal(candidateName('PRIYA NAIR\npriya@example.com', null), 'Priya Nair');
  assert.equal(candidateName('Curriculum Vitae\nAnanya Iyer\n', null), 'Ananya Iyer');
  assert.equal(candidateName('Experience\nSoftware Engineer at Acme 2020 - 2024', 'rohan_mehta_CV.pdf'), 'rohan mehta');
  assert.equal(candidateName('123\n', null), 'Unnamed candidate');
});

test('the queue runs a few at a time, in order, and reports what is left', async () => {
  const q = new BatchQueue({ concurrency: 2, maxWaiting: 4 });
  const gates: Array<() => void> = [];
  const mk = (n: string) => q.enqueue({ tenantId: 't', userId: 'u', batchId: 'b', name: n }, () => new Promise<string>(r => gates.push(() => r(`id-${n}`))));
  const a = mk('a'), b = mk('b'), c = mk('c');
  assert.deepEqual([a.status, b.status, c.status], ['running', 'running', 'queued']);
  assert.equal(q.inFlightFor('u'), 3);
  gates[0]!(); await new Promise(r => setTimeout(r, 5));
  assert.equal(c.status, 'running', 'a freed slot starts the next');
  assert.equal(q.view('t', 'b').map(i => i.name).sort().join(), 'b,c', 'finished items leave the view');
  assert.equal(q.view('other', 'b').length, 0, 'the queue is tenant scoped');
  mk('d'); mk('e');
  assert.throws(() => mk('f'), QueueFullError);
});

test('a batch reads the JD once, ranks CVs by score, and shares percentiles', async () => {
  let rubricCalls = 0;
  const counting: LlmProvider = { name: 'counting', async complete(req: LlmRequest) { if (req.schemaName === 'screening_rubric') rubricCalls++; return null; } };
  const t = await boot(counting);
  try {
    const rec = t.as('recruiter@gennext.demo');
    const created = await rec.post('/api/batches', { jd: { text: jd }, label: 'Backend, Bengaluru' });
    assert.equal(created.status, 200);
    const id = created.body.batch.id;
    assert.ok(created.body.axes.length >= 5, 'the shared axes are shown up front');
    for (const c of ['java-strong', 'wrong-field', 'fresher-vs-senior', 'devops-missing-must']) {
      const added = await rec.post(`/api/batches/${id}/cvs`, { cv: { text: cvOf(c) } });
      assert.equal(added.status, 202);
    }
    const b = await rec.settle(id);
    assert.equal(rubricCalls, 1, 'the JD was read once for the whole batch, not once per CV');
    assert.equal(b.leaderboard.length, 4);
    const scores = b.leaderboard.map((x: any) => x.overall);
    assert.deepEqual(scores, [...scores].sort((a: number, z: number) => z - a), 'ranked best first');
    assert.deepEqual(b.leaderboard.map((x: any) => x.rank), [1, 2, 3, 4]);
    assert.equal(b.leaderboard[0].name, 'Karthik Subramanian');
    assert.equal(b.leaderboard[0].percentile, 100);
    assert.equal(b.leaderboard.at(-1).percentile, 0);
    assert.equal(b.tallies.undecided, 4);
    /* Every CV was judged on the same axes. */
    const detail = await rec.get(`/api/batches/${id}/items/${b.leaderboard[0].id}`);
    assert.deepEqual(detail.body.screening.result.criteria.map((c: any) => c.title), b.axes.map((a: any) => a.title));
  } finally { await t.close(); }
});

test('a batch of one has no percentile, and bad input is refused before queueing', async () => {
  const t = await boot();
  try {
    const rec = t.as('recruiter@gennext.demo');
    assert.equal((await rec.post('/api/batches', { jd: { text: 'too short' } })).body.error, 'jd_too_short');
    const id = (await rec.post('/api/batches', { jd: { text: jd } })).body.batch.id;
    assert.equal((await rec.post(`/api/batches/${id}/cvs`, { cv: { text: 'tiny' } })).body.error, 'cv_too_short');
    assert.equal((await rec.post(`/api/batches/${id}/cvs`, { cv: {} })).body.error, 'cv_required');
    assert.equal((await rec.post('/api/batches/nope/cvs', { cv: { text: cvOf('java-strong') } })).status, 404);
    await rec.post(`/api/batches/${id}/cvs`, { cv: { text: cvOf('java-strong') } });
    const b = await rec.settle(id);
    assert.equal(b.leaderboard[0].percentile, null);
  } finally { await t.close(); }
});

test('candidates cannot use batches, and a batch is invisible to another tenant', async () => {
  const t = await boot();
  try {
    assert.equal((await t.as('nadia@gennext.demo').post('/api/batches', { jd: { text: jd } })).status, 403);
    const id = (await t.as('recruiter@gennext.demo').post('/api/batches', { jd: { text: jd } })).body.batch.id;
    const other = t.as('recruiter@northgate.demo');
    assert.equal((await other.get(`/api/batches/${id}`)).status, 404);
    assert.equal((await other.get('/api/batches')).body.items.length, 0);
    assert.equal((await other.post(`/api/batches/${id}/cvs`, { cv: { text: cvOf('java-strong') } })).status, 404);
    assert.equal((await other.del(`/api/batches/${id}`)).status, 404);
  } finally { await t.close(); }
});

test('delete removes the batch and every CV in it', async () => {
  const t = await boot();
  try {
    const rec = t.as('recruiter@gennext.demo');
    const id = (await rec.post('/api/batches', { jd: { text: jd } })).body.batch.id;
    await rec.post(`/api/batches/${id}/cvs`, { cv: { text: cvOf('java-strong') } });
    await rec.settle(id);
    assert.equal(t.store.batchItems({ tenantId: t.ids.tenantId }, id).length, 1);
    assert.equal((await rec.del(`/api/batches/${id}`)).status, 200);
    assert.equal(t.store.batchItems({ tenantId: t.ids.tenantId }, id).length, 0);
    assert.equal((await rec.get(`/api/batches/${id}`)).status, 404);
  } finally { await t.close(); }
});

test('triage: a person shortlists, maybes or passes; tallies follow; every change is audited', async () => {
  const t = await boot();
  try {
    const rec = t.as('recruiter@gennext.demo');
    const id = (await rec.post('/api/batches', { jd: { text: jd } })).body.batch.id;
    for (const c of ['java-strong', 'wrong-field', 'devops-missing-must']) await rec.post(`/api/batches/${id}/cvs`, { cv: { text: cvOf(c) } });
    const before = await rec.settle(id);
    const [first, second, third] = before.leaderboard.map((x: any) => x.id);
    assert.deepEqual(before.tallies, { shortlist: 0, maybe: 0, pass: 0, undecided: 3 });

    assert.equal((await rec.post(`/api/batches/${id}/items/${first}/decision`, { decision: 'shortlist' })).status, 200);
    assert.equal((await rec.post(`/api/batches/${id}/items/${second}/decision`, { decision: 'maybe' })).status, 200);
    const last = await rec.post(`/api/batches/${id}/items/${third}/decision`, { decision: 'pass' });
    assert.deepEqual(last.body.tallies, { shortlist: 1, maybe: 1, pass: 1, undecided: 0 });
    const after = await rec.get(`/api/batches/${id}`);
    assert.equal(after.body.leaderboard[0].decision, 'shortlist');
    assert.equal(after.body.leaderboard[0].decidedBy, 'R. Osei', 'who decided is kept');

    const cleared = await rec.post(`/api/batches/${id}/items/${first}/decision`, { decision: null });
    assert.deepEqual(cleared.body.tallies, { shortlist: 0, maybe: 1, pass: 1, undecided: 1 });
    assert.equal((await rec.get(`/api/batches/${id}`)).body.leaderboard[0].decidedBy, null);

    assert.equal((await rec.post(`/api/batches/${id}/items/${first}/decision`, { decision: 'hire' })).body.error, 'invalid_decision');
    assert.equal((await rec.post(`/api/batches/${id}/items/${first}/decision`, { decision: 'advance' })).status, 400);
    assert.equal((await rec.post(`/api/batches/${id}/items/nope/decision`, { decision: 'pass' })).status, 404);

    const audit = t.store.auditList({ tenantId: t.ids.tenantId }).filter(e => e.action === 'triage_decision');
    assert.equal(audit.length, 4);
    assert.ok(audit.every(e => e.actor === 'R. Osei'));
  } finally { await t.close(); }
});

test('triage is staff only, tenant scoped, and a decision never changes the score', async () => {
  const t = await boot();
  try {
    const rec = t.as('recruiter@gennext.demo');
    const id = (await rec.post('/api/batches', { jd: { text: jd } })).body.batch.id;
    await rec.post(`/api/batches/${id}/cvs`, { cv: { text: cvOf('java-strong') } });
    const b = await rec.settle(id);
    const sid = b.leaderboard[0].id;
    assert.equal((await t.as('nadia@gennext.demo').post(`/api/batches/${id}/items/${sid}/decision`, { decision: 'pass' })).status, 403);
    assert.equal((await t.as('recruiter@northgate.demo').post(`/api/batches/${id}/items/${sid}/decision`, { decision: 'pass' })).status, 404);
    await rec.post(`/api/batches/${id}/items/${sid}/decision`, { decision: 'pass' });
    const after = await rec.get(`/api/batches/${id}`);
    assert.equal(after.body.leaderboard[0].overall, b.leaderboard[0].overall);
    assert.equal(after.body.leaderboard[0].recommendation, b.leaderboard[0].recommendation);
    /* A teammate sees and can change it. */
    const hr = t.as('admin@gennext.demo');
    assert.equal((await hr.get(`/api/batches/${id}`)).body.leaderboard[0].decision, 'pass');
    assert.equal((await hr.post(`/api/batches/${id}/items/${sid}/decision`, { decision: 'shortlist' })).status, 200);
  } finally { await t.close(); }
});

test('CVs arrive as real Word and PDF files, and the file name is kept', async () => {
  const { readFileSync } = await import('node:fs');
  const t = await boot();
  try {
    const rec = t.as('recruiter@gennext.demo');
    const id = (await rec.post('/api/batches', { jd: { text: jd } })).body.batch.id;
    for (const f of ['cv-word.docx', 'cv-two-column.pdf']) {
      const b64 = readFileSync(new URL(`./fixtures/${f}`, import.meta.url)).toString('base64');
      const res = await rec.post(`/api/batches/${id}/cvs`, { cv: { filename: f, dataBase64: b64 } });
      assert.equal(res.status, 202, `${f}: ${JSON.stringify(res.body)}`);
    }
    const b = await rec.settle(id);
    assert.equal(b.leaderboard.length, 2);
    assert.deepEqual(b.leaderboard.map((x: any) => x.file).sort(), ['cv-two-column.pdf', 'cv-word.docx']);
    assert.equal((await rec.post(`/api/batches/${id}/cvs`, { cv: { filename: 'x.pdf', dataBase64: Buffer.from('not a pdf').toString('base64') } })).status, 400);
  } finally { await t.close(); }
});

/* ---------- team, retention and caps (ADR-0030) ---------- */

import { applyRetention } from '../src/spine/retention.ts';

test('a teammate sees the batch, knows whose it is, and can add CVs to it', async () => {
  const t = await boot();
  try {
    const rec = t.as('recruiter@gennext.demo');
    const admin = t.as('admin@gennext.demo');
    const id = (await rec.post('/api/batches', { jd: { text: jd }, label: 'Shared role' })).body.batch.id;
    await rec.post(`/api/batches/${id}/cvs`, { cv: { text: cvOf('java-strong') } });
    await rec.settle(id);
    const mine = (await rec.get(`/api/batches/${id}`)).body.batch.mine;
    const theirs = await admin.get(`/api/batches/${id}`);
    assert.equal(mine, true);
    assert.equal(theirs.body.batch.mine, false);
    assert.equal(theirs.body.leaderboard.length, 1);
    assert.deepEqual((await admin.get('/api/batches')).body.items.map((b: any) => b.label), ['Shared role']);
    assert.equal((await admin.post(`/api/batches/${id}/cvs`, { cv: { text: cvOf('devops-missing-must') } })).status, 202);
    assert.equal((await admin.settle(id)).leaderboard.length, 2);
    /* A single screening stays private to whoever ran it. */
    const single = await rec.post('/api/screenings', { cv: { text: cvOf('java-strong') }, jd: { text: jd } });
    assert.equal(single.status, 202);
  } finally { await t.close(); }
});

test('batches expire with their CVs: an emptied old batch goes, one with a recent CV stays', async () => {
  const t = await boot();
  try {
    const ctx = { tenantId: t.ids.tenantId };
    const rec = t.store.userByEmail('recruiter@gennext.demo')!;
    const old = new Date(Date.now() - 200 * 24 * 3600 * 1000).toISOString();
    const recent = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
    t.store.insertBatch(ctx, rec.id, { id: 'b-old', label: 'Old', jdText: jd, rubric: {}, createdAt: old });
    t.store.insertBatch(ctx, rec.id, { id: 'b-mixed', label: 'Mixed', jdText: jd, rubric: {}, createdAt: old });
    const row = (id: string, batchId: string, createdAt: string) => t.store.insertScreening(ctx, rec.id, { id, jobTitle: null, overall: 3, recommendation: 'Moderate Match', result: {}, cvText: 'cv', jdText: 'jd', meta: {}, createdAt, batchId, candidateName: id });
    row('s-old', 'b-old', old); row('s-mixed-old', 'b-mixed', old); row('s-mixed-new', 'b-mixed', recent);
    assert.equal(applyRetention(t.store), 2);
    assert.deepEqual(t.store.listBatches(ctx).map(b => b.id), ['b-mixed']);
    assert.deepEqual(t.store.batchItems(ctx, 'b-mixed').map(i => i.id), ['s-mixed-new']);
  } finally { await t.close(); }
});

test('CVs in a batch count against the daily caps, and the cap stops the next one', async () => {
  const t = await boot();
  const prev = process.env.CERTAINTY_SCREEN_DAILY_LIMIT;
  try {
    const rec = t.as('recruiter@gennext.demo');
    const id = (await rec.post('/api/batches', { jd: { text: jd } })).body.batch.id;
    process.env.CERTAINTY_SCREEN_DAILY_LIMIT = '2';
    assert.equal((await rec.post(`/api/batches/${id}/cvs`, { cv: { text: cvOf('java-strong') } })).status, 202);
    assert.equal((await rec.post(`/api/batches/${id}/cvs`, { cv: { text: cvOf('devops-missing-must') } })).status, 202);
    const third = await rec.post(`/api/batches/${id}/cvs`, { cv: { text: cvOf('wrong-field') } });
    assert.equal(third.status, 429);
    assert.equal(third.body.error, 'daily_limit_reached');
    assert.equal((await rec.settle(id)).leaderboard.length, 2);
  } finally {
    if (prev === undefined) delete process.env.CERTAINTY_SCREEN_DAILY_LIMIT; else process.env.CERTAINTY_SCREEN_DAILY_LIMIT = prev;
    await t.close();
  }
});

test('a provider that throws degrades the wording of a result and never fails it', async () => {
  const breaking: LlmProvider = { name: 'breaking', async complete() { throw new Error('secret internal detail'); } };
  const t = await boot(breaking);
  try {
    const rec = t.as('recruiter@gennext.demo');
    const id = (await rec.post('/api/batches', { jd: { text: jd } })).body.batch.id;
    await rec.post(`/api/batches/${id}/cvs`, { cv: { text: cvOf('java-strong') } });
    const b = await rec.settle(id);
    assert.equal(b.leaderboard.length, 1, 'the CV was still screened, by the deterministic reading');
    assert.equal(b.leaderboard[0].producer, 'scripted');
    assert.equal(b.queue.length, 0);
  } finally { await t.close(); }
});

test('a queued CV whose work fails is reported by code, never by message, and the others run', async () => {
  const q = new BatchQueue({ concurrency: 1 });
  const bad = q.enqueue({ tenantId: 't', userId: 'u', batchId: 'b', name: 'bad' }, async () => { throw new Error('secret internal detail'); });
  const coded = q.enqueue({ tenantId: 't', userId: 'u', batchId: 'b', name: 'coded' }, async () => { const e = new Error('x') as Error & { code: string }; e.code = 'cv_too_short'; throw e; });
  const good = q.enqueue({ tenantId: 't', userId: 'u', batchId: 'b', name: 'good' }, async () => 'id-good');
  await new Promise(r => setTimeout(r, 20));
  assert.equal(bad.status, 'failed'); assert.equal(bad.error, 'screening_failed');
  assert.equal(coded.error, 'cv_too_short');
  assert.equal(good.status, 'done'); assert.equal(good.screeningId, 'id-good');
  assert.deepEqual(q.view('t', 'b').map(i => i.name).sort(), ['bad', 'coded'], 'failed items stay visible, done ones leave');
  assert.ok(!JSON.stringify(q.view('t', 'b')).includes('secret'));
});

test('each leaderboard row names the must-haves it has no evidence for', async () => {
  const t = await boot();
  try {
    const rec = t.as('recruiter@gennext.demo');
    const id = (await rec.post('/api/batches', { jd: { text: jd } })).body.batch.id;
    for (const c of ['java-strong', 'wrong-field']) await rec.post(`/api/batches/${id}/cvs`, { cv: { text: cvOf(c) } });
    const b = await rec.settle(id);
    const good = b.leaderboard.find((x: any) => x.name === 'Karthik Subramanian');
    const bad = b.leaderboard.find((x: any) => x.name === 'Meera Joshi');
    assert.deepEqual(good.gaps, []);
    assert.ok(bad.gaps.length >= 3 && bad.gaps.every((g: string) => g.length <= 70), `gaps: ${bad.gaps.join(' | ')}`);
    assert.ok(bad.gaps.some((g: string) => /spring|kafka|aws/i.test(g)));
    assert.equal(bad.mustMissing >= bad.gaps.length, true);
  } finally { await t.close(); }
});

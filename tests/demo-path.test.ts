/* The client demo path, through the real HTTP router, end to end (ADR-0024).
   This is the consistency anchor the plan names: every batch extends it, and
   if a feature breaks the flow, the build fails.

   Built so far: requisition -> approval -> apply -> deterministic scoring and
   ranking -> human override. Later batches append: bulk CV parsing, knockout
   reporting, voice interview -> transcript/summary, offers and acceptance. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { Store } from '../src/spine/db.ts';
import { seedDemo, DEMO_PASSWORD, hashPassword } from '../src/spine/seed.ts';
import { Engine } from '../src/spine/flows/engine.ts';
import { handleApi, type ApiDeps } from '../src/server/api.ts';
import { login, userForToken } from '../src/server/auth.ts';
import { createRequisition, decideRequisition, submitRequisition, type Actor } from '../src/spine/hiring.ts';

async function boot() {
  const store = new Store(':memory:');
  const ids = seedDemo(store);
  store.createUser(ids.tenantId, 'hr@gennext.demo', hashPassword(DEMO_PASSWORD), 'hr', 'H. Manager');
  const engine = new Engine(store);
  const deps: ApiDeps = { store, engine };
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const cookie = (req.headers.cookie ?? '').split(';').map(c => c.trim()).find(c => c.startsWith('certainty_s='));
    const auth = cookie ? userForToken(store, cookie.slice('certainty_s='.length)) : null;
    if (!(await handleApi(req, res, deps, url, auth))) { res.writeHead(404); res.end(); }
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;

  const as = (email: string, password = DEMO_PASSWORD) => {
    const s = login(store, email, password);
    assert.ok(s, `login ${email}`);
    const headers = { cookie: `certainty_s=${s!.token}; certainty_csrf=${s!.csrf}`, 'x-csrf': s!.csrf, 'content-type': 'application/json' };
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, body: await res.json().catch(() => ({})) as any };
    };
    return { get: (p: string) => call('GET', p), post: (p: string, b: unknown = {}) => call('POST', p, b) };
  };
  const anon = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => ({})) as any };
  };
  return { store, ids, as, anon, close: () => new Promise<void>(r => server.close(() => r())) };
}

test('demo path: requisition, approval, apply, rank and override through the router', async () => {
  const t = await boot();
  try {
    const rec = t.as('recruiter@gennext.demo');
    const hr = t.as('hr@gennext.demo');

    /* 1. A recruiter drafts a requisition with weighted, required must-haves. */
    const created = await rec.post('/api/requisitions', {
      title: 'Senior Platform Engineer', department: 'Platform', location: 'Dubai', client: 'Ledgerline',
      criteria: {
        mustHaves: [
          { label: 'REST API design at scale', weight: 3, required: true },
          { label: 'Arabic simultaneous interpretation', weight: 1, required: true },
        ],
        minYears: 2,
      },
      shortlistAt: 60,
    });
    assert.equal(created.status, 200);
    const reqId = created.body.requisition.id as string;
    assert.equal(created.body.requisition.status, 'draft');

    /* 2. Submitted, then approved by a different person: the approver may not
       be the submitter, and a recruiter may not approve at all. */
    assert.equal((await rec.post(`/api/requisitions/${reqId}/submit`)).body.requisition.status, 'pending_approval');
    assert.equal((await rec.post(`/api/requisitions/${reqId}/decision`, { decision: 'approved' })).status, 403);
    assert.equal((await hr.post(`/api/requisitions/${reqId}/decision`, { decision: 'approved' })).body.requisition.status, 'open');

    /* 3. Attach an existing candidate; scoring is deterministic and a required
       must-have with no evidence knocks out. */
    const applied = await rec.post(`/api/requisitions/${reqId}/apply`, { candidateId: t.ids.candidateId });
    assert.equal(applied.status, 200);
    const appId = applied.body.applicationId as string;
    let detail = await rec.get(`/api/requisitions/${reqId}`);
    assert.equal(detail.body.rows.length, 1);
    assert.equal(detail.body.rows[0].application.status, 'knocked_out');
    assert.equal(detail.body.rows[0].rank, null);

    /* 4. A human override includes it, with a reason, and it enters the rank. */
    assert.equal((await rec.post(`/api/applications/${appId}/override`, { kind: 'include', reason: 'Interpretation verified by reference.' })).status, 200);
    detail = await rec.get(`/api/requisitions/${reqId}`);
    assert.equal(detail.body.rows[0].rank, 1);
    assert.ok(t.store.auditList({ tenantId: t.ids.tenantId }).some(e => e.action === 'application_override_include'));

    /* 5. Offer: draft, submitted, approved by a different person, sent, then
       accepted by the candidate from their own dashboard. */
    const offer = await rec.post(`/api/applications/${appId}/offers`, { terms: { salary: 500000, currency: 'AED', startDate: '2026-12-01' } });
    assert.equal(offer.status, 200);
    const offerId = offer.body.offer.id as string;
    await rec.post(`/api/offers/${offerId}/submit`);
    assert.equal((await rec.post(`/api/offers/${offerId}/decision`, { decision: 'approved' })).status, 403);
    assert.equal((await hr.post(`/api/offers/${offerId}/decision`, { decision: 'approved' })).body.offer.status, 'approved');
    assert.equal((await rec.post(`/api/offers/${offerId}/send`)).body.offer.status, 'sent');
    const nadia = t.as('nadia@gennext.demo');
    assert.equal((await nadia.get('/api/candidate/offers')).body.offers.length, 1);
    assert.equal((await nadia.post(`/api/candidate/offers/${offerId}/respond`, { accept: true })).body.offer.status, 'accepted');

    /* 6. The apply page is public: only an open requisition resolves and no
       salary, approvals or internal criteria leave the server. */
    const openReq = createReqViaStore(t, 'Public Role');
    const pub = await t.anon('GET', `/api/public/requisitions/${openReq}`);
    assert.equal(pub.status, 200);
    assert.equal('salaryMin' in pub.body.requisition, false);
    assert.equal('approvals' in pub.body.requisition, false);
    /* Consent and a CV are both required; the consent is stored as a record. */
    const cv = fixture('cv-word.docx');
    assert.equal((await t.anon('POST', `/api/public/apply/${openReq}`, { name: 'Walk In', email: 'walkin@example.test', dataBase64: cv })).body.error, 'consent_required');
    assert.equal((await t.anon('POST', `/api/public/apply/${openReq}`, { name: 'Walk In', email: 'walkin@example.test', consent: true })).body.error, 'cv_required');
    const pubApply = await t.anon('POST', `/api/public/apply/${openReq}`, {
      name: 'Walk In', email: 'walkin@example.test', consent: true, filename: 'cv.docx', dataBase64: cv,
      answers: { workAuthorized: 'no' },
    });
    assert.equal(pubApply.status, 200);
    const walkIn = t.store.candidates({ tenantId: t.ids.tenantId }).find(c => c.email === 'walkin@example.test')!;
    assert.ok(walkIn, 'applicant created from the apply page');
    assert.ok(t.store.artifacts({ tenantId: t.ids.tenantId }, walkIn.id, 'resume').length === 1, 'their CV is attached as evidence');
    const walkApp = t.store.applications({ tenantId: t.ids.tenantId }, { candidateId: walkIn.id })[0]!;
    assert.equal(walkApp.score!.knockouts.find(k => k.rule === 'work_authorization')!.outcome, 'knocked_out',
      'the apply form answer reaches the knockout rule');
  } finally { await t.close(); }
});

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url)).toString('base64');

test('demo path: bulk CV upload is parsed, de-duplicated and ranked on evidence', async () => {
  const t = await boot();
  try {
    const rec = t.as('recruiter@gennext.demo');
    const hr = t.as('hr@gennext.demo');
    const reqId = (await rec.post('/api/requisitions', {
      title: 'Backend Engineer', client: 'Harbourline',
      criteria: {
        mustHaves: [
          { label: 'Kafka', weight: 3, required: true },
          { label: 'Kubernetes', weight: 2, required: false },
          { label: 'Terraform', weight: 1, required: false },
        ],
        minYears: 3,
      },
      shortlistAt: 60,
    })).body.requisition.id as string;
    await rec.post(`/api/requisitions/${reqId}/submit`);
    await hr.post(`/api/requisitions/${reqId}/decision`, { decision: 'approved' });

    /* Two real CV files: a two-column PDF and a Word file. */
    const ravi = await rec.post(`/api/requisitions/${reqId}/upload`, { filename: 'ravi.pdf', dataBase64: fixture('cv-two-column.pdf') });
    assert.equal(ravi.status, 200);
    assert.equal(ravi.body.name, 'Ravi Menon', 'the name is read from the CV itself');
    assert.equal(ravi.body.created, true);
    assert.equal(ravi.body.rolesRead, 2);
    const amara = await rec.post(`/api/requisitions/${reqId}/upload`, { filename: 'amara.docx', dataBase64: fixture('cv-word.docx') });
    assert.equal(amara.body.name, 'Amara Okafor');

    /* Ranked on evidence from the CVs, not on names. */
    const detail = await rec.get(`/api/requisitions/${reqId}`);
    const row = (name: string) => detail.body.rows.find((x: any) => x.candidate.name === name);
    assert.equal(row('Ravi Menon').rank, 1, 'Kafka, Kubernetes and Terraform are all in his CV');
    assert.ok(row('Ravi Menon').application.score.total >= 60);
    assert.ok(row('Ravi Menon').application.score.years >= 5, 'years span his dated roles, not one role');
    assert.equal(row('Amara Okafor').application.status, 'knocked_out', 'no Kafka in her CV, and it is required');
    assert.equal(row('Amara Okafor').rank, null);

    /* The same file again attaches to the existing candidate, explained. */
    const again = await rec.post(`/api/requisitions/${reqId}/upload`, { filename: 'ravi-copy.pdf', dataBase64: fixture('cv-two-column.pdf') });
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'already_applied');
    assert.equal(t.store.candidates({ tenantId: t.ids.tenantId }).filter(c => c.name === 'Ravi Menon').length, 1, 'no duplicate candidate');

    /* An unreadable file is refused before any candidate is created. */
    const before = t.store.candidates({ tenantId: t.ids.tenantId }).length;
    const bad = await rec.post(`/api/requisitions/${reqId}/upload`, { filename: 'x.pdf', dataBase64: Buffer.from('not a document').toString('base64') });
    assert.equal(bad.body.error, 'unsupported_format');
    assert.equal(t.store.candidates({ tenantId: t.ids.tenantId }).length, before);
  } finally { await t.close(); }
});

/* Helper: drive a requisition to open without the router, for the public test. */
function createReqViaStore(t: Awaited<ReturnType<typeof boot>>, title: string): string {
  const ctx = { tenantId: t.ids.tenantId };
  const rec: Actor = { id: 'r', name: 'R. Osei', role: 'recruiter' };
  const admin: Actor = { id: 'a', name: 'A. Mensah', role: 'admin' };
  const r = createRequisition(t.store, ctx, rec, { title, criteria: { mustHaves: [], workAuthRequired: true } });
  submitRequisition(t.store, ctx, rec, r.id);
  decideRequisition(t.store, ctx, admin, r.id, 'approved');
  return r.id;
}

/* P0 verification harness (experiment 2026-09-28-p0-voice-consent-webhook-auth).
   H1a: token minting requires the consent chain. H1b: webhooks are refused
   unsigned, and refused without an active consented session. H1c: candidate
   resolution accepts the real payload shapes (string metadata, room name).
   Deterministic and offline: the SDK verifier runs locally on fake keys. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { Store } from '../src/spine/db.ts';
import type { Ctx } from '../src/spine/db.ts';
import { seedDemo } from '../src/spine/seed.ts';
import { Engine } from '../src/spine/flows/engine.ts';
import {
  voiceChain, mintVoiceToken, verifyVoiceWebhook, resolveVoiceIdentity, ingestVoicePayload,
  VoiceError, type LivekitConfig,
} from '../src/server/livekit.ts';

const CFG: LivekitConfig = {
  url: 'wss://fake.livekit.cloud', key: 'fake-key', secret: 'fake-secret-p0-experiment',
};

/* Mirrors the SDK TokenVerifier contract: HS256, iss = API key, exp required,
   sha256 claim = standard base64 of SHA-256(raw body). */
function sign(secret: string, body: string, opts: { expOffset?: number; iss?: string } = {}): string {
  const b64url = (s: string) => Buffer.from(s).toString('base64url');
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const sha256 = createHash('sha256').update(body).digest('base64');
  const payload = b64url(JSON.stringify({
    iss: opts.iss ?? CFG.key, sub: 'webhook',
    exp: Math.floor(Date.now() / 1000) + (opts.expOffset ?? 300), sha256,
  }));
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

function setup() {
  const store = new Store(':memory:');
  const ids = seedDemo(store);
  const engine = new Engine(store);
  const ctx: Ctx = { tenantId: ids.tenantId };
  return { store, ids, engine, ctx };
}

async function consentedChain() {
  const s = setup();
  const started = await s.engine.startRun(s.ctx, {
    flowId: 'interview_screener', candidateId: s.ids.candidateId,
    actorRole: 'candidate', actor: 'Nadia Rowe', mode: 'verified',
  });
  const run = await s.engine.grantConsent(s.ctx, started.id, 'Nadia Rowe', 'recording and sharing');
  return { ...s, run };
}

const bullet = (candidateId: string, extra: Record<string, string> = {}): string => JSON.stringify({
  participant: { metadata: JSON.stringify({ candidateId, ...extra }) },
  data: { resume_bullet: [{ ownership: 'owned the migration', action: 'migrated the service', outcome: 'zero downtime' }] },
});

/* ---------- H1a: the consent chain gates token minting ---------- */

test('H1a: a run parked at the consent gate has no chain', async () => {
  const { store, ids, engine, ctx } = setup();
  const run = await engine.startRun(ctx, {
    flowId: 'interview_screener', candidateId: ids.candidateId,
    actorRole: 'candidate', actor: 'Nadia Rowe', mode: 'verified',
  });
  assert.equal(run.currentStep, 'consent');
  assert.throws(() => voiceChain(store, ctx, ids.candidateId, run.id),
    (e: unknown) => e instanceof VoiceError && e.code === 'consent_required');
  assert.throws(() => voiceChain(store, ctx, ids.candidateId, randomUUID()),
    (e: unknown) => e instanceof VoiceError && e.code === 'voice_run_not_found');
});

test('H1a: the full chain mints a token carrying session and consent', async () => {
  const { store, ctx, ids, run } = await consentedChain();
  const chain = voiceChain(store, ctx, ids.candidateId, run.id);
  assert.equal(chain.session.mode, 'verified');
  assert.ok(chain.session.consentId);
  const token = await mintVoiceToken(CFG, chain, 'Nadia Rowe');
  const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as {
    iss: string; exp: number; metadata: string;
  };
  assert.equal(claims.iss, CFG.key);
  assert.ok(claims.exp > 0);
  const meta = JSON.parse(claims.metadata) as { sessionId: string; consentId: string };
  assert.equal(meta.sessionId, chain.session.id);
  assert.equal(meta.consentId, chain.consentId);
});

test('H1a: withdrawal invalidates the chain', async () => {
  const { store, engine, ctx, ids, run } = await consentedChain();
  const chain = voiceChain(store, ctx, ids.candidateId, run.id);
  await engine.withdrawConsent(ctx, chain.consentId, 'Nadia Rowe');
  assert.throws(() => voiceChain(store, ctx, ids.candidateId, run.id),
    (e: unknown) => e instanceof VoiceError && e.code === 'consent_withdrawn');
});

test('H1a: another tenant cannot use the chain', async () => {
  const { store, ids, run } = await consentedChain();
  assert.throws(() => voiceChain(store, { tenantId: ids.tenant2Id }, ids.candidateId, run.id),
    (e: unknown) => e instanceof VoiceError);
});

/* ---------- H1b: webhook verification and consent-gated ingestion -------- */

test('H1b: unsigned and mis-signed webhooks are refused', async () => {
  const body = '{"probe":true}';
  assert.equal(await verifyVoiceWebhook(CFG, body, undefined), null);
  assert.equal(await verifyVoiceWebhook(CFG, body, 'not-a-jwt'), null);
  assert.equal(await verifyVoiceWebhook(CFG, body, sign('wrong-secret', body)), null);
  assert.equal(await verifyVoiceWebhook(CFG, body, sign(CFG.secret, body).slice(0, -1) + 'x'), null);
  /* The sha256 claim covers the raw bytes: a mutated body fails. */
  assert.equal(await verifyVoiceWebhook(CFG, `${body} `, sign(CFG.secret, body)), null);
  assert.ok(await verifyVoiceWebhook(CFG, body, sign(CFG.secret, body)));
});

test('H1b: ingest without an active consented session writes nothing', async () => {
  const { store, ids, ctx } = setup();
  const before = store.artifacts(ctx, ids.candidateId).length;
  assert.throws(() => ingestVoicePayload(store, JSON.parse(bullet(ids.candidateId))),
    (e: unknown) => e instanceof VoiceError && e.code === 'consent_required');
  assert.equal(store.artifacts(ctx, ids.candidateId).length, before);
});

test('H1b: ingest inside the consented session writes linked artifacts', async () => {
  const { store, ctx, ids, run } = await consentedChain();
  const chain = voiceChain(store, ctx, ids.candidateId, run.id);
  const result = ingestVoicePayload(store, JSON.parse(bullet(ids.candidateId, {
    sessionId: chain.session.id, consentId: chain.consentId,
  })));
  assert.equal(result.ingested, 1);
  const written = store.artifacts(ctx, ids.candidateId).filter(a => a.createdBy === 'livekit_agent');
  assert.equal(written.length, 1);
  const fields = written[0]!.fields as Record<string, unknown>;
  assert.equal(fields.sessionId, chain.session.id);
  assert.equal(fields.consentId, chain.consentId);
  assert.ok(store.auditList(ctx, 30).some(e => e.action === 'voice_artifacts_ingested'));
});

test('H1b: withdrawal blocks ingest mid-session', async () => {
  const { store, engine, ctx, ids, run } = await consentedChain();
  const chain = voiceChain(store, ctx, ids.candidateId, run.id);
  await engine.withdrawConsent(ctx, chain.consentId, 'Nadia Rowe');
  const before = store.artifacts(ctx, ids.candidateId).length;
  assert.throws(() => ingestVoicePayload(store, JSON.parse(bullet(ids.candidateId))),
    (e: unknown) => e instanceof VoiceError && e.code === 'consent_required');
  assert.equal(store.artifacts(ctx, ids.candidateId).length, before);
});

test('H1b: bullet counts and field lengths are capped', async () => {
  const { store, ids } = await consentedChain();
  const many = Array.from({ length: 80 }, () => ({ ownership: 'o'.repeat(900), action: 'a', outcome: 'b' }));
  const result = ingestVoicePayload(store, {
    room: { name: `interview-${ids.candidateId}` },
    data: { resume_bullet: many },
  });
  assert.equal(result.ingested, 50);
});

/* ---------- H1c: payload resolution ---------- */

test('H1c: resolution accepts string metadata, object metadata, room name, data field', () => {
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeffff0000';
  assert.equal(resolveVoiceIdentity({ participant: { metadata: JSON.stringify({ candidateId: id }) } })?.candidateId, id);
  assert.equal(resolveVoiceIdentity({ participant: { metadata: { candidateId: id } } })?.candidateId, id);
  assert.equal(resolveVoiceIdentity({ room: { name: `interview-${id}` } })?.candidateId, id);
  assert.equal(resolveVoiceIdentity({ data: { candidateId: id } })?.candidateId, id);
  assert.equal(resolveVoiceIdentity({ participant: { metadata: 'not json' } }), null);
  assert.equal(resolveVoiceIdentity({}), null);
});

test('H1c: the real string-metadata payload ingests end to end', async () => {
  const { store, ids } = await consentedChain();
  const result = ingestVoicePayload(store, JSON.parse(bullet(ids.candidateId)));
  assert.equal(result.ingested, 1);
});

test('H1c: room-name fallback ingests, identity-less payload is refused', async () => {
  const { store, ids } = await consentedChain();
  const result = ingestVoicePayload(store, {
    room: { name: `interview-${ids.candidateId}` },
    data: { resume_bullet: [{ ownership: 'x', action: 'y', outcome: 'z' }] },
  });
  assert.equal(result.ingested, 1);
  assert.throws(() => ingestVoicePayload(store, { data: { resume_bullet: [] } }),
    (e: unknown) => e instanceof VoiceError && e.code === 'missing_candidate_id');
});

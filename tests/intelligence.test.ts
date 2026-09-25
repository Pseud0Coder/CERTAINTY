/* The intelligence layer's contract with the rest of the spine.

   These tests never touch the network. They drive the provider interface
   with fakes, because the property that matters is not what a model says:
   it is that a wrong, slow, empty or dishonest answer cannot reach the
   spine, and that the scripted path takes over when it does. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/spine/db.ts';
import { seedDemo } from '../src/spine/seed.ts';
import { Engine } from '../src/spine/flows/engine.ts';
import { openRouterProvider, nullProvider, providerFromEnv } from '../src/spine/providers/llm.ts';
import type { LlmProvider, LlmRequest, LlmResult } from '../src/spine/providers/llm.ts';
import { normalizeModelText, runContract } from '../src/spine/contracts.ts';
import { numbersAreGrounded, modelResearchFindings, modelExecutiveSummary } from '../src/spine/intelligence.ts';
import { gatherResearchEvidence } from '../src/spine/agents.ts';
import { makeToolContext } from '../src/spine/flows/tools.ts';
import type { Ctx } from '../src/spine/db.ts';
import type { FlowRun } from '../src/spine/types.ts';

function setup() {
  const store = new Store(':memory:');
  const ids = seedDemo(store);
  const ctx: Ctx = { tenantId: ids.tenantId };
  return { store, ids, ctx };
}

/* A provider that returns exactly what a test tells it to. */
function fakeProvider(reply: unknown, opts: { name?: string } = {}): LlmProvider {
  return {
    name: opts.name ?? 'fake',
    async complete<T>(_req: LlmRequest): Promise<LlmResult<T> | null> {
      if (reply === null) return null;
      return {
        value: reply as T,
        model: 'fake',
        usage: { promptTokens: 1, completionTokens: 1, reasoningTokens: 0, costUsd: 0 },
        latencyMs: 1,
      };
    },
  };
}

function researchCtx(store: Store, ctx: Ctx, candidateId: string) {
  const run = {
    id: 'test-run', tenantId: ctx.tenantId, flowId: 'research', flowVersion: 1,
    candidateId, actorRole: 'candidate', status: 'running', currentStep: 'analyse',
    stepStates: {}, retries: {}, error: null, trace: [], toolCalls: {},
    createdAt: new Date().toISOString(),
  } as unknown as FlowRun;
  return makeToolContext({
    store, ctx, run, step: 'analyse', candidateId, actor: 'test', role: 'recruiter',
    seq: 0, usedKeys: new Set(), allowlist: ['read_spine', 'write_artifact'],
  });
}

/* ---------------------------------------------------------------------- */
/* the anti-invention guard                                                */

test('number grounding rejects a metric that is not in the evidence', () => {
  const evidence = 'reduced processing time by 30% across 2 teams';
  assert.ok(numbersAreGrounded('You reduced processing time by 30%.', evidence));
  assert.ok(!numbersAreGrounded('You reduced processing time by 45%.', evidence),
    'an invented percentage is rejected');
  assert.ok(!numbersAreGrounded('You saved 1200 hours.', evidence),
    'an invented absolute figure is rejected');
});

test('number grounding tolerates separators and allows years and single digits', () => {
  assert.ok(numbersAreGrounded('handled 1,200 records', 'handled 1200 records'),
    'comma separators do not create a false rejection');
  assert.ok(numbersAreGrounded('joined in 2021 and led 3 projects', 'no digits here at all'),
    'years and single digits are structural, not claims');
});

test('a model finding carrying an invented metric is discarded entirely', async () => {
  const { store, ids, ctx } = setup();
  const t = researchCtx(store, ctx, ids.candidateId);
  const ev = gatherResearchEvidence(t);

  const honest = await modelResearchFindings(fakeProvider({
    findings: [
      { kind: 'good', title: 'Ownership is evidenced', detail: 'Your bullets name what you personally owned.' },
      { kind: 'improve', title: 'Add scope', detail: 'The bullets describe the work without naming its scale.' },
      { kind: 'needs_work', title: 'Not evidenced', detail: 'This requirement has no supporting line on your CV.' },
    ],
  }), ev);
  assert.ok(honest, 'grounded findings are accepted');
  assert.equal(honest.length, 3);

  const dishonest = await modelResearchFindings(fakeProvider({
    findings: [
      { kind: 'good', title: 'Cut costs by 83%', detail: 'You reduced spend by 83% in that role.' },
      { kind: 'improve', title: 'Add scope', detail: 'The bullets describe the work without naming its scale.' },
      { kind: 'needs_work', title: 'Not evidenced', detail: 'This requirement has no supporting line on your CV.' },
    ],
  }), ev);
  assert.equal(dishonest, null, 'one invented metric rejects the whole set, not just that finding');
});

test('a short or malformed finding set falls back rather than degrading the report', async () => {
  const { store, ids, ctx } = setup();
  const ev = gatherResearchEvidence(researchCtx(store, ctx, ids.candidateId));

  assert.equal(await modelResearchFindings(fakeProvider({ findings: [] }), ev), null);
  assert.equal(await modelResearchFindings(fakeProvider({ findings: [
    { kind: 'good', title: 'ok', detail: 'too short' },
  ] }), ev), null, 'fewer than three usable findings is not a report');
  assert.equal(await modelResearchFindings(fakeProvider({ findings: [
    { kind: 'excellent', title: 'Bad band', detail: 'This band is not in the enum at all.' },
    { kind: 'good', title: 'Fine', detail: 'This one is properly formed and long enough.' },
    { kind: 'improve', title: 'Fine', detail: 'This one is properly formed and long enough.' },
  ] }), ev), null, 'an out-of-enum band is dropped, taking the set below the floor');
  assert.equal(await modelResearchFindings(nullProvider, ev), null,
    'the fail-closed provider produces nothing');
});

/* ---------------------------------------------------------------------- */
/* typographic repair                                                     */

test('model prose is repaired into contract-compliant output', () => {
  const raw = 'She led the migration — cutting latency 30% 🚀 — and it “stuck”…';
  const clean = normalizeModelText(raw);
  const check = runContract({ text: clean }, {
    clientFacing: true, currentCompensation: null, cvTenureStart: null, cvTenureEnd: null,
  });
  assert.ok(check.ok, `repaired text passes the contract: ${check.errors.join('; ')}`);
  assert.ok(!clean.includes('—') && !clean.includes('–'));
  assert.ok(/30%/.test(clean), 'repair preserves the metric');
});

test('an all-caps label is left as a real contract failure, not silently rewritten', () => {
  const clean = normalizeModelText('This candidate DELIVERED the project.');
  assert.ok(clean.includes('DELIVERED'), 'caps are not mangled by the repair pass');
  const check = runContract({ text: clean }, {
    clientFacing: true, currentCompensation: null, cvTenureStart: null, cvTenureEnd: null,
  });
  assert.ok(!check.ok, 'the contract still catches it, so the step retries and then falls back');
});

/* ---------------------------------------------------------------------- */
/* executive summary: the QA checklist must not be softened                */

test('the executive summary is used only when it is exactly five grounded bullets', async () => {
  const { store, ids, ctx } = setup();
  const t = researchCtx(store, ctx, ids.candidateId);
  const spine = t.call('read_spine', {}) as { artifacts: Array<{ kind: string; fields: Record<string, unknown> }> };
  const resume = spine.artifacts.find(a => a.kind === 'resume')!.fields as never;
  const input = { name: 'Nadia Rowe', targetRole: 'Senior Software Engineer', resume, confirmedMetric: null };

  const five = Array.from({ length: 5 }, (_, i) =>
    `Bullet ${i + 1} describing evidenced scope in a full sentence of prose.`);
  assert.ok(await modelExecutiveSummary(fakeProvider({ summary: five }), input));

  assert.equal(await modelExecutiveSummary(fakeProvider({ summary: five.slice(0, 4) }), input), null,
    'four bullets would break the five-bullet QA assertion, so it is refused');
  assert.equal(await modelExecutiveSummary(fakeProvider({
    summary: five.map(s => `${s} Revenue grew 91% that year.`),
  }), input), null, 'an invented metric in a client-facing document is refused');
});

/* ---------------------------------------------------------------------- */
/* the engine keeps working when the provider misbehaves                   */

/* Each case is a way a real provider fails. In every one the run must still
   complete and the report must still exist, because the scripted producer
   takes over (A0: intelligence degrades, the flow does not). */
const BAD_PROVIDERS: Array<[string, LlmProvider]> = [
  ['returns null', nullProvider],
  ['returns an empty object', fakeProvider({})],
  ['returns the wrong shape', fakeProvider({ findings: 'not an array' })],
  ['throws', {
    name: 'throwing',
    async complete(): Promise<never> { throw new Error('provider exploded'); },
  }],
];

for (const [label, provider] of BAD_PROVIDERS) {
  test(`research completes with the scripted producer when the provider ${label}`, async () => {
    const { store, ids, ctx } = setup();
    const engine = new Engine(store, provider);
    const run = await engine.startRun(ctx, {
      flowId: 'research', candidateId: ids.candidateId,
      actorRole: 'candidate', actor: 'Nadia Rowe',
    });
    assert.equal(run.status, 'complete', 'the run is not left broken');
    const report = store.artifacts(ctx, ids.candidateId).find(a => a.kind === 'research_report');
    assert.ok(report, 'a report exists either way');
    const findings = (report.fields as { findings: unknown[] }).findings;
    assert.ok(Array.isArray(findings) && findings.length > 0);
    assert.ok(run.trace.some(e => e.model.startsWith('scripted-')),
      'the trace records that the scripted producer served the step');
  });
}

test('a model-served step is named in the trace, so a fallback is visible in the audit', async () => {
  const { store, ids, ctx } = setup();
  const engine = new Engine(store, fakeProvider({
    findings: [
      { kind: 'good', title: 'Ownership is evidenced', detail: 'Your bullets name what you personally owned.' },
      { kind: 'improve', title: 'Add scope', detail: 'The bullets describe the work without naming its scale.' },
      { kind: 'needs_work', title: 'Not evidenced', detail: 'This requirement has no supporting line on your CV.' },
    ],
  }, { name: 'openrouter:test-model' }));
  const run = await engine.startRun(ctx, {
    flowId: 'research', candidateId: ids.candidateId,
    actorRole: 'candidate', actor: 'Nadia Rowe',
  });
  assert.equal(run.status, 'complete');
  assert.ok(run.trace.some(e => e.model.includes('openrouter:test-model')),
    `trace names the model: ${run.trace.map(e => e.model).join(', ')}`);
});

/* ---------------------------------------------------------------------- */
/* provider transport behaviour                                            */

function stubFetch(...responses: Array<{ status: number; body: unknown }>): {
  impl: typeof fetch; calls: () => number;
} {
  let i = 0;
  return {
    calls: () => i,
    impl: (async () => {
      const r = responses[Math.min(i, responses.length - 1)]!;
      i++;
      return new Response(JSON.stringify(r.body), {
        status: r.status, headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch,
  };
}

const okBody = (content: string) => ({
  choices: [{ finish_reason: 'stop', message: { content } }],
  usage: { prompt_tokens: 10, completion_tokens: 20, cost: 0.0001 },
});

const REQ = {
  system: 'system', user: 'user', schemaName: 'test',
  schema: { type: 'object' }, tier: 'cheap' as const,
};

test('the provider parses a structured body and reports usage', async () => {
  const f = stubFetch({ status: 200, body: okBody('{"ok":true}') });
  const p = openRouterProvider({ apiKey: 'k', fetchImpl: f.impl });
  const res = await p.complete<{ ok: boolean }>(REQ);
  assert.deepEqual(res?.value, { ok: true });
  assert.equal(res?.usage.costUsd, 0.0001);
  assert.equal(res?.usage.promptTokens, 10);
});

test('a truncated response is discarded rather than parsed as partial JSON', async () => {
  const f = stubFetch({
    status: 200,
    body: { choices: [{ finish_reason: 'length', message: { content: '{"findings":[{"kind":"go' } }] },
  });
  const p = openRouterProvider({ apiKey: 'k', fetchImpl: f.impl });
  assert.equal(await p.complete(REQ), null);
});

test('a reasoning-only response with null content yields nothing', async () => {
  /* The real failure mode of this model: the whole budget goes to
     reasoning and content comes back null. */
  const f = stubFetch({
    status: 200,
    body: { choices: [{ finish_reason: 'stop', message: { content: null } }] },
  });
  const p = openRouterProvider({ apiKey: 'k', fetchImpl: f.impl });
  assert.equal(await p.complete(REQ), null);
});

test('unparseable content yields nothing', async () => {
  const f = stubFetch({ status: 200, body: okBody('this is not json') });
  const p = openRouterProvider({ apiKey: 'k', fetchImpl: f.impl });
  assert.equal(await p.complete(REQ), null);
});

test('a rate limit is retried once, a client error is not', async () => {
  const throttled = stubFetch(
    { status: 429, body: { error: { message: 'slow down', code: 429 } } },
    { status: 200, body: okBody('{"ok":true}') },
  );
  const p1 = openRouterProvider({ apiKey: 'k', fetchImpl: throttled.impl });
  assert.deepEqual((await p1.complete<{ ok: boolean }>(REQ))?.value, { ok: true });
  assert.equal(throttled.calls(), 2, 'retried the throttle exactly once');

  const rejected = stubFetch({ status: 401, body: { error: { message: 'bad key', code: 401 } } });
  const p2 = openRouterProvider({ apiKey: 'k', fetchImpl: rejected.impl });
  assert.equal(await p2.complete(REQ), null);
  assert.equal(rejected.calls(), 1, 'a bad key is not retried');
});

test('a transport failure never escapes the provider', async () => {
  const p = openRouterProvider({
    apiKey: 'k',
    fetchImpl: (async () => { throw new Error('socket hang up'); }) as unknown as typeof fetch,
  });
  assert.equal(await p.complete(REQ), null, 'resolves null instead of throwing');
});

test('diagnostics describe the failure without carrying prompt text', async () => {
  const seen: string[] = [];
  const f = stubFetch({ status: 500, body: { error: { message: 'upstream on fire', code: 500 } } });
  const p = openRouterProvider({
    apiKey: 'k', fetchImpl: f.impl,
    onDiagnostic: (event, detail) => seen.push(`${event} ${detail}`),
  });
  await p.complete({ ...REQ, system: 'CUSTODY PROMPT BODY', user: 'CANDIDATE EVIDENCE' });
  assert.ok(seen.length > 0, 'something was reported');
  const joined = seen.join(' | ');
  assert.ok(!joined.includes('CUSTODY PROMPT BODY'), 'L3: no prompt body in diagnostics');
  assert.ok(!joined.includes('CANDIDATE EVIDENCE'), 'no candidate evidence in diagnostics');
});

/* ---------------------------------------------------------------------- */
/* environment selection                                                   */

test('provider selection fails closed and can be forced off', () => {
  assert.equal(providerFromEnv({}).name, 'scripted', 'no key means no model');
  assert.equal(providerFromEnv({ OPENROUTER_API_KEY: '   ' }).name, 'scripted',
    'a blank key is not a key');
  assert.equal(providerFromEnv({ OPENROUTER_API_KEY: 'k', CERTAINTY_LLM: 'off' }).name, 'scripted',
    'the kill switch wins over a present key');
  assert.match(providerFromEnv({ OPENROUTER_API_KEY: 'k' }).name, /^openrouter:z-ai\/glm-5\.3-flash$/);
  assert.match(providerFromEnv({ OPENROUTER_API_KEY: 'k', CERTAINTY_MODEL: 'other/model' }).name,
    /^openrouter:other\/model$/);
});

/* ADR-0024 model-assisted parsing: the deterministic parser is the floor,
   the model is consulted only when it found nothing, and only valid model
   output is used. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { structureResumeAssisted } from '../src/spine/model-parse.ts';
import type { LlmProvider, LlmRequest, LlmResult } from '../src/spine/providers/llm.ts';

function fakeProvider(value: unknown, onCall?: () => void): LlmProvider {
  return {
    name: 'fake',
    async complete<T>(_req: LlmRequest): Promise<LlmResult<T> | null> {
      onCall?.();
      return { value: value as T, model: 'fake', usage: { promptTokens: 1, completionTokens: 1, reasoningTokens: 0, costUsd: 0 }, latencyMs: 1 };
    },
  };
}

const goodFields = {
  positioning: 'Senior Engineer', location: 'Dubai', phone: '', email: '',
  roles: [{ company: 'Acme', title: 'Engineer', start: '01/2020', end: 'Present', bullets: ['Did work'] }],
  skills: [], tools: [], education: [],
};

/* Facts present, but in prose the deterministic parser cannot structure. */
const MESSY = 'A CV with no parseable role headers\nI have worked as an Engineer at Acme since 01/2020 and did work there.';

test('the deterministic parser is used and the model is not called when roles were found', async () => {
  let calls = 0;
  const text = 'Experience\n- Engineer | Acme | 01/2020 - Present\n- Built a thing';
  const result = await structureResumeAssisted(fakeProvider(goodFields, () => { calls += 1; }), text);
  assert.equal(result.by, 'scripted');
  assert.equal(calls, 0, 'no model call when the parser succeeded');
});

test('the model is consulted when the parser found no roles, and used when valid', async () => {
  let calls = 0;
  const result = await structureResumeAssisted(fakeProvider(goodFields, () => { calls += 1; }), MESSY);
  assert.equal(calls, 1);
  assert.equal(result.by, 'model');
  assert.equal(result.fields.roles.length, 1);
  assert.equal(result.fields.roles[0]!.company, 'Acme');
});

test('malformed model output is discarded and the scripted result stands', async () => {
  const bad = { ...goodFields, roles: [{ company: 'Acme' }] };
  const result = await structureResumeAssisted(fakeProvider(bad), MESSY);
  assert.equal(result.by, 'scripted');
  assert.equal(result.fields.roles.length, 0);
});

test('no provider or the scripted provider never reaches the network', async () => {
  assert.equal((await structureResumeAssisted(null, MESSY)).by, 'scripted');
  const scripted: LlmProvider = { name: 'scripted', async complete() { return null; } };
  assert.equal((await structureResumeAssisted(scripted, MESSY)).by, 'scripted');
});

test('a model parse that invents a role or a figure is rejected for the scripted result', async () => {
  const invented = { ...goodFields, roles: [{ company: 'Globex', title: 'Director', start: '03/2015', end: 'Present', bullets: ['Ran 40 teams'] }] };
  const result = await structureResumeAssisted(fakeProvider(invented), MESSY);
  assert.equal(result.by, 'scripted', 'Globex and Director appear nowhere in the CV');
  const inventedFigure = { ...goodFields, roles: [{ ...goodFields.roles[0]!, bullets: ['Cut costs by 37%'] }] };
  assert.equal((await structureResumeAssisted(fakeProvider(inventedFigure), MESSY)).by, 'scripted', '37 is not in the CV');
});

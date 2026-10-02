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

const MESSY = 'A CV with no parseable role headers\njust prose about a career';

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

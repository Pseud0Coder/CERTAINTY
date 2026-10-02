/* ADR-0024 SSO against a fake: fails closed, never creates an account, and
   respects tenant membership. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/spine/db.ts';
import { seedDemo } from '../src/spine/seed.ts';
import { entraFromEnv, resolveSsoUser, type SsoProvider } from '../src/spine/sso.ts';

const toggle = (url: string | undefined, fn: () => void): void => {
  const prev = process.env.CERTAINTY_ENTRA_VERIFY_URL;
  if (url === undefined) delete process.env.CERTAINTY_ENTRA_VERIFY_URL; else process.env.CERTAINTY_ENTRA_VERIFY_URL = url;
  try { fn(); } finally { if (prev === undefined) delete process.env.CERTAINTY_ENTRA_VERIFY_URL; else process.env.CERTAINTY_ENTRA_VERIFY_URL = prev; }
};

test('with no verify URL configured there is no provider', () => {
  toggle(undefined, () => assert.equal(entraFromEnv(process.env), null));
});

test('the provider verifies a token through the configured endpoint', async () => {
  const provider = entraFromEnv({ CERTAINTY_ENTRA_VERIFY_URL: 'https://entra.test/verify' }, async () =>
    new Response(JSON.stringify({ email: 'recruiter@gennext.demo', name: 'R. Osei' }), { status: 200 }));
  assert.ok(provider);
  assert.deepEqual(await provider!.verify('token'), { email: 'recruiter@gennext.demo', name: 'R. Osei' });
});

test('a rejected or malformed verification returns null', async () => {
  const rejected = entraFromEnv({ CERTAINTY_ENTRA_VERIFY_URL: 'https://entra.test/verify' }, async () => new Response('{}', { status: 401 }));
  assert.equal(await rejected!.verify('token'), null);
  const malformed = entraFromEnv({ CERTAINTY_ENTRA_VERIFY_URL: 'https://entra.test/verify' }, async () => new Response(JSON.stringify({ name: 'x' }), { status: 200 }));
  assert.equal(await malformed!.verify('token'), null);
});

test('SSO signs in only an existing user, and only in their tenant', async () => {
  const store = new Store(':memory:');
  const ids = seedDemo(store);
  const provider: SsoProvider = { name: 'fake', async verify(t) { return t === 'good' ? { email: 'recruiter@gennext.demo', name: 'R. Osei' } : null; } };
  assert.equal((await resolveSsoUser(store, provider, 'good'))!.email, 'recruiter@gennext.demo');
  assert.equal(await resolveSsoUser(store, provider, 'bad'), null);
  assert.equal(await resolveSsoUser(store, provider, 'good', ids.tenant2Id), null, 'tenant mismatch is refused');
  assert.equal(await resolveSsoUser(store, null, 'good'), null, 'no provider, no session');
});

test('SSO never creates an account for an unknown email', async () => {
  const store = new Store(':memory:');
  const ids = seedDemo(store);
  const before = store.listUsers({ tenantId: ids.tenantId }).length;
  const provider: SsoProvider = { name: 'fake', async verify() { return { email: 'stranger@example.test', name: 'Stranger' }; } };
  assert.equal(await resolveSsoUser(store, provider, 'x'), null);
  assert.equal(store.listUsers({ tenantId: ids.tenantId }).length, before);
});

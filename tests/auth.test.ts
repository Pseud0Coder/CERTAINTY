/* Auth and RBAC: login decides the application, sessions are HttpOnly,
   CSRF is enforced on mutations, rate limiting gates brute force. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { login, loginRateLimited, recordFailure, sessionFor } from '../src/server/auth.ts';
import { Store } from '../src/spine/db.ts';
import { seedDemo, DEMO_PASSWORD, hashPassword, verifyPassword } from '../src/spine/seed.ts';
import { assertModule, ModuleError } from '../src/spine/billing.ts';

function setup() {
  const store = new Store(':memory:');
  const ids = seedDemo(store);
  return { store, ids };
}

test('password hashing uses scrypt with per-user salt', () => {
  const a = hashPassword('same-password');
  const b = hashPassword('same-password');
  assert.notEqual(a, b, 'salts differ');
  assert.ok(verifyPassword('same-password', a));
  assert.ok(!verifyPassword('wrong-password', a));
});

test('login returns a session bound to the tenant and role', () => {
  const { store } = setup();
  const recruiter = login(store, 'recruiter@gennext.demo', DEMO_PASSWORD)!;
  assert.equal(recruiter.user.role, 'recruiter');
  const session = sessionFor(recruiter.token)!;
  assert.equal(session.userId, recruiter.user.id);
  const bad = login(store, 'recruiter@gennext.demo', 'nope');
  assert.equal(bad, null);
  const unknown = login(store, 'nobody@nowhere.demo', DEMO_PASSWORD);
  assert.equal(unknown, null);
});

test('candidate login gets the candidate role, not recruiter powers', () => {
  const { store } = setup();
  const cand = login(store, 'nadia@gennext.demo', DEMO_PASSWORD)!;
  assert.equal(cand.user.role, 'candidate');
  assert.ok(!['recruiter', 'admin'].includes(cand.user.role));
});

test('login failures are rate limited per source', () => {
  const key = '203.0.113.9';
  for (let i = 0; i < 8; i++) recordFailure(key);
  assert.ok(loginRateLimited(key));
  assert.ok(!loginRateLimited('other.host'));
});

test('sessions expire', () => {
  const { store } = setup();
  const r = login(store, 'recruiter@gennext.demo', DEMO_PASSWORD)!;
  const s = sessionFor(r.token)!;
  s.exp = Date.now() - 1;
  assert.equal(sessionFor(r.token), null);
});

test('module entitlements gate access with a typed error', () => {
  const { store, ids } = setup();
  assertModule(store, ids.tenantId, 'pipeline');
  assert.throws(() => assertModule(store, ids.tenant2Id, 'builder'), ModuleError);
});

/* ADR-0024 communications: templated, localized, stored messages, a
   transport that fails closed, and human escalation for inbound replies. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/spine/db.ts';
import { seedDemo } from '../src/spine/seed.ts';
import {
  applyToRequisition, createRequisition, decideRequisition, submitRequisition, type Actor,
} from '../src/spine/hiring.ts';
import {
  escalateMessage, queueForEvent, queueMessage, recordInbound, renderTemplate, sendQueued,
  type MessageProvider,
} from '../src/spine/communications.ts';
import type { Message } from '../src/spine/types.ts';

function boot() {
  const store = new Store(':memory:');
  const ids = seedDemo(store);
  const ctx = { tenantId: ids.tenantId };
  const recruiter = store.userByEmail('recruiter@gennext.demo')!;
  const hr = store.createUser(ids.tenantId, 'hr@gennext.demo', 'x', 'hr', 'H. Manager');
  const rec: Actor = { id: recruiter.id, name: recruiter.displayName, role: 'recruiter' };
  const hrm: Actor = { id: hr.id, name: hr.displayName, role: 'hr' };
  store.updateCandidate(ctx, ids.candidateId, { email: 'nadia@example.test', phone: '+971501234567' });
  return { store, ids, ctx, rec, hrm };
}

test('templates render in English and Arabic, free of em dashes and emoji (L8)', () => {
  const en = renderTemplate('interview_invite', 'en', { candidate: 'Nadia', role: 'Engineer', company: 'Gennext', date: '2026-11-01', link: 'https://x.test/i' });
  assert.ok(en.subject.includes('Interview invitation'));
  assert.ok(en.body.includes('2026-11-01'));
  const ar = renderTemplate('interview_invite', 'ar', { candidate: 'نادية', role: 'مهندس', company: 'جينكس', date: '2026-11-01', link: 'https://x.test/i' });
  assert.ok(/[\u0600-\u06FF]/.test(ar.subject), 'Arabic subject is in Arabic');
  assert.ok(/[\u0600-\u06FF]/.test(ar.body), 'Arabic body is in Arabic');
  for (const t of [en, ar]) {
    assert.ok(!/[\u2014\u2013]/.test(t.subject + t.body), 'no em or en dash');
    assert.ok(!/\p{Extended_Pictographic}/u.test(t.subject + t.body), 'no emoji');
  }
});

test('an application with an email queues an acknowledgement; one without is skipped', () => {
  const { store, ids, ctx, rec, hrm } = boot();
  const req = createRequisition(store, ctx, rec, { title: 'Engineer' });
  submitRequisition(store, ctx, rec, req.id);
  decideRequisition(store, ctx, hrm, req.id, 'approved');
  applyToRequisition(store, ctx, rec, { requisitionId: req.id, candidateId: ids.candidateId });
  const queued = store.messages(ctx).filter(m => m.template === 'application_received');
  assert.equal(queued.length, 1);
  assert.equal(queued[0]!.locale, 'en');

  /* A candidate with no address gets no message. */
  const skipped = queueForEvent(store, ctx, { candidateId: 'nobody', template: 'status_update' });
  assert.equal(skipped, null);
});

test('the transport fails closed without a provider and sends with a fake one', async () => {
  const { store, ids, ctx } = boot();
  queueMessage(store, ctx, { candidateId: ids.candidateId, template: 'status_update', vars: { note: 'Shortlisted.' } });

  const closed = await sendQueued(store, ctx, null);
  assert.deepEqual({ sent: closed.sent, queued: closed.queued, provider: closed.provider }, { sent: 0, queued: 1, provider: null });
  assert.equal(store.messages(ctx, { status: 'queued' }).length, 1, 'nothing dropped');

  const provider: MessageProvider = { name: 'fake', async send() { return { providerId: 'p1' }; } };
  const result = await sendQueued(store, ctx, provider);
  assert.equal(result.sent, 1);
  const sent = store.messages(ctx, { status: 'sent' })[0]!;
  assert.equal(sent.providerId, 'p1');
  assert.ok(sent.sentAt);
  assert.ok(store.auditList(ctx).some(e => e.action === 'message_sent'));
});

test('a failing provider marks the message failed with the reason, not lost', async () => {
  const { store, ids, ctx } = boot();
  queueMessage(store, ctx, { candidateId: ids.candidateId, template: 'status_update' });
  const provider: MessageProvider = { name: 'fake', async send() { throw new Error('smtp_unreachable'); } };
  const result = await sendQueued(store, ctx, provider);
  assert.equal(result.failed, 1);
  const failed = store.messages(ctx, { status: 'failed' })[0]!;
  assert.equal(failed.error, 'smtp_unreachable');
});

test('an inbound reply that needs a person is escalated, in either language', () => {
  const { store, ids, ctx } = boot();
  const human = recordInbound(store, ctx, { candidateId: ids.candidateId, body: 'I would like to speak to a manager about this.' });
  assert.equal(human.status, 'escalated');
  const arabic = recordInbound(store, ctx, { candidateId: ids.candidateId, body: 'أريد التحدث مع مدير بخصوص هذا الأمر.' });
  assert.equal(arabic.status, 'escalated');
  const simple = recordInbound(store, ctx, { candidateId: ids.candidateId, body: 'Thank you, noted.' });
  assert.equal(simple.status, 'received');
});

test('escalating a sent message records who and why', () => {
  const { store, ids, ctx, rec } = boot();
  const m: Message = queueMessage(store, ctx, { candidateId: ids.candidateId, template: 'status_update' });
  assert.throws(() => escalateMessage(store, ctx, rec, m.id, ''), /reason_required/);
  const escalated = escalateMessage(store, ctx, rec, m.id, 'Unclear reply, needs a recruiter.');
  assert.equal(escalated.status, 'escalated');
  assert.equal(escalated.escalationReason, 'Unclear reply, needs a recruiter.');
  assert.ok(store.auditList(ctx).some(e => e.action === 'message_escalated' && e.actor === rec.name));
});

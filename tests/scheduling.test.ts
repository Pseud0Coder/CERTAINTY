/* ADR-0024 scheduling: deterministic slots, a stored meeting with history,
   an ICS that any calendar opens, and a calendar provider that fails closed. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/spine/db.ts';
import { seedDemo } from '../src/spine/seed.ts';
import {
  cancelMeeting, completeMeeting, confirmMeeting, createMeeting, icsForMeeting,
  proposeSlots, pushToCalendar, rescheduleMeeting, type CalendarProvider,
} from '../src/spine/scheduling.ts';

function boot() {
  const store = new Store(':memory:');
  const ids = seedDemo(store);
  const ctx = { tenantId: ids.tenantId };
  const rec = { id: 'u1', name: 'R. Osei', role: 'recruiter' };
  store.updateCandidate(ctx, ids.candidateId, { email: 'nadia@example.test' });
  const meeting = createMeeting(store, ctx, rec, {
    candidateId: ids.candidateId, kind: 'interview', startsAt: '2026-11-02T09:00:00Z', endsAt: '2026-11-02T09:45:00Z', location: 'Dubai office',
  });
  return { store, ids, ctx, rec, meeting };
}

test('slots are deterministic and respect duration and existing bookings', () => {
  const windows = [{ date: '2026-11-02', start: '09:00', end: '10:30' }];
  const first = proposeSlots(windows, 45);
  assert.deepEqual(first, proposeSlots(windows, 45), 'same input, same slots');
  assert.equal(first[0], '2026-11-02T09:00:00.000Z');
  assert.equal(first[1], '2026-11-02T09:30:00.000Z');
  assert.ok(first.every(s => Date.parse(s) + 45 * 60_000 <= Date.parse('2026-11-02T10:30:00Z')));
  const skipped = proposeSlots(windows, 45, { existing: ['2026-11-02T09:00:00.000Z'] });
  assert.ok(!skipped.includes('2026-11-02T09:00:00.000Z'));
  assert.equal(proposeSlots(windows, 45, { limit: 1 }).length, 1);
});

test('a meeting carries its own change history', () => {
  const { store, ctx, rec, meeting } = boot();
  assert.equal(meeting.status, 'proposed');
  assert.equal(meeting.history.at(-1)!.action, 'created');
  confirmMeeting(store, ctx, rec, meeting.id);
  rescheduleMeeting(store, ctx, rec, meeting.id, '2026-11-03T09:00:00Z', '2026-11-03T09:45:00Z', 'Candidate clash');
  const after = store.meeting(ctx, meeting.id)!;
  assert.equal(after.status, 'rescheduled');
  assert.deepEqual(after.history.map(h => h.action), ['created', 'confirmed', 'rescheduled']);
  cancelMeeting(store, ctx, rec, meeting.id);
  assert.equal(store.meeting(ctx, meeting.id)!.status, 'cancelled');
});

test('confirming a meeting reminds the candidate through the outbox', () => {
  const { store, ids, ctx, rec, meeting } = boot();
  confirmMeeting(store, ctx, rec, meeting.id);
  const reminders = store.messages(ctx, { candidateId: ids.candidateId }).filter(m => m.template === 'interview_invite');
  assert.equal(reminders.length, 1);
  assert.ok(reminders[0]!.body.includes('2026-11-02'));
});

test('invalid times are refused', () => {
  const { store, ids, ctx, rec } = boot();
  assert.throws(() => createMeeting(store, ctx, rec, { candidateId: ids.candidateId, startsAt: 'nope', endsAt: '2026-11-02T10:00:00Z' }), /invalid_time/);
  assert.throws(() => createMeeting(store, ctx, rec, { candidateId: ids.candidateId, startsAt: '2026-11-02T10:00:00Z', endsAt: '2026-11-02T09:00:00Z' }), /invalid_time/);
});

test('the ICS is a valid VEVENT with UTC stamps and escaped text', () => {
  const { meeting } = boot();
  const ics = icsForMeeting({ meeting, title: 'Interview, stage two; panel', description: 'Line one\nLine two' });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR'));
  assert.ok(ics.includes('BEGIN:VEVENT'));
  assert.ok(ics.includes(`UID:${meeting.id}@certainty`));
  assert.ok(ics.includes('DTSTART:20261102T090000Z'));
  assert.ok(ics.includes('DTEND:20261102T094500Z'));
  assert.ok(ics.includes('SUMMARY:Interview\\, stage two\\; panel'), 'commas and semicolons escaped');
  assert.ok(ics.includes('DESCRIPTION:Line one\\nLine two'), 'newlines escaped');
  assert.ok(ics.trimEnd().endsWith('END:VCALENDAR'));
});

test('the calendar provider fails closed and pushes when configured', async () => {
  const { store, ctx, meeting } = boot();
  const closed = await pushToCalendar(store, ctx, null, meeting.id, { title: 'Interview', description: '' });
  assert.deepEqual(closed, { pushed: false, eventId: null });
  assert.equal(store.meeting(ctx, meeting.id)!.calendarEventId, null);

  const provider: CalendarProvider = { name: 'fake', async createEvent() { return { eventId: 'evt-123' }; } };
  const pushed = await pushToCalendar(store, ctx, provider, meeting.id, { title: 'Interview', description: '' });
  assert.deepEqual(pushed, { pushed: true, eventId: 'evt-123' });
  assert.equal(store.meeting(ctx, meeting.id)!.calendarEventId, 'evt-123');
});

test('completing a meeting is terminal and recorded', () => {
  const { store, ctx, rec, meeting } = boot();
  completeMeeting(store, ctx, rec, meeting.id);
  assert.equal(store.meeting(ctx, meeting.id)!.status, 'completed');
  assert.ok(store.auditList(ctx).some(e => e.action === 'meeting_completed'));
});

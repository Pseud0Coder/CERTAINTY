/* Scheduling (ADR-0024): deterministic slot proposals, a stored meeting
   with its own change history, a calendar file (ICS) any client can open,
   and reminders through the communications outbox.

   A calendar provider (Microsoft 365 in production) sits behind an
   interface and fails closed: with no provider, the meeting still exists
   and the ICS is still generated. Times are stored as UTC instants; the
   timezone is carried separately for display. */

import { randomUUID } from 'node:crypto';
import type { Store, Ctx } from './db.ts';
import type { Meeting, MeetingKind, MeetingStatus } from './types.ts';
import { queueForEvent } from './communications.ts';

export class SchedulingError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}

const STEP_MIN = 30;

export interface AvailabilityWindow { date: string; start: string; end: string }

/* Slots on a fixed step inside each window, skipping anything already
   booked. Deterministic: the same windows always yield the same slots. */
export function proposeSlots(
  windows: AvailabilityWindow[], durationMinutes: number,
  opts: { existing?: string[]; limit?: number } = {},
): string[] {
  const existing = new Set(opts.existing ?? []);
  const limit = opts.limit ?? 12;
  const slots: string[] = [];
  for (const w of windows) {
    const start = Date.parse(`${w.date}T${w.start}:00Z`);
    const end = Date.parse(`${w.date}T${w.end}:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    for (let t = start; t + durationMinutes * 60_000 <= end; t += STEP_MIN * 60_000) {
      const iso = new Date(t).toISOString();
      if (!existing.has(iso)) slots.push(iso);
      if (slots.length >= limit) return slots;
    }
  }
  return slots;
}

export interface MeetingInput {
  candidateId: string;
  applicationId?: string | null;
  requisitionId?: string | null;
  kind?: MeetingKind;
  startsAt: string;
  endsAt: string;
  timezone?: string;
  location?: string;
}

function requireMeeting(store: Store, ctx: Ctx, id: string): Meeting {
  const m = store.meeting(ctx, id);
  if (!m) throw new SchedulingError('not_found');
  return m;
}

function assertTimes(startsAt: string, endsAt: string): void {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new SchedulingError('invalid_time');
  if (end <= start) throw new SchedulingError('invalid_time');
}

export function createMeeting(store: Store, ctx: Ctx, actor: { id: string; name: string; role: string }, input: MeetingInput): Meeting {
  if (!store.candidate(ctx, input.candidateId)) throw new SchedulingError('candidate_not_found');
  assertTimes(input.startsAt, input.endsAt);
  const now = new Date().toISOString();
  const meeting: Meeting = {
    id: randomUUID(), tenantId: ctx.tenantId, applicationId: input.applicationId ?? null,
    candidateId: input.candidateId, requisitionId: input.requisitionId ?? null,
    kind: input.kind ?? 'interview', startsAt: input.startsAt, endsAt: input.endsAt,
    timezone: input.timezone ?? store.tenantSettings(ctx).timezone ?? 'UTC',
    location: input.location ?? '', status: 'proposed', calendarEventId: null,
    history: [{ action: 'created', at: now, by: actor.id, note: '' }],
    createdBy: actor.id, createdAt: now, updatedAt: now,
  };
  store.insertMeeting(meeting);
  store.audit(ctx.tenantId, actor.name, actor.role, 'meeting_created', meeting.id);
  return meeting;
}

export function confirmMeeting(store: Store, ctx: Ctx, actor: { id: string; name: string; role: string }, id: string): Meeting {
  const m = requireMeeting(store, ctx, id);
  if (['cancelled', 'completed'].includes(m.status)) throw new SchedulingError('not_confirmable');
  m.status = 'confirmed';
  m.history.push({ action: 'confirmed', at: new Date().toISOString(), by: actor.id, note: '' });
  store.updateMeeting(ctx, m);
  store.audit(ctx.tenantId, actor.name, actor.role, 'meeting_confirmed', m.id);
  queueForEvent(store, ctx, {
    candidateId: m.candidateId, applicationId: m.applicationId, template: 'interview_invite',
    vars: { date: m.startsAt, link: `/meetings/${m.id}` },
  });
  return store.meeting(ctx, id)!;
}

export function rescheduleMeeting(
  store: Store, ctx: Ctx, actor: { id: string; name: string; role: string },
  id: string, startsAt: string, endsAt: string, note = '',
): Meeting {
  const m = requireMeeting(store, ctx, id);
  if (['cancelled', 'completed'].includes(m.status)) throw new SchedulingError('not_reschedulable');
  assertTimes(startsAt, endsAt);
  m.startsAt = startsAt; m.endsAt = endsAt; m.status = 'rescheduled';
  m.history.push({ action: 'rescheduled', at: new Date().toISOString(), by: actor.id, note });
  store.updateMeeting(ctx, m);
  store.audit(ctx.tenantId, actor.name, actor.role, 'meeting_rescheduled', m.id);
  queueForEvent(store, ctx, {
    candidateId: m.candidateId, applicationId: m.applicationId, template: 'interview_invite',
    vars: { date: startsAt, link: `/meetings/${m.id}`, note },
  });
  return store.meeting(ctx, id)!;
}

export function cancelMeeting(store: Store, ctx: Ctx, actor: { id: string; name: string; role: string }, id: string, note = ''): Meeting {
  const m = requireMeeting(store, ctx, id);
  if (m.status === 'cancelled') throw new SchedulingError('already_cancelled');
  m.status = 'cancelled';
  m.history.push({ action: 'cancelled', at: new Date().toISOString(), by: actor.id, note });
  store.updateMeeting(ctx, m);
  store.audit(ctx.tenantId, actor.name, actor.role, 'meeting_cancelled', m.id);
  return store.meeting(ctx, id)!;
}

export function completeMeeting(store: Store, ctx: Ctx, actor: { id: string; name: string; role: string }, id: string): Meeting {
  const m = requireMeeting(store, ctx, id);
  m.status = 'completed';
  m.history.push({ action: 'completed', at: new Date().toISOString(), by: actor.id, note: '' });
  store.updateMeeting(ctx, m);
  store.audit(ctx.tenantId, actor.name, actor.role, 'meeting_completed', m.id);
  return store.meeting(ctx, id)!;
}

function icsStamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

/* A standards-compliant VEVENT any client (Outlook, Google, Apple) opens,
   with no dependency on a calendar provider being configured. */
export function icsForMeeting(input: {
  meeting: Meeting; title: string; description?: string; organizerName?: string;
}): string {
  const { meeting } = input;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Certainty//Scheduling//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${meeting.id}@certainty`,
    `DTSTAMP:${icsStamp(new Date().toISOString())}`,
    `DTSTART:${icsStamp(meeting.startsAt)}`,
    `DTEND:${icsStamp(meeting.endsAt)}`,
    `SUMMARY:${icsText(input.title)}`,
    `DESCRIPTION:${icsText(input.description ?? '')}`,
    `LOCATION:${icsText(meeting.location)}`,
    ...(input.organizerName ? [`ORGANIZER;CN=${icsText(input.organizerName)}:mailto:no-reply@certainty`] : []),
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

/* Microsoft 365 (or any calendar) sits behind this interface. Fails closed:
   no provider, no event id, but the meeting and the ICS remain. */
export interface CalendarProvider {
  readonly name: string;
  createEvent(meeting: Meeting, details: { title: string; description: string }): Promise<{ eventId: string }>;
}

export async function pushToCalendar(
  store: Store, ctx: Ctx, provider: CalendarProvider | null, meetingId: string,
  details: { title: string; description: string },
): Promise<{ pushed: boolean; eventId: string | null }> {
  const meeting = requireMeeting(store, ctx, meetingId);
  if (!provider) return { pushed: false, eventId: null };
  const { eventId } = await provider.createEvent(meeting, details);
  meeting.calendarEventId = eventId;
  store.updateMeeting(ctx, meeting);
  store.audit(ctx.tenantId, provider.name, 'system', 'meeting_calendar_pushed', meeting.id);
  return { pushed: true, eventId };
}

export function meetingStatuses(): MeetingStatus[] {
  return ['proposed', 'confirmed', 'rescheduled', 'cancelled', 'completed'];
}

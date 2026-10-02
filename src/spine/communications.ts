/* Candidate communications (ADR-0024): every automated email, SMS or
   WhatsApp message is a stored record, never a side effect of a flow. The
   template catalog has an English and an Arabic variant; the locale decides
   which is rendered. An inbound reply that needs a person flips to
   `escalated` rather than being answered by an agent.

   The transport sits behind an interface and fails closed: with no provider
   configured, messages stay `queued`, and the outbox shows why. Renders are
   deterministic and obey the string rules (L8): no em dashes, no emoji. */

import { randomUUID } from 'node:crypto';
import type { Store, Ctx } from './db.ts';
import type { Message, MessageChannel, MessageLocale, MessageStatus } from './types.ts';

export class CommunicationError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}

export type TemplateId =
  | 'application_received' | 'screening_invite' | 'interview_invite'
  | 'assessment_invite' | 'offer_sent' | 'rejection'
  | 'document_request' | 'status_update';

export interface TemplateVars {
  candidate: string;
  role: string;
  company?: string;
  date?: string;
  link?: string;
  note?: string;
}

interface Template { subject: string; body: string }

const TEMPLATES: Record<TemplateId, Record<MessageLocale, Template>> = {
  application_received: {
    en: { subject: 'We received your application for {role}', body: 'Dear {candidate},\n\nThank you for applying for the {role} role. We have received your application and will review it shortly.\n\nRegards,\n{company}' },
    ar: { subject: 'استلمنا طلبك لوظيفة {role}', body: 'عزيزي {candidate}،\n\nشكرا لتقديمك على وظيفة {role}. لقد استلمنا طلبك وسنراجعه قريبا.\n\nمع التحية،\n{company}' },
  },
  screening_invite: {
    en: { subject: 'Next step: screening for {role}', body: 'Dear {candidate},\n\nWe would like to invite you to a short screening for the {role} role. Please choose a time using this link: {link}\n\nRegards,\n{company}' },
    ar: { subject: 'الخطوة التالية: المقابلة الأولية لوظيفة {role}', body: 'عزيزي {candidate}،\n\nيسعدنا دعوتك إلى مقابلة أولية قصيرة لوظيفة {role}. الرجاء اختيار الوقت عبر هذا الرابط: {link}\n\nمع التحية،\n{company}' },
  },
  interview_invite: {
    en: { subject: 'Interview invitation for {role}', body: 'Dear {candidate},\n\nYour interview for the {role} role is proposed for {date}. Please confirm or request another time using this link: {link}\n\nRegards,\n{company}' },
    ar: { subject: 'دعوة لمقابلة لوظيفة {role}', body: 'عزيزي {candidate}،\n\nتم اقتراح موعد مقابلتك لوظيفة {role} في {date}. الرجاء التأكيد أو طلب موعد آخر عبر هذا الرابط: {link}\n\nمع التحية،\n{company}' },
  },
  assessment_invite: {
    en: { subject: 'Assessment for {role}', body: 'Dear {candidate},\n\nAs part of the {role} process, please complete the assessment at this link: {link}\n\nRegards,\n{company}' },
    ar: { subject: 'تقييم لوظيفة {role}', body: 'عزيزي {candidate}،\n\nكجزء من عملية {role}، الرجاء إكمال التقييم عبر هذا الرابط: {link}\n\nمع التحية،\n{company}' },
  },
  offer_sent: {
    en: { subject: 'Your offer for {role}', body: 'Dear {candidate},\n\nWe are pleased to share your offer for the {role} role. Please review and respond from your candidate dashboard.\n\nRegards,\n{company}' },
    ar: { subject: 'عرضك لوظيفة {role}', body: 'عزيزي {candidate}،\n\nيسعدنا مشاركة عرضك لوظيفة {role}. الرجاء المراجعة والرد من لوحة المرشح.\n\nمع التحية،\n{company}' },
  },
  rejection: {
    en: { subject: 'Update on your application for {role}', body: 'Dear {candidate},\n\nThank you for your interest in the {role} role. After careful review we will not be progressing your application at this time.{note}\n\nRegards,\n{company}' },
    ar: { subject: 'تحديث بخصوص طلبك لوظيفة {role}', body: 'عزيزي {candidate}،\n\nشكرا لاهتمامك بوظيفة {role}. بعد المراجعة الدقيقة لن نتابع طلبك في الوقت الحالي.{note}\n\nمع التحية،\n{company}' },
  },
  document_request: {
    en: { subject: 'A document we still need for {role}', body: 'Dear {candidate},\n\nTo continue your application for the {role} role, please upload the following document: {note}\n\nRegards,\n{company}' },
    ar: { subject: 'مستند نطلبه لوظيفة {role}', body: 'عزيزي {candidate}،\n\nلمتابعة طلبك لوظيفة {role}، الرجاء تحميل المستند التالي: {note}\n\nمع التحية،\n{company}' },
  },
  status_update: {
    en: { subject: 'Your application for {role}', body: 'Dear {candidate},\n\nYour application for the {role} role has moved forward. {note}\n\nRegards,\n{company}' },
    ar: { subject: 'طلبك لوظيفة {role}', body: 'عزيزي {candidate}،\n\nتقدم طلبك لوظيفة {role}. {note}\n\nمع التحية،\n{company}' },
  },
};

function fill(text: string, vars: TemplateVars): string {
  return text.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = (vars as unknown as Record<string, string | undefined>)[key];
    return value === undefined ? '' : value;
  }).replace(/\s+$/, '');
}

export function renderTemplate(template: TemplateId, locale: MessageLocale, vars: TemplateVars): Template {
  const chosen = TEMPLATES[template][locale] ?? TEMPLATES[template].en;
  return { subject: fill(chosen.subject, vars), body: fill(chosen.body, vars) };
}

/* Transport interface. Fails closed: without a provider, nothing is sent. */
export interface MessageProvider {
  readonly name: string;
  send(m: Message, to: string): Promise<{ providerId: string }>;
}

export interface QueueInput {
  candidateId: string;
  applicationId?: string | null;
  channel?: MessageChannel;
  locale?: MessageLocale;
  template: TemplateId;
  vars?: Partial<TemplateVars>;
  subject?: string;
  body?: string;
}

export function queueMessage(store: Store, ctx: Ctx, input: QueueInput): Message {
  const candidate = store.candidate(ctx, input.candidateId);
  if (!candidate) throw new CommunicationError('candidate_not_found');
  const locale = input.locale ?? store.tenantSettings(ctx).locale ?? 'en';
  const rendered = renderTemplate(input.template, locale, {
    candidate: candidate.name, role: candidate.targetRole, company: store.tenantName(ctx) ?? '',
    ...input.vars,
  });
  const now = new Date().toISOString();
  const message: Message = {
    id: randomUUID(), tenantId: ctx.tenantId, candidateId: input.candidateId,
    applicationId: input.applicationId ?? null, channel: input.channel ?? 'email', direction: 'out',
    locale, template: input.template, subject: input.subject ?? rendered.subject,
    body: input.body ?? rendered.body, status: 'queued', providerId: null, error: null,
    escalationReason: null, createdAt: now, sentAt: null,
  };
  store.insertMessage(message);
  store.audit(ctx.tenantId, 'system', 'system', 'message_queued', message.id);
  return message;
}

/* Queue a message only when the candidate has an address for the channel;
   otherwise there is nothing to send. Returns null when skipped. */
export function queueForEvent(
  store: Store, ctx: Ctx, input: QueueInput & { channel?: MessageChannel },
): Message | null {
  const candidate = store.candidate(ctx, input.candidateId);
  if (!candidate) return null;
  const channel = input.channel ?? 'email';
  if (channel === 'email' && !candidate.email) return null;
  if (channel === 'sms' && !candidate.phone) return null;
  if (channel === 'whatsapp' && !candidate.phone) return null;
  return queueMessage(store, ctx, input);
}

export interface SendResult { sent: number; failed: number; queued: number; provider: string | null }

/* Send every queued message through the provider. With no provider, nothing
   changes: the count is reported and the outbox keeps the reason visible. */
export async function sendQueued(store: Store, ctx: Ctx, provider: MessageProvider | null): Promise<SendResult> {
  const queued = store.messages(ctx, { status: 'queued' });
  if (!provider) return { sent: 0, failed: 0, queued: queued.length, provider: null };
  let sent = 0; let failed = 0;
  for (const message of queued) {
    const candidate = store.candidate(ctx, message.candidateId);
    const to = message.channel === 'email' ? (candidate?.email ?? '') : (candidate?.phone ?? '');
    try {
      const { providerId } = await provider.send(message, to);
      message.status = 'sent';
      message.providerId = providerId;
      message.sentAt = new Date().toISOString();
      sent += 1;
      store.audit(ctx.tenantId, provider.name, 'system', 'message_sent', message.id);
    } catch (e) {
      message.status = 'failed';
      message.error = e instanceof Error ? e.message : 'send_failed';
      failed += 1;
      store.audit(ctx.tenantId, provider.name, 'system', 'message_failed', message.id);
    }
    store.updateMessage(ctx, message);
  }
  return { sent, failed, queued: 0, provider: provider.name };
}

const ESCALATION_CUES = [
  /\b(human|person|manager|supervisor|complaint|speak to someone|call me)\b/i,
  /(موظف|مدير|شكوى|اتصل بي|شخص)/,
];

/* An inbound reply is captured. If it needs a person, it is escalated for a
   human rather than answered automatically. */
export function recordInbound(
  store: Store, ctx: Ctx,
  input: { candidateId: string; applicationId?: string | null; channel?: MessageChannel; locale?: MessageLocale; body: string },
): Message {
  const body = String(input.body ?? '').trim();
  if (!body) throw new CommunicationError('body_required');
  const escalated = ESCALATION_CUES.some(re => re.test(body));
  const now = new Date().toISOString();
  const message: Message = {
    id: randomUUID(), tenantId: ctx.tenantId, candidateId: input.candidateId,
    applicationId: input.applicationId ?? null, channel: input.channel ?? 'email', direction: 'in',
    locale: input.locale ?? store.tenantSettings(ctx).locale ?? 'en', template: null,
    subject: '', body, status: escalated ? 'escalated' : 'received',
    providerId: null, error: null,
    escalationReason: escalated ? 'Inbound reply needs a human.' : null,
    createdAt: now, sentAt: now,
  };
  store.insertMessage(message);
  store.audit(ctx.tenantId, 'system', 'system', escalated ? 'message_escalated' : 'message_received', message.id);
  return message;
}

export function escalateMessage(store: Store, ctx: Ctx, actor: { name: string; role: string }, id: string, reason: string): Message {
  const message = store.message(ctx, id);
  if (!message) throw new CommunicationError('not_found');
  if (!reason.trim()) throw new CommunicationError('reason_required');
  message.status = 'escalated';
  message.escalationReason = reason;
  store.updateMessage(ctx, message);
  store.audit(ctx.tenantId, actor.name, actor.role, 'message_escalated', message.id);
  return message;
}

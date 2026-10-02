/* Voice session plumbing (L4 consent, L1 ingestion, ADR-0020).

   Three jobs, all server-side:
     1. voiceChain: the only path to a room token. It requires a verified
        interview_screener run of the same candidate whose consent record is
        active and whose session exists with mode verified. No chain, no
        token. There is no override.
     2. verifyVoiceWebhook: every inbound webhook must carry a LiveKit-signed
        Authorization JWT (HS256, iss = API key, exp, sha256 claim over the
        raw body). Unsigned or mis-signed requests are refused before any
        parsing.
     3. ingestVoicePayload: resolves a candidate (JSON-string or object
        metadata, then room name, then explicit data field), requires an
        active consented verified session at ingest time, and writes
        artifacts carrying sessionId and consentId. */

import { AccessToken, WebhookReceiver } from 'livekit-server-sdk';
import { randomUUID } from 'node:crypto';
import type { Store, Ctx } from '../spine/db.ts';
import type { InterviewSession } from '../spine/types.ts';

export interface LivekitConfig { url: string; key: string; secret: string }

export function livekitConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LivekitConfig | null {
  const url = env.LIVEKIT_URL?.trim();
  const key = env.LIVEKIT_API_KEY?.trim();
  const secret = env.LIVEKIT_API_SECRET?.trim();
  if (!url || !key || !secret) return null;
  return { url, key, secret };
}

export class VoiceError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}

/* The consent chain. A room token may be minted only from this. */
export interface VoiceChain { session: InterviewSession; consentId: string }

export function voiceChain(store: Store, ctx: Ctx, candidateId: string, runId: string): VoiceChain {
  const run = store.flowRun(ctx, runId);
  if (!run || run.candidateId !== candidateId) throw new VoiceError('voice_run_not_found');
  if (run.flowId !== 'interview_screener') throw new VoiceError('voice_run_wrong_flow');
  const consentId = run.stepStates['_consent'];
  const sessionId = run.stepStates['_session'];
  if (!consentId || !sessionId) throw new VoiceError('consent_required');
  const consent = store.consent(ctx, consentId);
  if (!consent || consent.candidateId !== candidateId || !consent.grantedAt) {
    throw new VoiceError('consent_required');
  }
  if (consent.withdrawnAt) throw new VoiceError('consent_withdrawn');
  const session = store.session(ctx, sessionId);
  if (!session || session.candidateId !== candidateId || session.mode !== 'verified') {
    throw new VoiceError('consent_required');
  }
  if (session.status === 'stopped') throw new VoiceError('consent_withdrawn');
  return { session, consentId };
}

export async function mintVoiceToken(cfg: LivekitConfig, chain: VoiceChain, displayName: string): Promise<string> {
  const at = new AccessToken(cfg.key, cfg.secret, {
    identity: chain.session.candidateId,
    name: displayName,
    metadata: JSON.stringify({
      candidateId: chain.session.candidateId,
      sessionId: chain.session.id,
      consentId: chain.consentId,
    }),
  });
  at.addGrant({ roomJoin: true, room: `interview-${chain.session.candidateId}` });
  return at.toJwt();
}

/* ---------------------------------------------------------------------- */
/* webhook verification                                                    */

const receivers = new Map<string, WebhookReceiver>();

/* Resolves to the verified event, or null for any failure. The SDK verifier
   checks signature, issuer, exp and the sha256 claim over the raw body. */
export async function verifyVoiceWebhook(
  cfg: LivekitConfig, rawBody: string, authHeader: string | undefined,
): Promise<unknown | null> {
  if (!authHeader) return null;
  const cacheKey = `${cfg.key}:${cfg.secret.slice(0, 8)}`;
  let receiver = receivers.get(cacheKey);
  if (!receiver) {
    receiver = new WebhookReceiver(cfg.key, cfg.secret);
    receivers.set(cacheKey, receiver);
  }
  try {
    return await receiver.receive(rawBody, authHeader);
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------------- */
/* payload resolution and ingestion                                        */

export interface VoiceIdentity { candidateId: string; sessionId: string | null; consentId: string | null }

function parseMetadata(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const value = JSON.parse(raw) as unknown;
      return value && typeof value === 'object' ? value as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return {};
}

function candidateFromRoomName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const match = /^interview-([0-9a-fA-F-]{36})$/.exec(name);
  return match ? match[1]! : null;
}

export function resolveVoiceIdentity(body: unknown): VoiceIdentity | null {
  const b = (body ?? {}) as {
    participant?: { metadata?: unknown };
    room?: { name?: unknown };
    data?: { candidateId?: unknown; sessionId?: unknown; consentId?: unknown };
  };
  const meta = parseMetadata(b.participant?.metadata);
  const candidateId =
    (typeof meta.candidateId === 'string' && meta.candidateId.length > 0 ? meta.candidateId : null)
    ?? candidateFromRoomName(b.room?.name)
    ?? (typeof b.data?.candidateId === 'string' && b.data.candidateId.length > 0 ? b.data.candidateId : null);
  if (!candidateId) return null;
  const pick = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
  return {
    candidateId,
    sessionId: pick(meta.sessionId) ?? pick(b.data?.sessionId),
    consentId: pick(meta.consentId) ?? pick(b.data?.consentId),
  };
}

const MAX_BULLETS = 50;
const BULLET_FIELD_CAP = 400;
const NOTE_CAP = 2000;

function text(v: unknown, cap: number): string {
  return typeof v === 'string' ? v.slice(0, cap) : '';
}

export interface VoiceIngestResult { ingested: number; sessionId: string; consentId: string }

/* Ingest happens only inside an active consented verified session. The
   session named in the payload wins when it belongs to the candidate and is
   eligible; otherwise the candidate's latest active verified session is
   used. No eligible session, no writes. */
export function ingestVoicePayload(store: Store, body: unknown): VoiceIngestResult {
  const identity = resolveVoiceIdentity(body);
  if (!identity) throw new VoiceError('missing_candidate_id');
  const tenantId = store.tenantForCandidate(identity.candidateId);
  if (!tenantId) throw new VoiceError('candidate_not_found');
  const ctx: Ctx = { tenantId };

  let session: InterviewSession | null = null;
  if (identity.sessionId) {
    const named = store.session(ctx, identity.sessionId);
    /* The named session must be active: late artifacts must not attach to a
       finished session, and a stopped session has no consent to write under. */
    if (named && named.candidateId === identity.candidateId
      && named.mode === 'verified' && named.status === 'active') {
      session = named;
    }
  }
  if (!session) {
    session = store.sessions(ctx, identity.candidateId)
      .filter(s => s.mode === 'verified' && s.status === 'active')
      .at(-1) ?? null;
  }
  if (!session) throw new VoiceError('consent_required');
  const consent = session.consentId ? store.consent(ctx, session.consentId) : null;
  if (!consent || consent.withdrawnAt) throw new VoiceError('consent_required');

  const b = (body ?? {}) as { data?: { resume_bullet?: unknown; interviewer_note?: { evaluation_summary?: unknown } } };
  const rawBullets = Array.isArray(b.data?.resume_bullet) ? b.data!.resume_bullet! : [];
  const bullets = rawBullets.slice(0, MAX_BULLETS).map((entry: unknown) => {
    const bullet = (entry ?? {}) as { ownership?: unknown; action?: unknown; outcome?: unknown };
    return {
      ownership: text(bullet.ownership, BULLET_FIELD_CAP),
      action: text(bullet.action, BULLET_FIELD_CAP),
      outcome: text(bullet.outcome, BULLET_FIELD_CAP),
    };
  }).filter(bullet => bullet.ownership || bullet.action || bullet.outcome);

  let ingested = 0;
  for (const bullet of bullets) {
    store.insertArtifact({
      id: randomUUID(), tenantId, candidateId: identity.candidateId,
      kind: 'handoff_block', title: 'Extracted Resume Bullet', quarantine: 'clean',
      fields: { ...bullet, sessionId: session.id, consentId: consent.id, source: 'livekit' },
      sanitizedText: null, content: null, injectionAttempts: 0,
      createdBy: 'livekit_agent', createdAt: new Date().toISOString(),
    });
    ingested++;
  }

  const note = b.data?.interviewer_note;
  const summary = text(note?.evaluation_summary, NOTE_CAP);
  if (summary) {
    store.insertArtifact({
      id: randomUUID(), tenantId, candidateId: identity.candidateId,
      kind: 'debrief', title: 'Interview Evaluation', quarantine: 'clean',
      fields: { evaluation_summary: summary, sessionId: session.id, consentId: consent.id, source: 'livekit' },
      sanitizedText: null, content: null, injectionAttempts: 0,
      createdBy: 'livekit_agent', createdAt: new Date().toISOString(),
    });
    ingested++;
  }

  store.audit(tenantId, 'agent:livekit_webhook', 'system', 'voice_artifacts_ingested', `${session.id}:${ingested}`);
  return { ingested, sessionId: session.id, consentId: consent.id };
}

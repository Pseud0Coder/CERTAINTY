/* The candidate's evidence, gathered once (ADR-0024). The profile insight
   and application scoring read the same corpora from here, so a requirement
   is judged against identical text everywhere.

   Nothing raw leaves this module: only lower-cased searchable text and the
   connector states, never transcript text, never artifact bodies. */

import type { Store, Ctx } from './db.ts';
import type { ResumeFields } from './agents.ts';
import type { Snapshot, Provider } from './connectors.ts';
import { evidenceSources, type EvidenceSource } from './requirement.ts';

export interface ConnectorState {
  provider: Provider;
  username: string;
  verified: boolean;
  syncedAt: string;
  snapshot: Snapshot | null;
}

export function connectorStates(store: Store, ctx: Ctx, candidateId: string): ConnectorState[] {
  const arts = store.artifacts(ctx, candidateId);
  return arts.filter(a => a.kind === 'connector_link').map(link => {
    const f = link.fields as { provider: Provider; username: string; verified?: boolean };
    const snap = arts.filter(a => a.kind === 'connector_snapshot' && (a.fields as { provider?: string }).provider === f.provider).at(-1);
    const sf = snap?.fields as { data?: Snapshot; fetchedAt?: string } | undefined;
    return { provider: f.provider, username: f.username, verified: !!f.verified, syncedAt: sf?.fetchedAt ?? '', snapshot: sf?.data ?? null };
  });
}

/* Only the candidate's own words from verified sessions, and only sentences
   that do not deny something: "I have never run Kubernetes in production"
   mentions every term and is evidence of the opposite. */
const NEGATION = /\b(not|never|no|none|haven'?t|hasn'?t|didn'?t|don'?t|doesn'?t|wasn'?t|without|lack|lacking)\b/i;

export interface CandidateCorpora {
  cvCorpus: string;
  interviewCorpus: string;
  connectors: ConnectorState[];
}

export function candidateCorpora(store: Store, ctx: Ctx, candidateId: string): CandidateCorpora {
  const arts = store.artifacts(ctx, candidateId).filter(a => a.quarantine !== 'rejected');
  const resume = (arts.filter(a => a.kind === 'resume').at(-1)?.fields ?? {}) as unknown as ResumeFields;
  const handoffs = arts.filter(a => a.kind === 'handoff_block');

  const cvCorpus = [
    ...(resume.roles ?? []).flatMap(r => r.bullets),
    ...handoffs.flatMap(h => ((h.fields as { bullets?: string[] }).bullets ?? [])),
    ...(resume.skills ?? []).flatMap(g => g.items),
    ...(resume.tools ?? []),
  ].join(' \n ').toLowerCase();

  const verifiedSessions = store.sessions(ctx, candidateId).filter(s => s.mode === 'verified' && s.status !== 'stopped');
  const interviewCorpus = verifiedSessions
    .flatMap(s => (s.transcript ?? []).filter(t => !/^interviewer$/i.test(t.who)).map(t => t.text))
    .flatMap(text => text.split(/(?<=[.!?])\s+/))
    .filter(sentence => !NEGATION.test(sentence))
    .join(' \n ').toLowerCase();

  return { cvCorpus, interviewCorpus, connectors: connectorStates(store, ctx, candidateId) };
}

/* The ordered source list the matcher reads, strongest first. */
export function candidateEvidenceSources(store: Store, ctx: Ctx, candidateId: string): EvidenceSource[] {
  const { cvCorpus, interviewCorpus, connectors } = candidateCorpora(store, ctx, candidateId);
  return evidenceSources({ interviewCorpus, cvCorpus, connectors });
}

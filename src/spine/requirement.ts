/* The one requirement matcher (ADR-0024). A requirement string is judged
   against the candidate's evidence in exactly one place, so the profile
   insight and the application scoring can never disagree about whether a
   must-have is met.

   Evidence sources, strongest first: a verified interview (the platform
   checked it), a connected account (verified means ownership was proven),
   the CV (a claim). Status precedence: verified > claimed > partial > gap.
   Matching uses the research agent's own term extraction (`keywords`), so
   every surface reads the same requirement the same way. */

import { keywords } from './agents.ts';
import { evidenceCorpus, type Snapshot, type Provider } from './connectors.ts';

export type FitStatus = 'verified' | 'claimed' | 'partial' | 'gap';

/* Evidence strength used by scoring (ADR-0024): a verified source counts
   fully, a claim at 0.7, a partial touch at 0.35, no evidence at 0. */
export const FIT_STRENGTH: Record<FitStatus, number> = {
  verified: 1, claimed: 0.7, partial: 0.35, gap: 0,
};

export interface EvidenceSource {
  /* Display label, e.g. "CV" or "GitHub (unverified)". */
  label: string;
  /* Lower-cased searchable text for this source. */
  corpus: string;
  /* The platform itself proved this source, as opposed to the candidate
     asserting it. */
  verified: boolean;
}

export interface RequirementMatch {
  requirement: string;
  status: FitStatus;
  /* Labels of sources that cover every term, in strength order. */
  sources: string[];
  /* Labels of sources that mention only some of the terms, so a partial
     row never reads as empty. */
  partial: string[];
}

/* Strip a leading "must have"/"required"/"essential" marker and trailing
   punctuation. The label the interface shows is the requirement itself,
   never the marker. */
export function normalizeRequirement(must: string): string {
  return must.replace(/^\s*(must[- ]have|required|essential)\s*:?\s*/i, '').replace(/[.\s]+$/, '');
}

export function matchRequirement(requirement: string, sources: EvidenceSource[]): RequirementMatch {
  const terms = keywords(requirement);
  const covers = (corpus: string) => terms.length > 0 && terms.every(t => corpus.includes(t));
  const touches = (corpus: string) => terms.some(t => corpus.includes(t));
  const covered: string[] = [];
  const partial: string[] = [];
  let verified = false;
  let claimed = false;
  for (const s of sources) {
    if (covers(s.corpus)) {
      covered.push(s.label);
      if (s.verified) verified = true; else claimed = true;
    } else if (touches(s.corpus)) {
      partial.push(s.label);
    }
  }
  const status: FitStatus = verified ? 'verified' : claimed ? 'claimed' : partial.length ? 'partial' : 'gap';
  return { requirement, status, sources: covered, partial };
}

/* Build the ordered source list from the three evidence classes the spine
   holds. Empty corpora are dropped so they cannot match. The labels match
   what the profile insight has always shown. */
export function evidenceSources(input: {
  interviewCorpus: string;
  cvCorpus: string;
  connectors: Array<{ provider: Provider; verified: boolean; snapshot: Snapshot | null }>;
}): EvidenceSource[] {
  const label: Record<Provider, string> = { github: 'GitHub', leetcode: 'LeetCode' };
  const sources: EvidenceSource[] = [];
  if (input.interviewCorpus.trim()) sources.push({ label: 'Verified interview', corpus: input.interviewCorpus, verified: true });
  for (const k of input.connectors) {
    if (!k.snapshot) continue;
    const corpus = evidenceCorpus(k.snapshot);
    if (!corpus.trim()) continue;
    sources.push({ label: k.verified ? label[k.provider] : `${label[k.provider]} (unverified)`, corpus, verified: k.verified });
  }
  if (input.cvCorpus.trim()) sources.push({ label: 'CV', corpus: input.cvCorpus, verified: false });
  return sources;
}

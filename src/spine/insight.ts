/* The one-page profile insight (ADR-0022): what a hiring manager at the
   target company reads in a minute, assembled from the spine at view time.

   The page's honesty is the product: every requirement shows where its
   evidence comes from, and "verified" is only ever used for evidence the
   platform checked itself (a verified interview, an account whose
   ownership was proven). A CV line or an unproven account is "claimed".
   Matching uses the research agent's own term extraction, so the page and
   the research report never judge the same requirement differently.

   Public-safe by construction: no contact details, no compensation, no
   recruiter notes, no transcript text. Only counts, labels and the
   candidate's own achievement lines leave the spine. */

import type { Store, Ctx } from './db.ts';
import type { StarMetrics } from './types.ts';
import type { ResumeFields } from './agents.ts';
import { keywords } from './agents.ts';
import { evidenceCorpus, profileUrl, type Snapshot, type Provider } from './connectors.ts';

export type FitStatus = 'verified' | 'claimed' | 'partial' | 'gap';

export interface ProfileInsight {
  targetRole: string;
  targetCompany: string | null;
  /* `sources` hold full evidence; `partial` names where only some of the
     requirement's terms appear, so a partial row never reads as empty. */
  fit: Array<{ requirement: string; status: FitStatus; sources: string[]; partial: string[] }>;
  fitSummary: { evidenced: number; verified: number; total: number };
  achievements: string[];
  interview: { date: string; star: StarMetrics; ownership: number | null } | null;
  github: {
    username: string; url: string; verified: boolean; syncedAt: string;
    repos: Array<{ name: string; description: string; language: string | null; stars: number; url: string }>;
    mergedPrCount: number; mergedPrs: Array<{ repo: string; title: string; url: string }>;
    languages: string[]; activeMonths: number;
  } | null;
  leetcode: {
    username: string; url: string; verified: boolean; syncedAt: string;
    solved: { easy: number; medium: number; hard: number; all: number };
    contest: { rating: number; attended: number; topPercentage: number | null } | null;
    badges: string[];
  } | null;
}

interface ConnectorState { provider: Provider; username: string; verified: boolean; syncedAt: string; snapshot: Snapshot | null }

export function connectorStates(store: Store, ctx: Ctx, candidateId: string): ConnectorState[] {
  const arts = store.artifacts(ctx, candidateId);
  return arts.filter(a => a.kind === 'connector_link').map(link => {
    const f = link.fields as { provider: Provider; username: string; verified?: boolean };
    const snap = arts.filter(a => a.kind === 'connector_snapshot' && (a.fields as { provider?: string }).provider === f.provider).at(-1);
    const sf = snap?.fields as { data?: Snapshot; fetchedAt?: string } | undefined;
    return { provider: f.provider, username: f.username, verified: !!f.verified, syncedAt: sf?.fetchedAt ?? '', snapshot: sf?.data ?? null };
  });
}

export function profileInsight(store: Store, ctx: Ctx, candidateId: string): ProfileInsight | null {
  const c = store.candidate(ctx, candidateId);
  if (!c) return null;
  const arts = store.artifacts(ctx, candidateId).filter(a => a.quarantine !== 'rejected');
  const jd = arts.filter(a => a.kind === 'jd').at(-1);
  const resume = (arts.filter(a => a.kind === 'resume').at(-1)?.fields ?? {}) as unknown as ResumeFields;
  const handoffs = arts.filter(a => a.kind === 'handoff_block');
  const page = arts.filter(a => a.kind === 'profile_page').at(-1);

  const cvCorpus = [
    ...(resume.roles ?? []).flatMap(r => r.bullets),
    ...handoffs.flatMap(h => ((h.fields as { bullets?: string[] }).bullets ?? [])),
    ...(resume.skills ?? []).flatMap(g => g.items),
    ...(resume.tools ?? []),
  ].join(' \n ').toLowerCase();

  /* Only the candidate's own words from verified sessions, and only
     sentences that do not deny something: "I have never run Kubernetes in
     production" mentions every term and is evidence of the opposite. */
  const verifiedSessions = store.sessions(ctx, candidateId).filter(s => s.mode === 'verified' && s.status !== 'stopped');
  const NEGATION = /\b(not|never|no|none|haven'?t|hasn'?t|didn'?t|don'?t|doesn'?t|wasn'?t|without|lack|lacking)\b/i;
  const interviewCorpus = verifiedSessions
    .flatMap(s => (s.transcript ?? []).filter(t => !/^interviewer$/i.test(t.who)).map(t => t.text))
    .flatMap(text => text.split(/(?<=[.!?])\s+/))
    .filter(sentence => !NEGATION.test(sentence))
    .join(' \n ').toLowerCase();

  const connectors = connectorStates(store, ctx, candidateId);
  const label: Record<Provider, string> = { github: 'GitHub', leetcode: 'LeetCode' };

  const musts = ((jd?.fields as { mustHave?: string[] } | undefined)?.mustHave ?? []);
  const fit = musts.map(must => {
    const requirement = must.replace(/^\s*(must[- ]have|required|essential)\s*:?\s*/i, '').replace(/[.\s]+$/, '');
    const terms = keywords(requirement);
    const covers = (corpus: string) => terms.length > 0 && terms.every(t => corpus.includes(t));
    const touches = (corpus: string) => terms.some(t => corpus.includes(t));
    const sources: string[] = [];
    let verified = false; let claimed = false;
    if (covers(interviewCorpus)) { sources.push('Verified interview'); verified = true; }
    for (const k of connectors) {
      if (k.snapshot && covers(evidenceCorpus(k.snapshot))) {
        sources.push(k.verified ? label[k.provider] : `${label[k.provider]} (unverified)`);
        if (k.verified) verified = true; else claimed = true;
      }
    }
    if (covers(cvCorpus)) { sources.push('CV'); claimed = true; }
    const partial: string[] = [];
    if (!covers(interviewCorpus) && touches(interviewCorpus)) partial.push('Verified interview');
    for (const k of connectors) {
      if (k.snapshot && !covers(evidenceCorpus(k.snapshot)) && touches(evidenceCorpus(k.snapshot))) partial.push(label[k.provider]);
    }
    if (!covers(cvCorpus) && touches(cvCorpus)) partial.push('CV');
    const status: FitStatus = verified ? 'verified' : claimed ? 'claimed' : partial.length ? 'partial' : 'gap';
    return { requirement, status, sources, partial };
  });

  /* Achievements: the candidate's own revamped lines, quantified first. */
  const highlights = ((page?.fields as { highlights?: string[] } | undefined)?.highlights
    ?? (resume.roles ?? []).flatMap(r => r.bullets));
  const achievements = [...highlights.filter(h => /\d/.test(h)), ...highlights.filter(h => !/\d/.test(h))].slice(0, 3);

  const lastVerified = verifiedSessions.filter(s => s.star).at(-1);
  const interview = lastVerified
    ? { date: lastVerified.date || lastVerified.createdAt.slice(0, 10), star: lastVerified.star!, ownership: lastVerified.ownership }
    : null;

  const gh = connectors.find(k => k.provider === 'github' && k.snapshot?.provider === 'github');
  const lc = connectors.find(k => k.provider === 'leetcode' && k.snapshot?.provider === 'leetcode');
  const ghSnap = gh?.snapshot?.provider === 'github' ? gh.snapshot : null;
  const lcSnap = lc?.snapshot?.provider === 'leetcode' ? lc.snapshot : null;

  return {
    targetRole: c.targetRole,
    targetCompany: c.targetCompany,
    fit,
    fitSummary: {
      evidenced: fit.filter(f => f.status === 'verified' || f.status === 'claimed').length,
      verified: fit.filter(f => f.status === 'verified').length,
      total: fit.length,
    },
    achievements,
    interview,
    github: gh && ghSnap ? {
      username: gh.username, url: profileUrl('github', gh.username), verified: gh.verified, syncedAt: gh.syncedAt,
      repos: ghSnap.repos.slice(0, 4).map(r => ({ name: r.name, description: r.description, language: r.language, stars: r.stars, url: r.url })),
      mergedPrCount: ghSnap.mergedPrs.length,
      mergedPrs: ghSnap.mergedPrs.slice(0, 3).map(p => ({ repo: p.repo, title: p.title, url: p.url })),
      languages: ghSnap.languages.slice(0, 5).map(l => l.name),
      activeMonths: ghSnap.activeMonths,
    } : null,
    leetcode: lc && lcSnap ? {
      username: lc.username, url: profileUrl('leetcode', lc.username), verified: lc.verified, syncedAt: lc.syncedAt,
      solved: lcSnap.solved, contest: lcSnap.contest, badges: lcSnap.badges.slice(0, 4),
    } : null,
  };
}

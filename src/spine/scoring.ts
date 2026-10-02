/* Deterministic application scoring, knockouts, ranking, overrides and
   progression (ADR-0024). No model is involved: an audited number that moves
   between identical runs is not a measurement, and a gate a model can talk
   its way through is not a gate.

   Two rules shape everything here:
   - Knockouts are evaluated apart from the score, and only on explicit
     evidence. An unknown value is a "check" note, never a knockout.
   - Every override records who and why, and re-scoring never clears it, so
     a rank is always explainable from its components. */

import type { Store, Ctx } from './db.ts';
import type {
  Application, ApplicationStatus, Candidate, KnockoutResult, MustHave,
  Requisition, RequisitionCriteria, ScoreComponent, ApplicationScore,
} from './types.ts';
import { candidateEvidenceSources } from './evidence.ts';
import { FIT_STRENGTH, matchRequirement, normalizeRequirement, type RequirementMatch } from './requirement.ts';

const MONTH = /^(\d{1,2})\/(\d{4})$/;

/* Years between the conservative CV tenure start and end (the spine truth).
   Unknown when the start is missing. Future or malformed ends fall back to
   now. Rounded to one decimal so the number is stable between runs. */
export function candidateYears(c: Candidate): number | null {
  const start = parseMonth(c.cvTenureStart);
  if (start === null) return null;
  const end = parseMonth(c.cvTenureEnd) ?? Date.now();
  if (end <= start) return null;
  return Math.round(((end - start) / (365.25 * 24 * 60 * 60 * 1000)) * 10) / 10;
}

function parseMonth(s: string | null | undefined): number | null {
  const m = s ? MONTH.exec(s.trim()) : null;
  if (!m) return null;
  return Date.UTC(Number(m[2]), Number(m[1]) - 1, 1);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* Build the per-must-have components. `matches` is aligned with
   `criteria.mustHaves` by index. */
export function scoreComponents(criteria: RequisitionCriteria, matches: RequirementMatch[]): ScoreComponent[] {
  return criteria.mustHaves.map((m: MustHave, i: number) => {
    const match = matches[i]!;
    const strength = FIT_STRENGTH[match.status];
    return {
      mustHaveId: m.id, label: m.label, weight: m.weight, required: m.required,
      status: match.status, strength, points: round2(m.weight * strength),
      maxPoints: m.weight, sources: match.sources,
    };
  });
}

export function evaluateKnockouts(
  criteria: RequisitionCriteria,
  components: ScoreComponent[],
  years: number | null,
  location: string | null,
  workAuthorized: boolean | null,
): KnockoutResult[] {
  const out: KnockoutResult[] = [];
  for (const c of components) {
    if (!c.required) continue;
    out.push({
      rule: 'required_must_have', label: c.label,
      outcome: c.status === 'gap' ? 'knocked_out' : 'pass',
      reason: c.status === 'gap'
        ? `No evidence for required must-have: ${c.label}.`
        : `Evidence found (${c.status}) for required must-have: ${c.label}.`,
    });
  }
  if (criteria.minYears !== null && criteria.minYears !== undefined) {
    const outcome: KnockoutResult['outcome'] = years === null ? 'check' : years >= criteria.minYears ? 'pass' : 'knocked_out';
    out.push({
      rule: 'min_years', label: `${criteria.minYears}+ years`, outcome,
      reason: years === null ? 'Years of experience not established.'
        : `${years} years against a minimum of ${criteria.minYears}.`,
    });
  }
  if (criteria.locations.length > 0 && !criteria.remoteOk) {
    const loc = location?.trim().toLowerCase() ?? '';
    const accepted = criteria.locations.map(l => l.trim().toLowerCase()).filter(Boolean);
    const outcome: KnockoutResult['outcome'] = !loc ? 'check' : accepted.includes(loc) ? 'pass' : 'knocked_out';
    out.push({
      rule: 'location', label: accepted.join(', '), outcome,
      reason: !loc ? 'Location not established.'
        : accepted.includes(loc) ? 'Location accepted.'
          : `${location} is outside the accepted list.`,
    });
  }
  if (criteria.workAuthRequired) {
    const outcome: KnockoutResult['outcome'] = workAuthorized === null ? 'check' : workAuthorized ? 'pass' : 'knocked_out';
    out.push({
      rule: 'work_authorization', label: 'Work authorisation', outcome,
      reason: workAuthorized === null ? 'Work authorisation not stated.'
        : workAuthorized ? 'Work authorisation confirmed.' : 'Work authorisation declined.',
    });
  }
  return out;
}

/* Pure scoring: must-have matches plus the explicit facts that can knock an
   application out. The total is a weighted percentage of the requirements
   met, 0 to 100, before any override adjustment. */
export function computeScore(input: {
  criteria: RequisitionCriteria;
  matches: RequirementMatch[];
  years: number | null;
  location: string | null;
  workAuthorized: boolean | null;
}): ApplicationScore {
  const components = scoreComponents(input.criteria, input.matches);
  const maxTotal = components.reduce((s, c) => s + c.maxPoints, 0);
  const earned = components.reduce((s, c) => s + c.points, 0);
  const total = maxTotal > 0 ? Math.round((earned / maxTotal) * 100) : 0;
  return {
    total, components, years: input.years,
    knockouts: evaluateKnockouts(input.criteria, components, input.years, input.location, input.workAuthorized),
    computedAt: new Date().toISOString(),
  };
}

/* Gather the candidate's evidence and score it against a requisition. */
export function scoreApplication(store: Store, ctx: Ctx, req: Requisition, candidateId: string): ApplicationScore {
  const candidate = store.candidate(ctx, candidateId);
  const resumeFields = store.artifacts(ctx, candidateId, 'resume').at(-1)?.fields as { location?: string } | undefined;
  const sources = candidateEvidenceSources(store, ctx, candidateId);
  const matches = req.criteria.mustHaves.map(m => matchRequirement(normalizeRequirement(m.label), sources));
  return computeScore({
    criteria: req.criteria,
    matches,
    years: candidate ? candidateYears(candidate) : null,
    location: resumeFields?.location ?? null,
    workAuthorized: null,
  });
}

/* The score a reader sees: the computed total plus any adjustment, clamped
   to 0 to 100. Null when nothing has been scored yet. */
export function effectiveScore(app: Application): number | null {
  if (!app.score) return null;
  const delta = app.override?.kind === 'adjust' ? app.override.delta : 0;
  return Math.max(0, Math.min(100, Math.round((app.score.total + delta))));
}

function hasKnockout(app: Application): boolean {
  return (app.score?.knockouts ?? []).some(k => k.outcome === 'knocked_out');
}

export function isExcluded(app: Application): boolean {
  return app.override?.kind === 'exclude';
}

/* Eligible means: not excluded, and not knocked out unless a human included
   it. Only eligible applications receive a rank. */
export function isEligible(app: Application): boolean {
  if (isExcluded(app)) return false;
  if (app.override?.kind === 'include') return true;
  if (['rejected', 'withdrawn', 'hired'].includes(app.status)) return false;
  return !hasKnockout(app);
}

function verifiedCount(app: Application): number {
  return (app.score?.components ?? []).filter(c => c.status === 'verified').length;
}

export interface ApplicationRankRow {
  application: Application;
  effectiveScore: number | null;
  knockedOut: boolean;
  excluded: boolean;
  rank: number | null;
}

/* Rank among eligible applications: score desc, then more verified
   must-haves, then earlier application. Ties in all three share the lower
   rank number. Non-eligible rows carry rank null so the interface can say
   why they are not in the list. */
export function rankApplications(apps: Application[]): ApplicationRankRow[] {
  const rows: ApplicationRankRow[] = apps.map(a => ({
    application: a, effectiveScore: effectiveScore(a),
    knockedOut: hasKnockout(a) && a.override?.kind !== 'include', excluded: isExcluded(a), rank: null,
  }));
  const eligible = rows.filter(r => isEligible(r.application));
  eligible.sort((a, b) =>
    (b.effectiveScore ?? -1) - (a.effectiveScore ?? -1)
    || verifiedCount(b.application) - verifiedCount(a.application)
    || a.application.createdAt.localeCompare(b.application.createdAt));
  let rank = 0;
  let prev: ApplicationRankRow | null = null;
  for (const row of eligible) {
    const same = prev
      && row.effectiveScore === prev.effectiveScore
      && verifiedCount(row.application) === verifiedCount(prev.application)
      && row.application.createdAt === prev.application.createdAt;
    if (!same) rank += 1;
    row.rank = rank;
    prev = row;
  }
  return rows;
}

/* Progression: a per-requisition threshold sets a status automatically for
   applications still in play. It never overwrites a terminal status and
   never downgrades a shortlist. A human "include" deliberately returns a
   knocked-out application to play. Stage advances stay human (A9); this only
   sets the screening status, audited as agent:screening. */
export function progressionStatus(req: Requisition, app: Application): ApplicationStatus {
  const include = app.override?.kind === 'include';
  const inPlay = ['new', 'screened', 'shortlisted'].includes(app.status);
  if (!inPlay && !(app.status === 'knocked_out' && include)) return app.status;
  if (hasKnockout(app) && !include) return 'knocked_out';
  const score = effectiveScore(app);
  if (score === null) return app.status === 'knocked_out' ? 'screened' : app.status;
  if (req.shortlistAt !== null && score >= req.shortlistAt) return 'shortlisted';
  if (app.status === 'shortlisted') return 'shortlisted';
  return 'screened';
}

/* ---- de-duplication (ADR-0024) ---- */

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export interface DedupInput {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  employer?: string | null;
  cvHash?: string | null;
}

export interface DedupMatch { candidateId: string; reason: string }

/* Same email, same phone, same CV hash, or the same normalised name with an
   overlapping employer. Returns the existing candidate to attach to, and why,
   never a new record. */
export function findDuplicate(store: Store, ctx: Ctx, input: DedupInput): DedupMatch | null {
  const email = input.email?.trim().toLowerCase() || null;
  const phone = input.phone?.replace(/\D+/g, '') || null;
  const name = input.name ? normalizeName(input.name) : null;
  const employer = input.employer?.trim().toLowerCase() || null;
  for (const c of store.candidates(ctx)) {
    if (email && c.email && c.email.toLowerCase() === email) return { candidateId: c.id, reason: 'Same email.' };
    if (phone && c.phone && c.phone.replace(/\D+/g, '') === phone) return { candidateId: c.id, reason: 'Same phone.' };
    if (input.cvHash) {
      const sha = (store.artifacts(ctx, c.id, 'resume').at(-1)?.fields as { sha256?: string } | undefined)?.sha256;
      if (sha && sha === input.cvHash) return { candidateId: c.id, reason: 'Same CV.' };
    }
    if (name && normalizeName(c.name) === name && employer && (c.employer ?? '').toLowerCase() === employer) {
      return { candidateId: c.id, reason: 'Same name and employer.' };
    }
  }
  return null;
}

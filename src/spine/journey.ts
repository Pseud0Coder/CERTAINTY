/* The candidate journey: derived state, one source of truth (the spine).
   Onboarding -> research -> role-by-role resume -> CV -> LinkedIn -> interview.
   Nothing here is stored twice; every gate is computed from artifacts and
   flow runs. Recruiter-seeded candidates start at the top of this chain. */
import type { Store, Ctx } from './db.ts';
import type { Artifact, FindingKind, ResearchFinding } from './types.ts';

export interface RoleProgress {
  key: string;
  title: string;
  company: string;
  done: boolean;
}

export interface JourneyState {
  onboarding: 'pending' | 'complete';
  research: 'pending' | 'complete';
  roles: RoleProgress[];
  rolesDone: boolean;
  cv: 'pending' | 'complete';
  linkedin: 'locked' | 'unlocked' | 'complete';
  interview: 'locked' | 'unlocked';
  findings: ResearchFinding[];
  unlockNotes: Record<string, string>;
}

export function roleKey(index: number, company: string): string {
  return `${index}:${company}`;
}

export function resumeRoles(store: Store, ctx: Ctx, candidateId: string): Array<{ key: string; title: string; company: string; start: string; end: string }> {
  const resume = store.artifacts(ctx, candidateId).filter(a => a.kind === 'resume' && a.quarantine !== 'rejected').at(-1);
  const fields = (resume?.fields ?? {}) as { roles?: Array<{ title: string; company: string; start: string; end: string }> };
  return (fields.roles ?? []).map((r, i) => ({
    key: roleKey(i, r.company), title: r.title, company: r.company, start: r.start, end: r.end,
  }));
}

export function journeyState(store: Store, ctx: Ctx, candidateId: string): JourneyState {
  const c = store.candidate(ctx, candidateId);
  if (!c) throw new Error('candidate_not_found');
  const artifacts = store.artifacts(ctx, candidateId).filter(a => a.quarantine !== 'rejected');
  const has = (kind: string) => artifacts.some(a => a.kind === kind);

  const onboarding = (c.targetCompany && has('jd') && has('resume') && (has('linkedin_snapshot') || has('linkedin_link')))
    ? 'complete' as const : 'pending' as const;

  const report = artifacts.filter(a => a.kind === 'research_report').at(-1);
  const research = report ? 'complete' as const : 'pending' as const;
  const findings = ((report?.fields as { findings?: ResearchFinding[] } | undefined)?.findings ?? []);

  const rolesBase = resumeRoles(store, ctx, candidateId);
  const handoffs = artifacts.filter(a => a.kind === 'handoff_block');
  const roles: RoleProgress[] = rolesBase.map(r => ({
    key: r.key, title: r.title, company: r.company,
    done: handoffs.some(hn => (hn.fields as { roleKey?: string }).roleKey === r.key),
  }));
  const rolesDone = roles.length > 0 && roles.every(r => r.done);

  const cv = has('cv') ? 'complete' as const : 'pending' as const;
  const linkedinRun = store.flowRuns(ctx, candidateId)
    .some(run => run.flowId === 'linkedin_studio' && run.status === 'complete');
  const linkedin = linkedinRun ? 'complete' as const : (rolesDone && research === 'complete' ? 'unlocked' as const : 'locked' as const);
  const interview = (cv === 'complete' && linkedin === 'complete') ? 'unlocked' as const : 'locked' as const;

  const unlockNotes: Record<string, string> = {};
  if (linkedin === 'locked') {
    unlockNotes['linkedin'] = rolesDone
      ? 'Complete the research step first'
      : `Finish every role in My Resume first (${roles.filter(r => !r.done).length} left)`;
  }
  if (interview === 'locked') {
    unlockNotes['interview'] = cv !== 'complete'
      ? 'Your revamped CV is generated once every role is complete'
      : 'Finish your LinkedIn sections to unlock the interview';
  }
  return {
    onboarding, research, roles, rolesDone, cv, linkedin, interview,
    findings, unlockNotes,
  };
}

export function findingsByKind(findings: ResearchFinding[]): Record<FindingKind, ResearchFinding[]> {
  return {
    good: findings.filter(f => f.kind === 'good'),
    improve: findings.filter(f => f.kind === 'improve'),
    needs_work: findings.filter(f => f.kind === 'needs_work'),
  };
}

/* Role projections (L2). The only shapes the API may serialize.
   Internal fields (current compensation, expectations, notice, motivation)
   and recruiter notes exist only in recruiter and admin projections. */
import type { Store, Ctx } from './db.ts';
import type {
  Candidate, CandidatePublic, CandidateRoleView, PublicSessionView, Flag, Role,
} from './types.ts';

const INTERNAL_KEYS = new Set([
  'currentCompensation', 'compExpectations', 'noticePeriod', 'motivation',
  'current_compensation', 'comp_expectations', 'notice_period', 'motivation',
  'passwordHash', 'password_hash', 'sanitizedText', 'sanitized_text',
]);

export function candidatePublic(c: Candidate): CandidatePublic {
  return {
    id: c.id, name: c.name, targetRole: c.targetRole, targetCompany: c.targetCompany,
    employer: c.employer, tenure: c.tenure, stage: c.stage, parked: c.parked,
    linkedinStatus: c.linkedinStatus,
  };
}

/* Verified sessions are visible to recruiters. Practice sessions never leave
   the candidate scope (design language: practice sessions are private). */
export function sessionsForRole(role: Role, sessions: Array<{ mode: string }>): Array<{ mode: string }> {
  return role === 'candidate' ? sessions : sessions.filter(s => s.mode === 'verified');
}

export function recruiterCandidateView(ctx: Ctx, store: Store, candidateId: string) {
  const c = store.candidate(ctx, candidateId);
  if (!c) return null;
  const flags = store.flags(ctx, candidateId);
  const sessions = sessionsForRole('recruiter', store.sessions(ctx, candidateId));
  const artifacts = store.artifacts(ctx, candidateId);
  const tasks = store.tasks(ctx, candidateId);
  return {
    candidate: c, // full spine record: recruiter role sees internal fields
    flags,
    sessions,
    tasks,
    artifacts: artifacts.map(a => ({
      id: a.id, kind: a.kind, title: a.title, quarantine: a.quarantine,
      injectionAttempts: a.injectionAttempts, createdAt: a.createdAt,
      content: a.content, fields: a.fields,
    })),
  };
}

export function candidateSelfView(ctx: Ctx, store: Store, candidateId: string): CandidateRoleView | null {
  const c = store.candidate(ctx, candidateId);
  if (!c) return null;
  const tasks = store.tasks(ctx, candidateId).filter(t => !t.done);
  const sessions = sessionsForRole('candidate', store.sessions(ctx, candidateId)) as PublicSessionView[];
  const artifacts = store.artifacts(ctx, candidateId)
    .filter(a => a.kind !== 'recruiter_notes' && a.quarantine !== 'rejected')
    .map(a => ({
      id: a.id, kind: a.kind, title: a.title, createdAt: a.createdAt,
      content: a.content, fields: a.fields,
    }));
  return { ...candidatePublic(c), tasks, sessions, artifacts };
}

/* Safety net used by the API layer and the contract tests: recursively verify
   that a serialized object carries no internal-only keys. */
export function assertNoInternalFields(obj: unknown, path = '$'): void {
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => assertNoInternalFields(v, `${path}[${i}]`));
    return;
  }
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (INTERNAL_KEYS.has(k)) {
        throw new Error(`Projection violation: internal key ${k} at ${path}`);
      }
      assertNoInternalFields(v, `${path}.${k}`);
    }
  }
}

export function flagsForRole(role: Role, flags: Flag[]): Flag[] {
  return role === 'candidate' ? [] : flags;
}

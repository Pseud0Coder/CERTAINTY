/* Assessments (ADR-0024): technical, coding and psychometric, scored
   deterministically. Multiple-choice is exact; text and code are scored on
   rubric coverage, no model in the path, so a score never moves between
   identical runs. Scores are normalized across the cohort, and anomalies are
   flagged rather than silently accepted.

   AI-assisted scoring, when used, arrives through the same shape and is
   guarded like every model output; the deterministic scorer is the floor. */

import { randomUUID } from 'node:crypto';
import type { Store, Ctx } from './db.ts';
import type {
  AnomalyFlag, Assessment, AssessmentAttempt, AssessmentKind, AssessmentQuestion,
  AssessmentScore, QuestionScore,
} from './types.ts';
import { queueForEvent } from './communications.ts';

export class AssessmentError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}

export interface AssessmentInput {
  title: string;
  kind?: AssessmentKind;
  requisitionId?: string | null;
  questions?: Array<Partial<AssessmentQuestion> & { prompt: string }>;
  passScore?: number;
  durationMinutes?: number;
}

export function createAssessment(store: Store, ctx: Ctx, actor: { id: string; name: string; role: string }, input: AssessmentInput): Assessment {
  const title = String(input.title ?? '').trim();
  if (!title) throw new AssessmentError('title_required');
  const questions = (input.questions ?? []).map((q, i) => ({
    id: q.id ?? `q${i}`, prompt: String(q.prompt ?? ''), type: q.type ?? 'mcq',
    options: q.options ?? [], correct: q.correct ?? null,
    points: Math.max(1, Math.round(Number(q.points) || 1)),
    competency: String(q.competency ?? ''), rubric: q.rubric ?? [],
  })).filter(q => q.prompt);
  if (questions.length === 0) throw new AssessmentError('questions_required');
  const now = new Date().toISOString();
  const assessment: Assessment = {
    id: randomUUID(), tenantId: ctx.tenantId, requisitionId: input.requisitionId ?? null,
    title, kind: input.kind ?? 'technical', questions,
    passScore: Math.max(0, Math.min(100, Math.round(Number(input.passScore ?? 60)))),
    durationMinutes: Math.max(1, Math.round(Number(input.durationMinutes ?? 45))),
    createdBy: actor.id, createdAt: now, updatedAt: now,
  };
  store.insertAssessment(assessment);
  store.audit(ctx.tenantId, actor.name, actor.role, 'assessment_created', assessment.id);
  return assessment;
}

function requireAssessment(store: Store, ctx: Ctx, id: string): Assessment {
  const a = store.assessment(ctx, id);
  if (!a) throw new AssessmentError('not_found');
  return a;
}

/* Deterministic per-question scoring. Text and code score on rubric term
   coverage; a missing rubric means the answer scores only for non-empty
   content, and the basis says so. */
export function scoreAnswers(assessment: Assessment, answers: Record<string, string>): { raw: number; questions: QuestionScore[] } {
  const questions: QuestionScore[] = assessment.questions.map(q => {
    const answer = String(answers[q.id] ?? '').trim();
    if (q.type === 'mcq') {
      const correct = q.correct !== null && answer.toLowerCase() === String(q.correct).toLowerCase();
      return { questionId: q.id, points: correct ? q.points : 0, maxPoints: q.points, basis: correct ? 'Correct option.' : 'Incorrect or unanswered.' };
    }
    if (q.rubric.length > 0) {
      const text = answer.toLowerCase();
      const covered = q.rubric.filter(term => text.includes(term.toLowerCase()));
      const points = Math.round((covered.length / q.rubric.length) * q.points * 100) / 100;
      return { questionId: q.id, points, maxPoints: q.points, basis: `${covered.length} of ${q.rubric.length} rubric points covered.` };
    }
    return { questionId: q.id, points: answer ? q.points : 0, maxPoints: q.points, basis: answer ? 'Non-empty answer.' : 'Unanswered.' };
  });
  const max = questions.reduce((s, q) => s + q.maxPoints, 0);
  const earned = questions.reduce((s, q) => s + q.points, 0);
  return { raw: max > 0 ? Math.round((earned / max) * 100) : 0, questions };
}

/* Flags that something is off, without changing the score. */
export function detectAnomalies(assessment: Assessment, attempt: AssessmentAttempt, cohort: AssessmentAttempt[]): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];
  const answered = Object.values(attempt.answers).filter(a => String(a).trim()).length;
  if (attempt.durationMinutes !== null && attempt.durationMinutes < assessment.durationMinutes * 0.2) {
    flags.push({ type: 'fast_completion', detail: `${attempt.durationMinutes} minutes against an expected ${assessment.durationMinutes}.` });
  }
  if (attempt.durationMinutes !== null && attempt.durationMinutes > 0 && answered / attempt.durationMinutes > 30) {
    flags.push({ type: 'impossible_speed', detail: `${answered} answers in ${attempt.durationMinutes} minutes.` });
  }
  const mcq = assessment.questions.filter(q => q.type === 'mcq').map(q => attempt.answers[q.id] ?? '');
  if (mcq.length > 1 && mcq.every(a => a && a === mcq[0])) {
    flags.push({ type: 'straightlining', detail: 'Every multiple-choice answer is identical.' });
  }
  const sameCandidate = cohort.filter(a => a.candidateId === attempt.candidateId && a.id !== attempt.id && ['submitted', 'scored'].includes(a.status));
  if (sameCandidate.length > 0) {
    flags.push({ type: 'duplicate_attempt', detail: `${sameCandidate.length + 1} attempts by the same candidate.` });
  }
  const raws = cohort.filter(a => a.score).map(a => a.score!.raw);
  if (raws.length >= 3 && attempt.score) {
    const mean = raws.reduce((s, x) => s + x, 0) / raws.length;
    const sd = Math.sqrt(raws.reduce((s, x) => s + (x - mean) ** 2, 0) / raws.length);
    if (sd > 0 && Math.abs(attempt.score.raw - mean) > 2.5 * sd) {
      flags.push({ type: 'outlier', detail: `${attempt.score.raw} against a cohort mean of ${Math.round(mean)}.` });
    }
  }
  return flags;
}

/* Min-max normalization across the cohort. A single attempt, or a flat
   cohort, normalizes to 100 when it scored above zero. */
export function normalize(raws: number[]): number[] {
  const min = Math.min(...raws);
  const max = Math.max(...raws);
  if (max === min) return raws.map(r => (r > 0 ? 100 : 0));
  return raws.map(r => Math.round(((r - min) / (max - min)) * 100));
}

export function inviteAttempt(store: Store, ctx: Ctx, actor: { id: string; name: string; role: string }, assessmentId: string, candidateId: string, applicationId: string | null = null): AssessmentAttempt {
  const assessment = requireAssessment(store, ctx, assessmentId);
  if (!store.candidate(ctx, candidateId)) throw new AssessmentError('candidate_not_found');
  const now = new Date().toISOString();
  const attempt: AssessmentAttempt = {
    id: randomUUID(), tenantId: ctx.tenantId, assessmentId, candidateId, applicationId,
    status: 'invited', answers: {}, startedAt: null, submittedAt: null, durationMinutes: null,
    score: null, createdAt: now, updatedAt: now,
  };
  store.insertAttempt(attempt);
  store.audit(ctx.tenantId, actor.name, actor.role, 'assessment_invited', attempt.id);
  queueForEvent(store, ctx, { candidateId, applicationId, template: 'assessment_invite', vars: { note: assessment.title, link: `/assessments/${assessment.id}` } });
  return attempt;
}

export function startAttempt(store: Store, ctx: Ctx, attemptId: string): AssessmentAttempt {
  const attempt = store.attempt(ctx, attemptId);
  if (!attempt) throw new AssessmentError('not_found');
  if (attempt.status !== 'invited') throw new AssessmentError('not_invitable');
  attempt.status = 'in_progress';
  attempt.startedAt = new Date().toISOString();
  store.updateAttempt(ctx, attempt);
  return store.attempt(ctx, attemptId)!;
}

/* Submit and score in one step, then renormalize the whole cohort so every
   attempt's normalized score is consistent. */
export function submitAttempt(
  store: Store, ctx: Ctx, attemptId: string,
  answers: Record<string, string>, durationMinutes: number | null = null,
): AssessmentAttempt {
  const attempt = store.attempt(ctx, attemptId);
  if (!attempt) throw new AssessmentError('not_found');
  if (['submitted', 'scored'].includes(attempt.status)) throw new AssessmentError('already_submitted');
  const assessment = requireAssessment(store, ctx, attempt.assessmentId);
  attempt.answers = answers ?? {};
  attempt.durationMinutes = durationMinutes;
  attempt.submittedAt = new Date().toISOString();
  const { raw, questions } = scoreAnswers(assessment, attempt.answers);
  attempt.score = { raw, normalized: null, questions, flags: [], scoredAt: new Date().toISOString() };
  attempt.status = 'submitted';
  store.updateAttempt(ctx, attempt);
  store.audit(ctx.tenantId, 'agent:assessment', 'agent', 'assessment_submitted', attempt.id);
  return rescoreAssessment(store, ctx, assessment.id).attempts.find(a => a.id === attemptId)!;
}

export interface RescoreResult { attempts: AssessmentAttempt[] }

/* Recompute normalization and anomaly flags for every submitted attempt on
   an assessment. Deterministic and repeatable. */
export function rescoreAssessment(store: Store, ctx: Ctx, assessmentId: string): RescoreResult {
  const assessment = requireAssessment(store, ctx, assessmentId);
  const attempts = store.attempts(ctx, { assessmentId });
  const scored = attempts.filter(a => a.score && ['submitted', 'scored'].includes(a.status));
  const normalized = normalize(scored.map(a => a.score!.raw));
  scored.forEach((attempt, i) => { attempt.score!.normalized = normalized[i]!; });
  for (const attempt of scored) {
    attempt.score!.flags = detectAnomalies(assessment, attempt, scored);
    attempt.status = 'scored';
    store.updateAttempt(ctx, attempt);
  }
  return { attempts: store.attempts(ctx, { assessmentId }) };
}

/* Candidate view: their own attempt, no correct answers and no anomaly flags
   that are an internal judgement aid. */
export function candidateAttemptView(attempt: AssessmentAttempt): {
  id: string; assessmentId: string; status: AssessmentAttempt['status'];
  submittedAt: string | null; raw: number | null; normalized: number | null;
} {
  return {
    id: attempt.id, assessmentId: attempt.assessmentId, status: attempt.status,
    submittedAt: attempt.submittedAt, raw: attempt.score?.raw ?? null,
    normalized: attempt.score?.normalized ?? null,
  };
}

/* Live interview assistance and voice session completion (ADR-0024).
   Deterministic help for the human interviewer, never a replacement:
   - follow-up question suggestions drawn from what an answer lacks,
   - compliance-sensitive question detection (topics that must not be asked),
   - an interview scorecard from the same STAR evaluation the spine uses,
   - a completion summary and structured notes for a voice session.

   No model in this path: the same transcript always yields the same
   suggestions, so a recommendation can be trusted and reviewed. */

import type { Store, Ctx } from './db.ts';
import type { StarMetrics, TranscriptTurn } from './types.ts';
import { evaluateTranscript } from './agents.ts';

export interface FollowUp { question: string; reason: string; competency: string }
export interface ComplianceFlag { turnIndex: number; phrase: string; category: string; note: string }
export interface CompetencyCoverage { competency: string; evidenced: boolean }
export interface Scorecard {
  star: StarMetrics;
  ownership: number;
  trailing: number;
  coverage: CompetencyCoverage[];
  overall: number;   // 0 to 100
}

const RESULT_CUE = /(\d+\s?%|by\s+\d+|dropped|reduced|increased|cut|grew|saved)/i;
const SITUATION_CUE = /\b(the team|at the time|when i (joined|started)|we had|there was|deadline|client)\b/i;

/* Topics that must not drive a hiring decision. Detection is a prompt to a
   human, not an accusation. */
const COMPLIANCE: Array<{ re: RegExp; category: string }> = [
  { re: /\b(age|how old|date of birth|born in|birth year|year of birth)\b/i, category: 'Age' },
  { re: /\b(married|marital status|spouse|children|kids|pregnan\w*|family plans)\b/i, category: 'Family status' },
  { re: /\b(religio\w*|church|mosque|pray\w*|faith|ramadan practices)\b/i, category: 'Religion' },
  { re: /\b(nationa\w*lity|citizen\w*|ethnic\w*|race\b|tribe|caste)\b/i, category: 'National origin' },
  { re: /\b(disab\w*|health condition|medical history|illness|sick leave)\b/i, category: 'Health or disability' },
  { re: /\b(political|party affiliation|trade union)\b/i, category: 'Political affiliation' },
  { re: /\b(gender|sexual orientation|marital)\b/i, category: 'Gender or orientation' },
];

export function detectComplianceRisks(transcript: TranscriptTurn[]): ComplianceFlag[] {
  const flags: ComplianceFlag[] = [];
  transcript.forEach((turn, index) => {
    if (!turn.text.includes('?')) return;
    for (const { re, category } of COMPLIANCE) {
      const hit = re.exec(turn.text);
      if (hit) {
        flags.push({
          turnIndex: index, phrase: hit[0], category,
          note: `${category} is not a lawful basis for a hiring decision. Rephrase around the role requirements.`,
        });
      }
    }
  });
  return flags;
}

/* One follow-up per answer, targeting the weakest part: no result, no
   context, or an unqualified "we". */
export function recommendFollowUps(transcript: TranscriptTurn[], competencies: string[] = []): FollowUp[] {
  const follows: FollowUp[] = [];
  transcript.forEach(turn => {
    if (/^interviewer$/i.test(turn.who)) return;
    const text = turn.text.trim();
    if (!text) return;
    if (!RESULT_CUE.test(text) && !/%|\d/.test(text)) {
      follows.push({ question: 'What was the measurable outcome, in numbers if you have them?', reason: 'The answer states activity but no result.', competency: matchCompetency(text, competencies) });
    } else if (!SITUATION_CUE.test(text)) {
      follows.push({ question: 'What was the situation and constraint you were working inside?', reason: 'The answer jumps to action without context.', competency: matchCompetency(text, competencies) });
    } else if (text.split(/\bwe\b/gi).length - 1 > text.split(/\bI\b/g).length - 1) {
      follows.push({ question: 'Which parts did you personally own, and which were the team?', reason: 'The answer leans on "we" for decisions.', competency: matchCompetency(text, competencies) });
    }
  });
  return follows.slice(0, 12);
}

function matchCompetency(text: string, competencies: string[]): string {
  const lower = text.toLowerCase();
  return competencies.find(c => lower.includes(c.toLowerCase())) ?? '';
}

export function interviewScorecard(transcript: TranscriptTurn[], competencies: string[] = []): Scorecard {
  const { star, ownership, trailing } = evaluateTranscript(transcript);
  const candidateText = transcript.filter(t => !/^interviewer$/i.test(t.who)).map(t => t.text).join(' ').toLowerCase();
  const coverage = competencies.map(competency => ({ competency, evidenced: candidateText.includes(competency.toLowerCase()) }));
  const target: StarMetrics = { S: 15, T: 10, A: 50, R: 25 };
  const starFit = (
    Math.min(1, star.S / target.S) + Math.min(1, star.T / target.T)
    + Math.min(1, star.A / target.A) + Math.min(1, star.R / target.R)
  ) / 4;
  const coverageFit = coverage.length > 0 ? coverage.filter(c => c.evidenced).length / coverage.length : 1;
  const overall = Math.round((starFit * 0.6 + (ownership / 100) * 0.2 + coverageFit * 0.2) * 100);
  return { star, ownership, trailing, coverage, overall };
}

export interface LiveAssist { followUps: FollowUp[]; compliance: ComplianceFlag[]; scorecard: Scorecard }

export function liveAssist(transcript: TranscriptTurn[], competencies: string[] = []): LiveAssist {
  return {
    followUps: recommendFollowUps(transcript, competencies),
    compliance: detectComplianceRisks(transcript),
    scorecard: interviewScorecard(transcript, competencies),
  };
}

export interface CompletionNotes {
  summary: string;
  structured: { strengths: string[]; gaps: string[]; nextSteps: string[] };
  scorecard: Scorecard;
}

/* A deterministic completion summary and structured notes. No em dashes, no
   emoji (L8). */
export function completionNotes(transcript: TranscriptTurn[], competencies: string[] = []): CompletionNotes {
  const scorecard = interviewScorecard(transcript, competencies);
  const { star, ownership, trailing, coverage } = scorecard;
  const strengths: string[] = [];
  const gaps: string[] = [];
  const nextSteps: string[] = [];
  if (star.A >= 40 && star.R >= 20) strengths.push('Strong action and result detail.');
  if (ownership >= 60) strengths.push(`Clear ownership (${ownership} percent first person).`);
  if (star.S < 15) gaps.push('Thin situation and context.');
  if (star.R < 25) gaps.push('Results and outcomes under-specified.');
  if (trailing > 0) gaps.push(`${trailing} trailing answer endings.`);
  const uncovered = coverage.filter(c => !c.evidenced).map(c => c.competency);
  if (uncovered.length > 0) gaps.push(`No evidence for: ${uncovered.join(', ')}.`);
  nextSteps.push('Probe the gaps above in the next interview.');
  if (star.R < 25) nextSteps.push('Ask for a metric on each recent story.');
  if (trailing > 0) nextSteps.push('Practise ending answers on the result.');
  const summary = [
    `Interview scoring ${scorecard.overall} of 100.`,
    `STAR proportions S ${star.S}, T ${star.T}, A ${star.A}, R ${star.R} against targets 15, 10, 50, 25.`,
    `Ownership ${ownership} percent first person, ${trailing} trailing endings.`,
    coverage.length > 0 ? `${coverage.filter(c => c.evidenced).length} of ${coverage.length} competencies evidenced.` : 'No competency list supplied.',
  ].join(' ');
  return { summary, structured: { strengths, gaps, nextSteps }, scorecard };
}

/* Complete a voice session: evaluate the transcript, write the metrics and
   the completion summary, and mark it complete. Idempotent for an already
   completed session. */
export function completeVoiceSession(store: Store, ctx: Ctx, sessionId: string, competencies: string[] = []): { sessionId: string; notes: CompletionNotes } {
  const session = store.session(ctx, sessionId);
  if (!session) throw new Error('session_not_found');
  const { star, ownership, trailing } = evaluateTranscript(session.transcript);
  const notes = completionNotes(session.transcript, competencies);
  store.updateSession(ctx, sessionId, {
    status: 'complete', star, ownership, trailing,
    debrief: `${notes.summary}\n\nStrengths: ${notes.structured.strengths.join(' ') || 'none noted'}\nGaps: ${notes.structured.gaps.join(' ') || 'none noted'}\nNext steps: ${notes.structured.nextSteps.join(' ')}`,
  });
  store.audit(ctx.tenantId, 'agent:session', 'agent', 'voice_session_completed', sessionId);
  return { sessionId, notes };
}

/* The intelligence layer (ADR-0012).

   Where the model is allowed to act, and where it is not.

   Allowed: language and judgment. Reading a job description for meaning
   rather than for matching terms, phrasing a probe, writing a bullet from
   captured evidence, wording feedback, drafting a profile section.

   Not allowed: measurement, verification, assembly, gating. STAR metrics,
   ownership ratio, conflict detection, the CV assembler and every journey
   gate stay deterministic. Those are audited numbers and enforced rules;
   a number that moves between identical runs is not a measurement, and a
   gate a model can talk its way through is not a gate.

   Every producer here returns null rather than a guess. The caller then
   runs its scripted implementation, so an unconfigured, slow, throttled or
   malformed model degrades phrasing quality and nothing else (A0).

   Three guards apply to everything that comes back:
     1. normalizeModelOutput, so L8 typographic rules hold (A7).
     2. Shape validation, because a strict schema still permits empty
        strings, wrong counts and out-of-range values.
     3. Number grounding, because the one failure that matters here is an
        invented metric. Any digit sequence in model prose that does not
        appear in the supplied evidence rejects the whole output (L5). */

import type { LlmProvider, LlmResult, ModelTier } from './providers/llm.ts';
import { normalizeModelOutput } from './contracts.ts';
import type { ResearchFinding, StarMetrics } from './types.ts';
import {
  scriptedResearchFindings, resumeStudioTurn, screenerTurn, linkedinTurn,
  type ResearchEvidence, type ResumeFields, type SessionState,
} from './agents.ts';

/* ---------------------------------------------------------------------- */
/* guards                                                                  */

/* Digit runs the model is always allowed to use: they are structural, not
   claims about the candidate's results. */
const BENIGN_NUMBER = /^(19|20)\d{2}$|^[0-9]$/;

function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,.]*/g) ?? []).map(n => n.replace(/[,.]+$/, ''));
}

/* True when every non-benign number in `text` also appears in `evidence`.
   Comparison strips separators so "1,200" in prose matches "1200" in the
   evidence. This is the anti-invention guard: it cannot catch a fabricated
   qualitative claim, but a fabricated metric is the failure that would
   damage a candidate or a client, and it catches that. */
export function numbersAreGrounded(text: string, evidence: string): boolean {
  const haystack = evidence.replace(/[,\s]/g, '');
  return numbersIn(text).every(n => {
    if (BENIGN_NUMBER.test(n)) return true;
    return haystack.includes(n.replace(/[,\s]/g, ''));
  });
}

function isPlainText(s: unknown, min: number, max: number): s is string {
  return typeof s === 'string' && s.trim().length >= min && s.trim().length <= max;
}

/* Shared instruction tail. The typographic rules are also repaired
   mechanically by normalizeModelOutput; stating them still measurably
   reduces how often the repair is needed. */
const HOUSE_STYLE =
  'Style: sentence case, plain English, no emoji, no em dashes, no en dashes, ' +
  'straight quotes only. Never invent, infer or embellish. Use only the evidence ' +
  'supplied in the user message. If something is not in the evidence, omit it. ' +
  'Never state a number that does not appear in the evidence.';

interface AskOptions {
  llm: LlmProvider;
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  tier: ModelTier;
  seed?: number;
}

/* One model call plus normalization. Shape and grounding checks belong to
   each caller, which knows what valid means for its own output.

   The provider interface promises never to throw, and the OpenRouter
   implementation keeps that promise. This still catches, because a
   provider is a pluggable adapter (ADR-0005): a third-party or future
   implementation that breaks the promise must degrade intelligence, not
   fail a candidate's flow step. */
async function ask<T>(o: AskOptions): Promise<T | null> {
  let res: LlmResult<T> | null;
  try {
    res = await o.llm.complete<T>({
      system: `${o.system}\n${HOUSE_STYLE}`,
      user: o.user,
      schema: o.schema,
      schemaName: o.schemaName,
      tier: o.tier,
      seed: o.seed,
    });
  } catch {
    return null;
  }
  if (!res) return null;
  try {
    return normalizeModelOutput(res.value);
  } catch {
    /* A cyclic or exotic value from a misbehaving adapter. */
    return null;
  }
}

/* Interactive turns report which producer served them, so the flow trace
   can name the model or show a fallback (ADR-0012). */
export type Served<T> = T & { producer: 'model' | 'scripted' };

/* ---------------------------------------------------------------------- */
/* research findings                                                       */

const RESEARCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      minItems: 3,
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'title', 'detail'],
        properties: {
          kind: { type: 'string', enum: ['good', 'improve', 'needs_work'] },
          title: { type: 'string' },
          detail: { type: 'string' },
        },
      },
    },
  },
} as const;

function researchInput(ev: ResearchEvidence): string {
  const r = ev.resume;
  return JSON.stringify({
    target_role: ev.targetRole,
    target_company: ev.targetCompany,
    job_description_must_haves: ev.musts,
    cv_positioning: r.positioning,
    cv_roles: (r.roles ?? []).map(role => ({
      company: role.company, title: role.title,
      start: role.start, end: role.end, bullets: role.bullets,
    })),
    cv_skills: (r.skills ?? []).map(g => ({ group: g.group, items: g.items })),
    cv_tools: r.tools ?? [],
  }, null, 1);
}

/* Reads each must-have against the CV for meaning. The scripted producer
   can only ask whether a term appears; this can tell "led a migration" from
   "attended migration planning", which is the whole point of the band. */
export async function modelResearchFindings(
  llm: LlmProvider, ev: ResearchEvidence,
): Promise<ResearchFinding[] | null> {
  const out = await ask<{ findings: ResearchFinding[] }>({
    llm,
    tier: 'strong',
    schemaName: 'research_report',
    schema: RESEARCH_SCHEMA,
    system:
      'You are a recruitment research analyst. Assess the candidate CV evidence against ' +
      'the target role and each job description must-have.\n' +
      'Band every finding: "good" means fully evidenced in the CV, "improve" means partially ' +
      'evidenced or lacking a measurable outcome, "needs_work" means not evidenced at all.\n' +
      'Cover every must-have. Judge evidence by meaning, not by keyword overlap: exposure to ' +
      'an area is not ownership of it. Each title is a short label. Each detail is one or two ' +
      'sentences addressed to the candidate as "you", naming the CV evidence it relies on, or ' +
      'naming precisely what is absent.',
    user: researchInput(ev),
  });
  if (!out || !Array.isArray(out.findings) || out.findings.length === 0) return null;

  const valid = out.findings.filter(f =>
    (f.kind === 'good' || f.kind === 'improve' || f.kind === 'needs_work') &&
    isPlainText(f.title, 3, 120) && isPlainText(f.detail, 10, 600));
  if (valid.length < 3) return null;

  /* Findings quote the CV back at the candidate, so every number in them
     must come from the CV. */
  const evidenceText = researchInput(ev);
  if (!valid.every(f => numbersAreGrounded(`${f.title} ${f.detail}`, evidenceText))) return null;

  return valid;
}

/* The research producer used by the flow engine: model first, scripted
   fallback, one shared write path. */
export async function researchFindings(
  llm: LlmProvider, ev: ResearchEvidence,
): Promise<{ findings: ResearchFinding[]; producer: 'model' | 'scripted' }> {
  const model = await modelResearchFindings(llm, ev);
  if (model) return { findings: model, producer: 'model' };
  return { findings: scriptedResearchFindings(ev), producer: 'scripted' };
}

/* ---------------------------------------------------------------------- */
/* resume studio                                                           */

const RESUME_TURN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply'],
  properties: { reply: { type: 'string' } },
} as const;

const RESUME_BULLET_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['bullet', 'reply'],
  properties: { bullet: { type: 'string' }, reply: { type: 'string' } },
} as const;

/* The state machine in agents.ts owns sequencing, era depth targets and the
   completion declaration. This wrapper replaces only the wording of the
   reply and the text of a finished bullet. State transitions are byte for
   byte the scripted ones, so every gate and validation behaves identically
   whether or not a provider is configured. */
export async function intelligentResumeTurn(
  llm: LlmProvider,
  state: SessionState,
  spine: { roles: ResumeFields['roles'] },
  text: string,
  roleKey: string | undefined,
): Promise<Served<ReturnType<typeof resumeStudioTurn>>> {
  const base = resumeStudioTurn(state, spine, text, roleKey);
  const areas = base.state.areas;
  const last = areas[areas.length - 1];
  const justCompleted = last && last.owned && last.action && last.outcome && base.state.probeIndex === 0;

  /* A bullet has just closed: rewrite it from the captured evidence. The
     scripted version concatenates fragments, which reads like a template. */
  if (justCompleted && !base.declareComplete) {
    const evidence = JSON.stringify({
      role: base.state.role, owned: last.owned, action: last.action, outcome: last.outcome,
    }, null, 1);
    const out = await ask<{ bullet: string; reply: string }>({
      llm,
      tier: 'cheap',
      schemaName: 'resume_bullet',
      schema: RESUME_BULLET_SCHEMA,
      system:
        'You write one resume bullet from a candidate\'s own spoken evidence about one piece ' +
        'of work, then acknowledge it in one short line.\n' +
        'The bullet opens with a bold lead phrase of 5 to 10 words naming the contribution, ' +
        'written as "**lead phrase**", then a colon, then one tight sentence carrying context, ' +
        'action and outcome. Keep the candidate\'s own scope and numbers exactly as given. ' +
        'If no number was given, state the outcome qualitatively and do not invent one.\n' +
        'The reply is one sentence confirming the bullet is captured. Do not read the bullet aloud in the reply.',
      user: evidence,
    });
    if (out && isPlainText(out.bullet, 40, 400) && isPlainText(out.reply, 5, 300) &&
        numbersAreGrounded(out.bullet, evidence) && numbersAreGrounded(out.reply, evidence)) {
      last.bullet = out.bullet.trim();
      const need = (base.state.target ?? 2) - areas.length;
      return {
        ...base,
        producer: 'model',
        reply: need > 0
          ? `${out.reply.trim()} ${need} to go. Next area?`
          : `${out.reply.trim()} That covers the depth target for this role. Anything more, or are we done?`,
      };
    }
    return { ...base, producer: 'scripted' };
  }

  /* A probe question: keep the scripted intent, improve the wording so the
     candidate is not asked the same three sentences every time. */
  if (base.state.phase === 'probe' && !base.declareComplete) {
    const out = await ask<{ reply: string }>({
      llm,
      tier: 'cheap',
      schemaName: 'resume_probe',
      schema: RESUME_TURN_SCHEMA,
      system:
        'You are a forensic career interviewer extracting resume evidence one role at a time. ' +
        'Ask exactly one question, under 30 words, in a conversational spoken register.\n' +
        'You are given the question the script intends to ask next and what has been captured ' +
        'so far. Ask for the same missing element, worded naturally and specific to what the ' +
        'candidate just said. Never accept job description language. Do not summarize. Do not ' +
        'praise at length. One question only.',
      user: JSON.stringify({
        role: base.state.role,
        intended_question: base.reply,
        candidate_just_said: text,
        captured_so_far: last ? { owned: last.owned, action: last.action, outcome: last.outcome } : null,
      }, null, 1),
    });
    if (out && isPlainText(out.reply, 10, 300) &&
        numbersAreGrounded(out.reply, `${text} ${JSON.stringify(last ?? {})}`)) {
      return { ...base, producer: 'model', reply: out.reply.trim() };
    }
  }
  return { ...base, producer: 'scripted' };
}

/* ---------------------------------------------------------------------- */
/* interview screener                                                      */

const SCREENER_QUESTIONS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: { type: 'array', minItems: 8, maxItems: 12, items: { type: 'string' } },
  },
} as const;

const SCREENER_FEEDBACK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['strength', 'gap', 'one_change'],
  properties: {
    strength: { type: 'string' },
    gap: { type: 'string' },
    one_change: { type: 'string' },
  },
} as const;

/* Questions drawn from this candidate's job description and CV, replacing
   the fixed list. Generated once per session and cached in run state, so a
   session costs one extra call rather than one per turn. */
export async function modelScreenerQuestions(
  llm: LlmProvider, jdMustHave: string[], resume: ResumeFields, targetRole: string,
): Promise<string[] | null> {
  const evidence = JSON.stringify({
    target_role: targetRole,
    job_description_must_haves: jdMustHave,
    cv_roles: (resume.roles ?? []).map(r => ({ company: r.company, title: r.title, bullets: r.bullets })),
    cv_skills: (resume.skills ?? []).flatMap(g => g.items),
  }, null, 1);
  const out = await ask<{ questions: string[] }>({
    llm,
    tier: 'strong',
    schemaName: 'screener_questions',
    schema: SCREENER_QUESTIONS_SCHEMA,
    system:
      'You are a sharp screening interviewer, harder than the real interview. Produce 8 to 12 ' +
      'competency questions for this candidate.\n' +
      'Draw them from the job description must-haves and the CV evidence. Include behavioral ' +
      'questions, one motivational question, one real weakness question, and one closing ' +
      'question that hands the floor to the candidate. Probe the must-haves the CV evidences ' +
      'least convincingly. Each question is one spoken sentence a candidate can answer aloud. ' +
      'Do not number them. Do not include preamble.',
    user: evidence,
  });
  if (!out || !Array.isArray(out.questions)) return null;
  const valid = out.questions.filter(q => isPlainText(q, 15, 300) && numbersAreGrounded(q, evidence));
  return valid.length >= 8 ? valid.slice(0, 12) : null;
}

/* Per-answer feedback: one strength, the named gap, the one change that
   matters. The thin/strong judgment itself stays with the deterministic
   STAR evaluator; only the wording comes from the model. */
export async function modelScreenerFeedback(
  llm: LlmProvider, question: string, answer: string, star: StarMetrics, thin: boolean,
): Promise<string | null> {
  const out = await ask<{ strength: string; gap: string; one_change: string }>({
    llm,
    tier: 'cheap',
    schemaName: 'screener_feedback',
    schema: SCREENER_FEEDBACK_SCHEMA,
    system:
      'You give an interview coach\'s feedback on one answer, after the answer, never during.\n' +
      'Return exactly three things: the one real strength, the named gap, and the single change ' +
      'that would most improve the answer. One sentence each, addressed to the candidate as ' +
      '"you". Be direct and specific to what was said. No praise padding.\n' +
      'The measured STAR breakdown is supplied; treat it as ground truth and do not restate ' +
      'the percentages.',
    user: JSON.stringify({
      question, answer, measured_star: star,
      verdict: thin ? 'result is thin' : 'result lands',
    }, null, 1),
  });
  if (!out) return null;
  if (!isPlainText(out.strength, 10, 300) || !isPlainText(out.gap, 10, 300) ||
      !isPlainText(out.one_change, 10, 300)) return null;
  const joined = `${out.strength.trim()} ${out.gap.trim()} ${out.one_change.trim()}`;
  if (!numbersAreGrounded(joined, `${question} ${answer}`)) return null;
  return joined;
}

/* Screener turn. Sequencing, follow-up budget, STAR measurement and the
   debrief declaration remain scripted; questions and feedback wording come
   from the model when one is configured. */
export async function intelligentScreenerTurn(
  llm: LlmProvider,
  state: SessionState,
  jdMustHave: string[],
  text: string,
  isAnswer: boolean,
  context: { resume: ResumeFields; targetRole: string },
): Promise<Served<ReturnType<typeof screenerTurn>>> {
  /* Generate the question set on the opening turn only. */
  let served: 'model' | 'scripted' = 'scripted';
  if (!state.questions) {
    const questions = await modelScreenerQuestions(llm, jdMustHave, context.resume, context.targetRole);
    if (questions) { state = { ...state, questions }; served = 'model'; }
  }
  const base = screenerTurn(state, jdMustHave, text, isAnswer);
  if (!isAnswer || base.declareComplete) return { ...base, producer: served };

  const answers = base.state.answers ?? [];
  const justAnswered = answers[answers.length - 1];
  if (!justAnswered) return { ...base, producer: served };

  const thin = base.reply.includes('the result is thin');
  const feedback = await modelScreenerFeedback(
    llm, justAnswered.q, justAnswered.a, justAnswered.star, thin);
  if (!feedback) return { ...base, producer: served };

  justAnswered.feedback = feedback;
  /* Preserve the scripted turn's shape: feedback, then the next question if
     the script moved on to one. */
  const nextQ = base.state.questions?.[base.state.questionIndex ?? 0];
  const movedOn = !base.reply.startsWith(justAnswered.feedback) && base.reply.includes('Next:');
  return {
    ...base,
    producer: 'model',
    reply: movedOn && nextQ ? `${feedback} Next: ${nextQ}` : feedback,
  };
}

/* ---------------------------------------------------------------------- */
/* linkedin studio                                                         */

const LINKEDIN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['section'],
  properties: { section: { type: 'string' } },
} as const;

const SECTION_BRIEF: Record<string, string> = {
  banner: 'Three banner text options, each under 10 words, numbered 1 to 3.',
  headline: 'One headline of at most 220 characters in four parts separated by " | ".',
  about: 'An About section in the first person, five paragraphs, 800 to 1200 characters total.',
  experience: 'An Experience section: each role with its exact title, company and dates, then the 4 to 5 strongest bullets.',
  keywords: 'A checklist of 10 to 15 keywords, each with one or two variations, one per line.',
  skills: 'A list of 20 to 30 skills, pipe separated, every one backed by a resume bullet.',
};

/* LinkedIn sections written from the completed resume. Section ordering,
   the one-at-a-time rule and the six-section completion declaration stay
   scripted; only the section body is generated. */
export async function intelligentLinkedinTurn(
  llm: LlmProvider, state: SessionState, resume: ResumeFields, text: string,
): Promise<Served<ReturnType<typeof linkedinTurn>>> {
  const before = new Set(state.sectionsLeft ?? ['banner', 'headline', 'about', 'experience', 'keywords', 'skills']);
  const base = linkedinTurn(state, resume, text);
  const after = new Set(base.state.sectionsLeft ?? []);
  const delivered = [...before].find(s => !after.has(s));
  if (!delivered || !SECTION_BRIEF[delivered]) return { ...base, producer: 'scripted' };

  const evidence = JSON.stringify({
    positioning: resume.positioning,
    roles: (resume.roles ?? []).map(r => ({
      company: r.company, title: r.title, start: r.start, end: r.end, bullets: r.bullets,
    })),
    skills: (resume.skills ?? []).flatMap(g => g.items),
    tools: resume.tools ?? [],
  }, null, 1);

  const out = await ask<{ section: string }>({
    llm,
    tier: 'cheap',
    schemaName: 'linkedin_section',
    schema: LINKEDIN_SCHEMA,
    system:
      'You write one LinkedIn profile section from a completed resume, which is the single ' +
      'source of truth. Titles, companies and dates match the resume exactly. Every claim ' +
      'traces to a resume bullet or is omitted.\n' +
      `Write only this section: ${SECTION_BRIEF[delivered]}\n` +
      'No emoji, no hashtags. Output the section body only, with no heading and no commentary.',
    user: evidence,
  });
  if (!out || !isPlainText(out.section, 30, 4000) || !numbersAreGrounded(out.section, evidence)) {
    return { ...base, producer: 'scripted' };
  }

  const body = `${delivered.charAt(0).toUpperCase()}${delivered.slice(1)} section:\n${out.section.trim()}`;
  const left = base.state.sectionsLeft ?? [];
  return {
    ...base,
    producer: 'model',
    reply: left.length === 0
      ? `${body}\n\nThat is all six sections. Save your work as you go.`
      : `${body}\n\nWhat would you like to work on next? Still available: ${left.join(', ')}.`,
  };
}

/* ---------------------------------------------------------------------- */
/* submission builder                                                     */

const SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary'],
  properties: {
    summary: { type: 'array', minItems: 5, maxItems: 5, items: { type: 'string' } },
  },
} as const;

/* The client-facing executive summary. Exactly five bullets, because the
   deterministic QA checklist asserts five and the document schema requires
   the five-part framework. Returns null unless the model delivers five
   grounded bullets, so the QA check can never be softened by a fallback. */
export async function modelExecutiveSummary(
  llm: LlmProvider,
  input: { name: string; targetRole: string; resume: ResumeFields; confirmedMetric: string | null },
): Promise<string[] | null> {
  const r = input.resume;
  const evidence = JSON.stringify({
    target_role: input.targetRole,
    positioning: r.positioning,
    roles: (r.roles ?? []).map(x => ({
      company: x.company, title: x.title, start: x.start, end: x.end, bullets: x.bullets,
    })),
    skills: (r.skills ?? []).map(g => ({ group: g.group, items: g.items })),
    verified_evidence: input.confirmedMetric,
  }, null, 1);

  const out = await ask<{ summary: string[] }>({
    llm,
    tier: 'strong',
    schemaName: 'executive_summary',
    schema: SUMMARY_SCHEMA,
    system:
      'You write the executive summary of a client-facing candidate submission for a ' +
      'recruitment agency. You work for the recruiter, not the candidate.\n' +
      'Exactly five bullets, in this order: what the candidate is and their scope; the ' +
      'credibility the evidence demonstrates; the problems they are trusted with; their ' +
      'operating style as the bullets evidence it; how they perform under pressure.\n' +
      'One sentence per bullet. Never manufacture a metric, never adjust a title to fit, ' +
      'never blend individual contributor and leadership tenure, never pad skills. Omit ' +
      'anything the evidence does not support. Output the bullet text only, without leading ' +
      'dashes or numbering. Never mention compensation, notice period or reasons for leaving.',
    user: evidence,
  });
  if (!out || !Array.isArray(out.summary) || out.summary.length !== 5) return null;
  if (!out.summary.every(s => isPlainText(s, 20, 400))) return null;
  if (!numbersAreGrounded(out.summary.join(' '), evidence)) return null;
  return out.summary.map(s => s.trim().replace(/^[-*\d.\s]+/, ''));
}

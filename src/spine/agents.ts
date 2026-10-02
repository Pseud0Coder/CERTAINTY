/* Deterministic agent implementations (the scripted provider, ADR-0005).
   Every agent produces state only (A0): structured output through the tool
   layer. No agent renders UI. Behavioral contracts come from
   reference-flows.md. A configured LLM provider would implement the same
   interfaces; without keys everything fails closed. */
import type { TranscriptTurn, StarMetrics, Artifact, ResearchFinding } from './types.ts';
import type { ToolContext } from './flows/tools.ts';

export interface ResumeFields {
  positioning: string; location: string; phone: string; email: string;
  roles: RoleField[]; skills: Array<{ group: string; items: string[] }>;
  tools: string[]; education: string[];
}
export interface RoleField {
  company: string; title: string; start: string; end: string;
  singleRole?: boolean; bullets: string[]; progressedFrom?: string;
}

/* Conflict detector: fires on linkedin_snapshot ingest or spine field change.
   Writes source_conflict flags with both versions stated. */
export function agentConflictDetector(t: ToolContext): unknown {
  const spine = t.call('read_spine', {}) as { candidate: { cvTenureEnd: string | null; name: string } };
  const snaps = (t.call('read_spine', {}) as { artifacts: Array<Artifact & { kind: string }> })
    .artifacts.filter(a => a.kind === 'linkedin_snapshot' && a.quarantine !== 'rejected');
  const suggestions: string[] = [];
  for (const snap of snaps) {
    const dates = (snap.fields as { dates?: string[] }).dates ?? [];
    const end = spine.candidate.cvTenureEnd;
    const conflicting = dates.filter(d => end && d !== end);
    if (conflicting.length > 0 && end) {
      t.call('write_flag', {
        type: 'source_conflict',
        title: 'Source conflict on end date',
        body: `LinkedIn snapshot end ${conflicting[0]} against CV ${end}. The conservative version (${end}) is used in outputs until the candidate confirms.`,
        quote: `snapshot: ${conflicting[0]}, cv: ${end}`,
      });
      suggestions.push(`conflict:${conflicting[0]}vs${end}`);
    }
  }
  return { conflicts: suggestions.length };
}

/* Stage advisor: fires on verified session completion. Suggests only. */
export function agentStageAdvisor(t: ToolContext): unknown {
  const spine = t.call('read_spine', {}) as {
    candidate: { stage: string };
    sessions: Array<{ status: string; star: StarMetrics | null }>;
  };
  const complete = spine.sessions.filter(s => s.status === 'complete' && s.star);
  if (complete.length === 0) return { suggestion: null };
  if (spine.candidate.stage === 'Screening') {
    return t.call('suggest_stage', {
      stage: 'Submission draft',
      rationale: 'A verified session with STAR metrics is complete.',
    });
  }
  return { suggestion: null };
}

/* Session evaluator: fires on session end. Writes STAR metrics, ownership
   ratio, trailing counts, transcript annotations, proposed flags. */
const RESULT_CUE = /(\d+\s?%|by\s+\d+|dropped|reduced|increased|cut|hit the date|exceed)/i;
const ACTION_CUE = /\b(I|I'd|I've)\s+(built|ran|ran|owned|led|implemented|designed|optimized|coordinated|re-?priorit[iy]zed|cut|exposed|migrated|automated)/i;
const TASK_CUE = /\b(responsible|accountable|my mandate|was asked|assigned)\b/i;
const SITUATION_CUE = /\b(the team|at the time|when i (joined|started)|we had|there was|deadline|client)\b/i;
const TRAILING = /(so,?\s+yeah|something like that|basically it|that was basically it)\s*\.?\s*$/i;

export function evaluateTranscript(transcript: TranscriptTurn[]): {
  star: StarMetrics; ownership: number; trailing: number;
  annotations: Array<{ index: number; mark: string; label: string }>;
} {
  const candidateTurns = transcript.filter(t => t.who !== 'Interviewer' && t.who !== 'Interviewer');
  let sit = 0, task = 0, act = 0, res = 0, total = 0;
  let iCount = 0, weCount = 0, trailing = 0;
  const annotations: Array<{ index: number; mark: string; label: string }> = [];
  transcript.forEach((turn, index) => {
    if (turn.who === 'Interviewer' || turn.who === 'Interviewer') return;
    const text = turn.text;
    if (TRAILING.test(text.trim())) {
      trailing++;
      annotations.push({ index, mark: 'gap', label: 'Trailing end noted' });
    }
    for (const m of text.matchAll(/\bI\b/gi)) iCount++;
    for (const m of text.matchAll(/\bwe\b/gi)) weCount++;
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      /* Clause-level classification: a clause with a numeric outcome counts
         as Result, the rest of the sentence keeps its own class. */
      const clauses = sentence.split(/,\s*/).filter(c => c.trim());
      for (const clause of clauses) {
        const words = clause.split(/\s+/).filter(Boolean).length;
        total += words;
        if (RESULT_CUE.test(clause)) res += words;
        else if (ACTION_CUE.test(clause)) act += words;
        else if (TASK_CUE.test(clause)) task += words;
        else if (SITUATION_CUE.test(clause)) sit += words;
        else act += words; // unmarked narrative reads as action account
      }
    }
    if (/%|\bby\s+\d+\b/i.test(text)) {
      annotations.push({ index, mark: 'confirmed', label: 'Metric stated, confirmed back' });
    }
    if (/never owned|i have not|honestly/i.test(text)) {
      annotations.push({ index, mark: 'gap', label: 'JD gap logged' });
    }
    if (/ran the workstream|coordinated|project ownership/i.test(text)) {
      annotations.push({ index, mark: 'claimed', label: 'Claim logged, check the CV' });
    }
  });
  const pct = (n: number) => total ? Math.round((n / total) * 100) : 0;
  const star: StarMetrics = { S: pct(sit), T: pct(task), A: pct(act), R: pct(res) };
  const ownership = iCount + weCount > 0 ? Math.round((iCount / (iCount + weCount)) * 100) : 100;
  return { star, ownership, trailing, annotations };
}

/* Session evaluator agent: fires on session end. Writes STAR metrics,
   ownership ratio, trailing counts, transcript annotations, proposed flags. */
export function agentSessionEvaluator(t: ToolContext, explicitSessionId?: string): unknown {
  const spine = t.call('read_spine', {}) as {
    sessions: Array<{ id: string; status: string; transcript: TranscriptTurn[] }>;
    artifacts: Array<{ kind: string }>;
  };
  const sid = explicitSessionId
    ?? ((t.run.stepStates as Record<string, string | undefined>)['_session'] ?? null);
  const session = (sid ? spine.sessions.find(s => s.id === sid) : undefined)
    ?? spine.sessions.find(s => s.status === 'complete' && s.transcript.length > 0)
    ?? spine.sessions[spine.sessions.length - 1];
  if (!session) throw new Error('no session to evaluate');
  const ev = evaluateTranscript(session.transcript);
  t.call('write_metrics', {
    sessionId: session.id, star: ev.star, ownership: ev.ownership, trailing: ev.trailing,
  });
  t.call('annotate_transcript', { sessionId: session.id, annotations: ev.annotations });
  if (ev.annotations.some(a => a.mark === 'gap')) {
    t.call('write_flag', {
      type: 'jd_gap', status: 'open',
      title: 'JD must-have not evidenced',
      body: 'A job description must-have was not evidenced in the session. The candidate said directly that they have not run it.',
      quote: 'candidate statement in the verified transcript',
    });
  }
  if (ev.annotations.some(a => a.mark === 'claimed')) {
    t.call('write_flag', {
      type: 'claim_missing_from_cv', status: 'open',
      title: 'Claim not on CV',
      body: 'The candidate described owning work that has no matching line on the CV. Verify and feed to the resume if earned.',
      quote: 'candidate statement in the verified transcript',
    });
  }
  return { star: ev.star, ownership: ev.ownership, trailing: ev.trailing, flagsProposed: 0 };
}

/* Ingestion analyzer (resume): extracts structured fields from sanitized
   text. Runs inside the quarantine pipeline (L1); the model never sees the
   raw document. */
export function parseResume(text: string): ResumeFields {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const sectionIndex = (name: string) => lines.findIndex(l => l.toUpperCase() === name);
  const positioning = lines[1] ?? '';
  const contact = (lines[2] ?? '').split('|').map(s => s.trim());
  const skills: Array<{ group: string; items: string[] }> = [];
  const tools: string[] = [];
  const education: string[] = [];
  const roles: RoleField[] = [];
  const skillStart = sectionIndex('SKILLS');
  const toolsStart = sectionIndex('TOOLS');
  const eduStart = sectionIndex('EDUCATION');
  const expStart = sectionIndex('EXPERIENCE');
  if (skillStart >= 0) {
    const end = toolsStart > skillStart ? toolsStart : (eduStart > skillStart ? eduStart : expStart > skillStart ? expStart : lines.length);
    for (const line of lines.slice(skillStart + 1, end)) {
      const idx = line.indexOf(':');
      if (idx > 0) {
        const group = line.slice(0, idx).trim();
        const rest = line.slice(idx + 1);
        if (rest) skills.push({ group, items: rest.split('|').map(s => s.trim()).filter(Boolean) });
      }
    }
  }
  if (toolsStart >= 0) {
    const end = eduStart > toolsStart ? eduStart : (expStart > toolsStart ? expStart : lines.length);
    for (const line of lines.slice(toolsStart + 1, end)) {
      tools.push(...line.split(',').map(s => s.trim()).filter(Boolean));
    }
  }
  if (eduStart >= 0) {
    const end = expStart > eduStart ? expStart : lines.length;
    for (const line of lines.slice(eduStart + 1, end)) education.push(line);
  }
  if (expStart >= 0) {
    let current: RoleField | null = null;
    for (const line of lines.slice(expStart + 1)) {
      const bullet = line.startsWith('- ');
      if (!bullet) {
        const parts = line.split('|').map(s => s.trim());
        const dates = parts[2] ?? '';
        const m = /^(\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{4})$/.exec(dates);
        if (parts.length >= 3 && m) {
          current = {
            company: parts[0]!, title: parts[1]!, start: m[1]!, end: m[2]!,
            singleRole: (parts[3] ?? '').includes('single'), bullets: [],
          };
          roles.push(current);
          continue;
        }
      }
      if (current && bullet) current.bullets.push(line.slice(2).trim());
    }
  }
  return {
    positioning, location: contact[0] ?? '', phone: contact[1] ?? '', email: contact[2] ?? '',
    roles, skills, tools, education,
  };
}

/* Real CVs do not follow the seeded template above. This reads the common
   shapes instead: section headings in any case ("Work Experience:",
   "PROFESSIONAL EXPERIENCE", "Skills"), dates as 07/2019, Jul 2019, July
   2019 or 2019, ranges with hyphens, en dashes or "to", an open end
   ("Present"), the role and company on one line or split over two, bullet
   glyphs, and bullets wrapped onto a second line. Deterministic and
   offline; anything it cannot place is left out rather than invented. */
const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12',
};
const DATE_TOKEN = String.raw`(?:(?:0?[1-9]|1[0-2])\/\d{4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+\d{4}|\d{4})`;
const RANGE = new RegExp(String.raw`(${DATE_TOKEN})\s*(?:-|\u2013|\u2014|to)\s*(${DATE_TOKEN}|present|current|now|today)`, 'i');
const SECTION_RE: Array<[keyof typeof SECTION_NAMES, RegExp]> = [
  ['experience', /^(work |professional |employment |relevant |career )?(experience|history|employment)( history)?:?$/i],
  ['skills', /^((key|core|technical|professional) )?skills( (&|and) (tools|technologies))?:?$/i],
  ['tools', /^(tools|technologies|tech stack)( (&|and) (tools|technologies))?:?$/i],
  ['education', /^(education|qualifications|education (&|and) (training|qualifications))( history)?:?$/i],
  ['summary', /^(summary|profile|about( me)?|professional summary|objective):?$/i],
  ['other', /^(certifications?|projects|awards|languages|interests|publications|volunteering|references):?$/i],
];
const SECTION_NAMES = { experience: 1, skills: 1, tools: 1, education: 1, summary: 1, other: 1 } as const;
const TITLE_WORDS = /\b(engineer|developer|manager|lead|director|analyst|designer|consultant|specialist|scientist|intern|head|officer|architect|associate|administrator|coordinator|executive|programmer|tester|founder|president|vp|principal|owner|assistant|advisor|researcher|technician|editor|writer|accountant|recruiter)\b/i;
const BULLET_RE = /^\s*(?:[-*•▪●◦‣⁃–]|\d+[.)])\s+/;

function normDate(token: string): string {
  const t = token.trim().toLowerCase();
  if (/^(present|current|now|today)$/.test(t)) return 'Present';
  const mm = /^(\d{1,2})\/(\d{4})$/.exec(t);
  if (mm) return `${mm[1]!.padStart(2, '0')}/${mm[2]}`;
  const mon = /^([a-z]+)\.?\s+(\d{4})$/.exec(t);
  if (mon) return `${MONTHS[mon[1]!.slice(0, 4)] ?? MONTHS[mon[1]!.slice(0, 3)] ?? '01'}/${mon[2]}`;
  return t;
}

function splitTitleCompany(text: string): { title: string; company: string } {
  const cleaned = text.replace(/[\s,|\u2013\u2014-]+$/, '').replace(/^[\s,|\u2013\u2014-]+/, '').trim();
  const parts = cleaned.split(/\s+\|\s+|\s+(?:at|@)\s+|\s+[\u2013\u2014-]\s+|,\s+/).map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return { title: TITLE_WORDS.test(cleaned) ? cleaned : '', company: TITLE_WORDS.test(cleaned) ? '' : cleaned };
  const titleIdx = parts.findIndex(p => TITLE_WORDS.test(p));
  if (titleIdx < 0) return { title: parts[0]!, company: parts.slice(1).join(', ') };
  const title = parts[titleIdx]!;
  const company = parts.filter((_, i) => i !== titleIdx).join(', ');
  return { title, company };
}

export function parseResumeLoose(text: string): ResumeFields {
  const lines = text.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const sectionOf = (line: string): keyof typeof SECTION_NAMES | null =>
    line.length <= 48 ? (SECTION_RE.find(([, re]) => re.test(line))?.[0] ?? null) : null;

  const firstSection = lines.findIndex(l => sectionOf(l));
  const head = lines.slice(0, firstSection < 0 ? Math.min(lines.length, 6) : firstSection);
  const email = head.join(' ').match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] ?? '';
  const phone = head.join(' ').match(/\+?\d[\d\s().-]{7,}\d/)?.[0]?.trim() ?? '';
  /* Contact lines carry an email, a phone or a "|" run; the positioning
     line is the first other line after the name. */
  const isContact = (l: string) => /@|\+?\d[\d\s().-]{7,}\d|\|/.test(l) || /linkedin\.com|github\.com|https?:\/\//i.test(l);
  const positioning = head.slice(1).find(l => !isContact(l)) ?? '';
  const contactLine = head.find(l => l.includes('|')) ?? '';
  const location = contactLine.split('|').map(s => s.trim())
    .find(s => s && !/@|\d{5,}|\+?\d[\d\s().-]{7,}\d|https?:|linkedin|github/i.test(s))
    /* Otherwise a "City, Country" line on its own near the top. */
    ?? head.find(l => /^[A-Z][A-Za-z .'-]{1,30},\s*[A-Z][A-Za-z .'-]{1,30}$/.test(l) && !TITLE_WORDS.test(l)) ?? '';

  const roles: RoleField[] = [];
  const skills: Array<{ group: string; items: string[] }> = [];
  const tools: string[] = [];
  const education: string[] = [];
  let section: keyof typeof SECTION_NAMES | null = null;
  let current: RoleField | null = null;
  let pendingHeader = '';

  for (const line of lines.slice(Math.max(0, firstSection))) {
    const s = sectionOf(line);
    if (s) { section = s; current = null; pendingHeader = ''; continue; }
    if (section === 'experience') {
      const range = RANGE.exec(line);
      if (range) {
        const rest = line.replace(range[0], '').replace(/[()]/g, ' ').trim();
        let { title, company } = splitTitleCompany(rest);
        /* Two-line headers: "Senior Engineer" then "Acme Ltd, London  Jan
           2020 - Present", or the reverse. The line carrying a job-title
           word is the title; the other line is the company, kept whole. */
        if (pendingHeader) {
          const headIsTitle = TITLE_WORDS.test(pendingHeader);
          const restIsTitle = TITLE_WORDS.test(rest);
          if (!rest) ({ title, company } = splitTitleCompany(pendingHeader));
          else if (headIsTitle && !restIsTitle) { title = pendingHeader; company = rest.replace(/[\s,|]+$/, ''); }
          else if (!headIsTitle && restIsTitle) { company = pendingHeader; title = rest.replace(/[\s,|]+$/, ''); }
          else {
            const prev = splitTitleCompany(pendingHeader);
            if (!title) title = prev.title || pendingHeader;
            if (!company) company = prev.company || (prev.title ? '' : pendingHeader);
          }
        }
        if (!title && !company) continue;
        current = { company, title, start: normDate(range[1]!), end: normDate(range[2]!), bullets: [] };
        roles.push(current);
        pendingHeader = '';
        continue;
      }
      if (BULLET_RE.test(line)) {
        if (current) current.bullets.push(line.replace(BULLET_RE, '').trim());
        continue;
      }
      /* A wrapped bullet continues in lower case or mid-sentence. */
      if (current && current.bullets.length && /^[a-z(,;]/.test(line)) {
        current.bullets[current.bullets.length - 1] += ` ${line}`;
        continue;
      }
      /* Otherwise a short line is a header for the next role; a long one is
         an unbulleted achievement sentence under the current role. */
      if (line.length <= 80 && !/[.!?]$/.test(line)) pendingHeader = line;
      else if (current) current.bullets.push(line);
      continue;
    }
    if (section === 'skills') {
      const idx = line.indexOf(':');
      const items = (idx > 0 ? line.slice(idx + 1) : line).replace(BULLET_RE, '')
        .split(/\s*[|,;•]\s*/).map(x => x.trim()).filter(Boolean);
      if (items.length) skills.push({ group: idx > 0 ? line.slice(0, idx).trim() : 'Skills', items });
      continue;
    }
    if (section === 'tools') {
      tools.push(...line.replace(BULLET_RE, '').split(/\s*[|,;•]\s*/).map(x => x.trim()).filter(Boolean));
      continue;
    }
    if (section === 'education') education.push(line.replace(BULLET_RE, ''));
  }

  return { positioning, location, phone, email, roles, skills, tools, education };
}

/* The resume structurer used at ingestion: the strict template reader
   first (seeded and app-generated CVs match it exactly), the tolerant
   reader when the template yields no roles. */
export function structureResume(text: string): ResumeFields & { structuredBy: 'template' | 'loose' } {
  const strict = parseResume(text);
  if (strict.roles.length) return { ...strict, structuredBy: 'template' };
  return { ...parseResumeLoose(text), structuredBy: 'loose' };
}

/* ---------- submission composer ---------- */

function formatDates(d: string): string { return d; }

export function composeSubmission(evidence: {
  candidate: { name: string; targetRole: string; employer: string; tenure: string;
    compExpectations: string | null; currentCompensation: string | null; noticePeriod: string | null; motivation: string | null };
  resume: ResumeFields | null;
  confirmedMetric: string | null;
  conflicts: string[];
  gaps: string[];
  toVerify: string[];
  /* Exactly five model-written bullets, already validated and grounded by
     the intelligence layer. Absent means use the scripted framework. */
  summaryOverride?: string[];
}) {
  const r = evidence.resume;
  const summary = evidence.summaryOverride ?? (r ? [
    `${r.positioning}.`,
    `Scope and credibility demonstrated across ${r.roles.length} recorded role${r.roles.length === 1 ? '' : 's'} at ${[...new Set(r.roles.map(x => x.company))].join(' and ')}.`,
    `Trusted with the problems the evidence shows: ${r.skills.flatMap(s => s.items).slice(0, 3).join(', ')}.`,
    `Operating style evidenced in the bullets: context, action, outcome, with metrics where they exist.`,
    `Under pressure: delivery against hard dates, evidenced by ${evidence.confirmedMetric ?? 'recorded outcomes'}.`,
  ] : []);

  const experience: string[] = [];
  for (const role of r?.roles ?? []) {
    const dates = `${formatDates(role.start)} - ${formatDates(role.end)}`;
    experience.push(`${role.company} | ${dates}`);
    experience.push(`  ${role.title}`);
    if (role.progressedFrom) experience.push(`  (Progressed from ${role.progressedFrom})`);
    for (const b of role.bullets) experience.push(`  - ${b}`);
  }

  const doc = [
    evidence.candidate.name,
    r?.positioning ?? evidence.candidate.targetRole,
    `${r?.location ?? ''} | ${r?.phone ?? ''} | ${r?.email ?? ''}`.trim(),
    '',
    'Executive summary',
    ...summary.map(s => `- ${s}`),
    '',
    'Skills',
    ...(r?.skills ?? []).map(s => `${s.group}: ${s.items.join(' | ')}`),
    '',
    'Professional experience',
    ...experience,
    '',
    'Education and certifications',
    ...(r?.education ?? []),
  ].join('\n');

  const email = [
    `Subject: Candidate submission: ${evidence.candidate.targetRole}`,
    '',
    `${evidence.candidate.name} is a ${evidence.candidate.targetRole} candidate worth your time.`,
    '',
    'Core strengths:',
    ...summary.slice(0, 3).map(s => `- ${s.replace(/^\w+-level note: /, '')}`),
    '',
    'Key details:',
    `- Compensation expectations: ${evidence.candidate.compExpectations ?? 'not yet captured'}`,
    `- Notice period: ${evidence.candidate.noticePeriod ?? 'not yet captured'}`,
    `- Location: ${r?.location ?? 'not yet captured'}`,
    '',
    'Next step: a short call this week to go through the evidence pack.',
  ].join('\n');

  const notes = [
    'Recruiter notes. Internal only, never client-facing.',
    `To verify: ${evidence.toVerify.join('; ') || 'nothing outstanding'}`,
    `Gaps: ${evidence.gaps.join('; ') || 'none recorded'}`,
    `Discrepancies: ${evidence.conflicts.join('; ') || 'none recorded'}. The conservative version is used in outputs.`,
    `Current compensation: ${evidence.candidate.currentCompensation ?? 'not captured'}. This field exists here only.`,
    `Motivation: ${evidence.candidate.motivation ?? 'not captured'}.`,
  ].join('\n');

  /* Deterministic QA checklist on generated output. */
  const qa: Array<{ check: string; pass: boolean }> = [
    { check: 'Single-role date rule enforced: dates shown once, on the company line', pass: (r?.roles ?? []).every(x => !x.singleRole || doc.split(x.end).length === 2) },
    { check: 'Dates in one right-aligned column, MM/YYYY throughout', pass: /\b(0[1-9]|1[0-2])\/\d{4}\b/.test(doc) },
    { check: 'Current compensation absent from client-facing output', pass: !evidence.candidate.currentCompensation || !doc.includes(evidence.candidate.currentCompensation) },
    { check: 'Em dash linter: zero violations', pass: !doc.includes('\u2014') },
    { check: 'Executive summary uses the five-part framework, five bullets', pass: summary.length === 5 },
    { check: 'Section order follows the document schema', pass: doc.indexOf('Executive summary') < doc.indexOf('Skills') && doc.indexOf('Skills') < doc.indexOf('Professional experience') },
  ];

  return { doc, email, notes, qa };
}

/* ---------- research analyst ---------- */

const STOPWORDS = new Set(['must', 'have', 'with', 'the', 'and', 'for', 'from', 'that', 'this', 'their', 'into', 'over', 'under', 'scale', 'high', 'level', 'experience', 'strong', 'good']);

export function keywords(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9+#]+/).filter(w => w.length > 2 && !STOPWORDS.has(w));
}

/* The evidence the research agent reasons over. Gathered through the
   projection-scoped tool layer, so it carries sanitized fields only (L1).
   Shared by the scripted path and the model-backed path so both see
   identical inputs. */
export interface ResearchEvidence {
  targetRole: string;
  targetCompany: string | null;
  musts: string[];
  resume: ResumeFields;
  corpus: string;
}

export function gatherResearchEvidence(t: ToolContext): ResearchEvidence {
  const spine = t.call('read_spine', {}) as {
    candidate: { targetCompany: string | null; targetRole: string };
    artifacts: Array<{ kind: string; fields: Record<string, unknown>; quarantine?: string }>;
    sessions: Array<{ status: string }>;
  };
  const jd = spine.artifacts.find(a => a.kind === 'jd');
  const resume = spine.artifacts.find(a => a.kind === 'resume');
  const r = (resume?.fields ?? {}) as unknown as ResumeFields;
  return {
    targetRole: spine.candidate.targetRole,
    targetCompany: spine.candidate.targetCompany,
    musts: (jd?.fields as { mustHave?: string[] } | undefined)?.mustHave ?? [],
    resume: r,
    corpus: [
      ...(r.roles ?? []).flatMap(role => role.bullets),
      ...(r.skills ?? []).flatMap(g => g.items),
      ...(r.tools ?? []),
    ].join(' \n ').toLowerCase(),
  };
}

/* Writes the report artifact. The single write path for research findings,
   whichever producer generated them. */
export function writeResearchReport(t: ToolContext, ev: ResearchEvidence, findings: ResearchFinding[]): unknown {
  const summary = {
    good: findings.filter(f => f.kind === 'good').length,
    improve: findings.filter(f => f.kind === 'improve').length,
    needs_work: findings.filter(f => f.kind === 'needs_work').length,
  };
  t.call('write_artifact', {
    kind: 'research_report',
    title: 'Research report',
    content: [
      'Research report',
      `Target: ${ev.targetRole}${ev.targetCompany ? ` at ${ev.targetCompany}` : ''}`,
      `Good ${summary.good} · Improve ${summary.improve} · Needs work ${summary.needs_work}`,
      ...findings.map(f => `${f.kind.toUpperCase()}: ${f.title}. ${f.detail}`),
    ].join('\n'),
    fields: { findings, summary },
  });
  return { summary, findings: findings.length };
}

/* Scripted research findings: keyword coverage of each JD must-have against
   the CV corpus. Deterministic and evidence-bound, but literal: it matches
   terms, it does not read for meaning. The model-backed producer in
   intelligence.ts supersedes it when a provider is configured. */
export function scriptedResearchFindings(ev: ResearchEvidence): ResearchFinding[] {
  const { musts, corpus, resume: r } = ev;
  const findings: ResearchFinding[] = [];
  if (ev.targetCompany) {
    findings.push({
      kind: 'good',
      title: 'Target captured',
      detail: `Targeting ${ev.targetCompany}. The report checks their stated requirements against your evidence.`,
    });
  }
  for (const must of musts) {
    const words = keywords(must);
    if (!words.length) continue;
    const hits = words.filter(w => corpus.includes(w));
    if (hits.length === words.length) {
      findings.push({
        kind: 'good',
        title: `Covered: ${must.replace(/^must[- ]have:\s*/i, '')}`,
        detail: `Every key term (${hits.join(', ')}) appears in your CV evidence.`,
      });
    } else if (hits.length > 0) {
      findings.push({
        kind: 'improve',
        title: `Partial: ${must.replace(/^must[- ]have:\s*/i, '')}`,
        detail: `Found ${hits.join(', ')}, but ${words.filter(w => !hits.includes(w)).join(', ')} is not evidenced yet.`,
      });
    } else {
      findings.push({
        kind: 'needs_work',
        title: `Not evidenced: ${must.replace(/^must[- ]have:\s*/i, '')}`,
        detail: 'No term from this requirement appears in your CV. Build a story before the interview.',
      });
    }
  }
  for (const role of r.roles ?? []) {
    const hasMetric = role.bullets.some(b => /\d/.test(b));
    if (!hasMetric && role.bullets.length > 0) {
      findings.push({
        kind: 'improve',
        title: `Add numbers: ${role.company}`,
        detail: 'The bullets describe the work but carry no measurable outcome. A number or a verifiable result earns credibility.',
      });
    }
  }
  if (!musts.length) {
    findings.push({
      kind: 'improve',
      title: 'No job description requirements found',
      detail: 'The report had no must-have list to check. Add the job description text for a sharper analysis.',
    });
  }
  return findings;
}

/* Research Agent, scripted path. Kept as the fail-closed implementation and
   as the producer the deterministic tests exercise. */
export function agentResearchAnalyst(t: ToolContext): unknown {
  const ev = gatherResearchEvidence(t);
  return writeResearchReport(t, ev, scriptedResearchFindings(ev));
}

/* ---------- CV assembler ---------- */

/* The revamped CV's structured shape: the same data the downloadable
   PDF/DOCX templates render from (src/web/shared/cv-template.ts), stored
   on the artifact's `fields` alongside the flat `content` string so the
   two never drift apart. */
export interface CvTemplateFields {
  positioning: string; location: string; phone: string; email: string;
  roles: Array<{ company: string; title: string; start: string; end: string; bullets: string[] }>;
  skills: Array<{ group: string; items: string[] }>;
  education: string[];
}

/* Shared by the live pipeline agent below and by the seed script, so a
   seeded "already complete" candidate gets exactly the same CV a real
   run would have produced, not a hand-written approximation of one. */
export function assembleCv(
  name: string, r: ResumeFields,
  handoffs: Array<{ fields: { roleKey?: string; bullets?: string[] } }>,
): { content: string; fields: CvTemplateFields } {
  const roles = (r.roles ?? []).map((role, i) => {
    const handoff = handoffs.find(h => h.fields.roleKey === `${i}:${role.company}`);
    const bullets = handoff?.fields.bullets ?? role.bullets;
    return { company: role.company, title: role.title, start: role.start, end: role.end, bullets };
  });
  const blocks = roles.map(role => [
    `${role.company} | ${role.start} - ${role.end}`,
    role.title,
    ...role.bullets.map(b => `- ${b}`),
    '',
  ].join('\n')).join('\n');
  const content = [
    name,
    r.positioning,
    [r.location, r.phone, r.email].filter(Boolean).join(' | '),
    '',
    'EXPERIENCE',
    '',
    blocks.trimEnd(),
    '',
    'SKILLS',
    ...(r.skills ?? []).map(g => `${g.group}: ${g.items.join(' | ')}`),
    '',
    'EDUCATION',
    ...(r.education ?? []),
  ].join('\n');
  const fields: CvTemplateFields = {
    positioning: r.positioning, location: r.location, phone: r.phone, email: r.email,
    roles, skills: r.skills ?? [], education: r.education ?? [],
  };
  return { content, fields };
}

/* Pipeline agent: fires when a resume_studio run completes. Writes the
   revamped CV once every role has a handoff block (per the journey gate). */
export function agentCvAssembler(t: ToolContext): unknown {
  const spine = t.call('read_spine', {}) as {
    candidate: { name: string };
    artifacts: Array<{ kind: string; fields: Record<string, unknown>; content: string | null }>;
  };
  const resume = spine.artifacts.find(a => a.kind === 'resume');
  const r = (resume?.fields ?? {}) as unknown as ResumeFields;
  const handoffs = spine.artifacts.filter(a => a.kind === 'handoff_block') as Array<{ fields: { roleKey?: string; bullets?: string[] } }>;
  const missing = (r.roles ?? []).filter((role, i) => {
    const key = `${i}:${role.company}`;
    return !handoffs.some(h => h.fields.roleKey === key);
  });
  if (!r.roles?.length || missing.length > 0) {
    return { assembled: false, missing: missing.length };
  }
  const { content, fields } = assembleCv(spine.candidate.name, r, handoffs);
  t.call('write_artifact', { kind: 'cv', title: 'Revamped CV', content, fields });
  t.call('emit_event', { topic: 'journey.changed', payload: {} });
  return { assembled: true };
}

/* ---------- profile page assembler ---------- */

/* The shareable "brief overview" page: a LinkedIn-card-style summary for
   the end customer the recruiter is submitting to, not a document to
   read line by line. Companies and highlights only, no contact details:
   those stay inside the downloadable CV, one click further in. */
export interface ProfilePageFields {
  name: string; headline: string; location: string;
  companies: string[]; highlights: string[];
  skills: Array<{ group: string; items: string[] }>;
  education: string[];
  verified: boolean;
}

/* Shared by the live pipeline agent below and by the seed script, same
   reason assembleCv is shared: a seeded "already complete" candidate
   gets exactly what a real run would have produced. */
export function assembleProfilePage(
  name: string, headline: string, r: ResumeFields,
  handoffs: Array<{ fields: { roleKey?: string; bullets?: string[] } }>,
  verified: boolean,
): { content: string; fields: ProfilePageFields } {
  const roles = (r.roles ?? []).map((role, i) => {
    const handoff = handoffs.find(h => h.fields.roleKey === `${i}:${role.company}`);
    return { company: role.company, bullets: handoff?.fields.bullets ?? role.bullets };
  });
  const companies = roles.map(x => x.company);
  const highlights = roles.flatMap(x => x.bullets);
  const fields: ProfilePageFields = {
    name, headline, location: r.location, companies, highlights,
    skills: r.skills ?? [], education: r.education ?? [], verified,
  };
  const content = [
    name, headline, r.location, '',
    `Worked with: ${companies.join(', ')}`, '',
    'Highlights',
    ...highlights.map(h => `- ${h}`),
    '',
    'Skills',
    ...(r.skills ?? []).map(g => `${g.group}: ${g.items.join(', ')}`),
    '',
    'Education',
    ...(r.education ?? []),
  ].join('\n');
  return { content, fields };
}

/* Pipeline agent: fires alongside the CV assembler, on the same gate
   (every role has a handoff block), so every candidate whose CV is
   complete also gets a shareable profile page, no separate trigger. */
export function agentProfilePageAssembler(t: ToolContext): unknown {
  const spine = t.call('read_spine', {}) as {
    candidate: { name: string; targetRole: string };
    artifacts: Array<{ kind: string; fields: Record<string, unknown>; content: string | null }>;
    sessions: Array<{ mode: string; status: string }>;
  };
  const resume = spine.artifacts.find(a => a.kind === 'resume');
  const r = (resume?.fields ?? {}) as unknown as ResumeFields;
  const handoffs = spine.artifacts.filter(a => a.kind === 'handoff_block') as Array<{ fields: { roleKey?: string; bullets?: string[] } }>;
  const missing = (r.roles ?? []).filter((role, i) => !handoffs.some(h => h.fields.roleKey === `${i}:${role.company}`));
  if (!r.roles?.length || missing.length > 0) {
    return { assembled: false, missing: missing.length };
  }
  const verified = spine.sessions.some(s => s.mode === 'verified' && s.status === 'complete');
  const { content, fields } = assembleProfilePage(spine.candidate.name, spine.candidate.targetRole, r, handoffs, verified);
  t.call('write_artifact', { kind: 'profile_page', title: 'Candidate profile page', content, fields });
  return { assembled: true };
}

/* ---------- session agents ---------- */

export interface SessionState {
  phase: string;
  role?: string;
  era?: 'recent' | 'mid' | 'older';
  target?: number;
  areas: Array<{ name: string; owned: string; action: string; outcome: string; bullet: string }>;
  probeIndex: number;
  questions?: string[];
  questionIndex?: number;
  followUps?: number;
  answers?: Array<{ q: string; a: string; feedback: string; star: StarMetrics }>;
  sectionsLeft?: string[];
}

const PROBE_PROMPTS = [
  'What did you personally own there?',
  'What did you actually do, step by step?',
  'What changed as a result? A number is best, a credible outcome works too.',
];
const ERA_TARGET: Record<string, number> = { recent: 5, mid: 3, older: 2 };

/* Resume Studio session agent. One role per run (runtime enforced). */
export function resumeStudioTurn(state: SessionState, spine: { roles: RoleField[] }, text: string, roleKey?: string):
  { reply: string; state: SessionState; declareComplete?: { bullets: number; areasLeft: number } } {
  const s: SessionState = Object.assign({ areas: [], probeIndex: 0 }, state);
  if (s.phase === 'open' || !s.phase) {
    s.phase = 'probe';
    const selected = (roleKey
      ? spine.roles.find((_role, i) => `${i}:${_role.company}` === roleKey)
      : undefined) ?? spine.roles[0];
    s.role = s.role ?? selected?.title ?? 'most recent role';
    const start = selected?.start ?? '01/2020';
    const years = Number(start.split('/')[1] ?? 2020);
    const era = years >= 2021 ? 'recent' : years >= 2011 ? 'mid' : 'older';
    s.era = era;
    s.target = ERA_TARGET[era]!;
    return {
      reply: `I can see your resume. Working on ${s.role}, your ${era} role, targeting ${s.target} strong bullets. Which area do you want to start with, or shall I pick one?`,
      state: s,
    };
  }
  if (/\b(done|complete|no more|that is all|finished)\b/i.test(text)) {
    if (s.areas.length >= (s.target ?? 2)) {
      s.phase = 'handoff';
      const bullets = s.areas.map((a, i) => `${i + 1}. ${a.bullet}`);
      return {
        reply: `That is this role, career evidence complete. The interview portion is done. Your bullets are on screen, copy them into your resume now.\n\n${bullets.join('\n')}\n\nIf anything needs tightening, tell me and we will fix it.`,
        state: s,
        declareComplete: { bullets: s.areas.length, areasLeft: 0 },
      };
    }
    const last = s.areas[s.areas.length - 1];
    if (!last || (last.owned && last.action && last.outcome)) {
      const need = (s.target ?? 2) - s.areas.length;
      return {
        reply: `Not yet. The depth target for this era is ${s.target} strong bullets; you have ${s.areas.length}. ${need} to go. Next area?`,
        state: s,
      };
    }
    /* Otherwise fall through and keep probing the open area. */
  }
  const last = s.areas[s.areas.length - 1];
  const lastComplete = last && last.owned && last.action && last.outcome;
  if (!last || lastComplete) {
    const owned = /\b(I|my)\b/i.test(text);
    const bulletDraft = text.trim().replace(/\s+/g, ' ').slice(0, 220);
    s.areas.push({
      name: `Area ${s.areas.length + 1}`,
      owned: owned ? text.slice(0, 160) : '',
      action: '', outcome: '', bullet: bulletDraft,
    });
    s.probeIndex = 1;
    return { reply: PROBE_PROMPTS[1]!, state: s };
  }
  if (s.probeIndex === 1) {
    last.action = text.slice(0, 200);
    s.probeIndex = 2;
    return { reply: PROBE_PROMPTS[2]!, state: s };
  }
  last.outcome = text.slice(0, 200);
  const metric = text.match(/(\d+\s?%|by\s+\d+[%a-z]*)/i)?.[0];
  const lead = last.bullet.split(/\s+/).slice(0, 6).join(' ');
  last.bullet = `${lead}: ${last.action.replace(/\.$/, '')}, ${metric ? `${metric} outcome` : 'a verifiable outcome'}.`;
  s.probeIndex = 0;
  const need = (s.target ?? 2) - s.areas.length;
  return {
    reply: need > 0
      ? `Bullet ${s.areas.length} is strong. ${need} to go. Next area?`
      : `Bullet ${s.areas.length} is strong. That covers the depth target for this role. Anything more, or are we done?`,
    state: s,
  };
}

/* Interview Screener session agent (verified mode). */
const DEFAULT_QUESTIONS = [
  'Tell me about a time you delivered against a deadline you did not control.',
  'Describe a decision you made with incomplete information. What did you do?',
  'What is a real weakness, and what have you actively done about it?',
  'Why this role, specifically?',
  'Why should they hire you over someone with the same title?',
  'Tell me about the scale of the largest thing you have owned.',
  'What questions do you have for me?',
];

export function screenerTurn(state: SessionState, jdMustHave: string[], text: string, isAnswer: boolean):
  { reply: string; state: SessionState; declareComplete?: { questions: number; debrief: string } } {
  const s: SessionState = Object.assign({ areas: [], probeIndex: 0 }, state);
  s.questions = s.questions ?? [...jdMustHave.slice(0, 5).map(j => `The JD lists ${j} as a must-have. Walk me through where you have run it.`), ...DEFAULT_QUESTIONS].slice(0, 12);
  s.answers = s.answers ?? [];
  s.questionIndex = s.questionIndex ?? 0;
  s.followUps = s.followUps ?? 0;

  if (!isAnswer) {
    const q = s.questions[s.questionIndex ?? 0]!;
    return { reply: `I can see the resume and the job description. I will ask competency questions, push back when I need more, and give feedback after each answer. This will be tough. That is the point. Ready? First question: ${q}`, state: s };
  }
  const q = s.questions[s.questionIndex ?? 0]!;
  const evald = evaluateTranscript([{ t: '00:00', who: 'Candidate', text }]);
  const thin = evald.star.A < 40 || !RESULT_CUE.test(text);
  const feedback = thin
    ? 'The structure is there but the result is thin. What outcome did it produce, in numbers if any?'
    : 'Good structure, ownership is clear, and the outcome lands. Moving on.';
  s.answers.push({ q, a: text, feedback, star: evald.star });

  if (thin && (s.followUps ?? 0) < 1) {
    s.followUps = (s.followUps ?? 0) + 1;
    return { reply: `${feedback}`, state: s };
  }
  s.followUps = 0;
  s.questionIndex = (s.questionIndex ?? 0) + 1;
  if ((s.questionIndex ?? 0) >= s.questions.length) {
    const debrief = [
      'Interview debrief',
      '- What consistently worked: ownership language and concrete scale.',
      '- Biggest difference before the real interview: land the result first, then explain the action.',
      `- Answers needing the most work: ${s.answers.filter(a => a.star.A < 40).length} answer(s) with thin results.`,
      '- Pacing: watch trailing ends, they undercut strong content.',
      '- Competencies not covered this session are worth one more practice run.',
    ].join('\n');
    return {
      reply: `That is the end of the interview. Your full debrief is on screen so you can copy it.\n\n${debrief}\n\nTake what you learned today back to your story bank. Walk in sharper than you walked in here.`,
      state: s,
      declareComplete: { questions: s.answers.length, debrief },
    };
  }
  return { reply: `${feedback} Next: ${s.questions[s.questionIndex!]}`, state: s };
}

/* LinkedIn Studio generation agent. The completed resume is the source of truth. */
export const LINKEDIN_SECTIONS = ['banner', 'headline', 'about', 'experience', 'keywords', 'skills'] as const;
const SECTION_LIST: string[] = [...LINKEDIN_SECTIONS];

export function linkedinTurn(state: SessionState, resume: ResumeFields, text: string):
  { reply: string; state: SessionState; declareComplete?: { sections: number } } {
  const s: SessionState = Object.assign({ areas: [], probeIndex: 0, sectionsLeft: [...SECTION_LIST] }, state);
  const want = SECTION_LIST.find(k => text.toLowerCase().includes(k)) ?? s.sectionsLeft![0]!;
  if (!s.sectionsLeft!.includes(want)) {
    return { reply: `That section is already delivered. Still available: ${s.sectionsLeft!.join(', ')}.`, state: s };
  }
  s.sectionsLeft = s.sectionsLeft!.filter(x => x !== want);
  let section = '';
  switch (want) {
    case 'banner':
      section = `Banner text options:\n1. ${resume.positioning} for ${resume.roles[0]?.company ?? 'your domain'}\n2. ${resume.skills[0]?.items.slice(0, 2).join(' and ')} specialist\n3. Delivery-focused ${resume.positioning.toLowerCase()}`;
      break;
    case 'headline':
      section = `Headline (220 characters max): ${resume.positioning} | ${resume.skills[0]?.items.join(', ')}`;
      break;
    case 'about': {
      const paras = [
        `I am a ${resume.positioning.toLowerCase()}.`,
        `My work has focused on ${resume.skills.flatMap(x => x.items).slice(0, 3).join(', ')}.`,
        `I work best where ownership and measurable outcomes matter, evidenced across ${resume.roles.length} role(s).`,
        `I tend to operate closest to ${resume.roles[0]?.title ?? 'delivery'} work, partnering with the teams around me.`,
        `Open to ${resume.positioning.toLowerCase()} roles where that evidence carries.`,
      ];
      section = `About section:\n${paras.join('\n\n')}`;
      break;
    }
    case 'experience':
      section = `Experience section:\n${resume.roles.map(r =>
        `${r.title} at ${r.company}\n${r.start} - ${r.end}\n${r.bullets.slice(0, 5).map(b => `- ${b}`).join('\n')}`).join('\n\n')}`;
      break;
    case 'keywords':
      section = `Keyword checklist:\n${resume.skills.flatMap(x => x.items).slice(0, 10).map(k => `${k}: ${k.toLowerCase()} / ${k.split(' ')[0] ?? k}`).join('\n')}`;
      break;
    case 'skills':
      section = `Skills (${resume.skills.flatMap(x => x.items).length}, all backed by bullets):\n${resume.skills.flatMap(x => x.items).join(' | ')}`;
      break;
  }
  const done = s.sectionsLeft!.length === 0;
  return {
    reply: done
      ? `${section}\n\nThat is all six sections. Save your work as you go.`
      : `${section}\n\nWhat would you like to work on next? Still available: ${s.sectionsLeft!.join(', ')}.`,
    state: s,
    declareComplete: done ? { sections: 6 } : undefined,
  };
}

# Reference flows, sanitized summary
Source artifacts for the flow contracts (master build prompt, sections 2 and 10).
Binding behavioral reference for the flow engine. Provenance and removals are
recorded in ADR-0001.

Provenance: four proprietary reference prompts were supplied in chat. They are
reference material only. The originals are not committed to this repository and
never ship to a client. This document is the sanitized architectural summary:
proprietary identifiers, branding, and tooling references removed, core
architecture, state machines, thresholds, and output contracts retained.

Removed as proprietary or non-portable:
- Agency name, founder name, and all agency branding (document colors, fonts,
  margins, cover page asset). In Certainty these become per-tenant brand
  configuration consumed by the document generator, never prompt content.
- Program and course names, course attributions, and platform usage
  instructions (which chat product, connectors, paid plan, transcript vendor).
- Founder sign-off defaults. Sign-off becomes a per-tenant setting.

Retained: flow architecture, step order, gates, thresholds, output schemas,
handoff protocol, and behavioral invariants.

---

## 1. Submission Builder (recruiter side, pipeline agent)

Purpose: turn rough resume, screening transcript, LinkedIn snapshot, and
optional JD into client-ready deliverables with defensible evidence.

Run shape: single pass, fixed step order, one candidate per run, no setup
questions. Text mode only. Never reused across candidates (runtime enforces).

Steps:
1. Intake check. Required: resume. Optional but requested: screening
   transcript, LinkedIn snapshot, JD. Ask once for anything missing; never
   stall on an input the recruiter says does not exist; never fabricate
   around an absence. Confirm the target role title from the JD, or ask for
   it when there is no JD.
2. Cross-source verification. Compare every title and date across resume,
   transcript, and LinkedIn. Conflicts resolve to the conservative, internally
   consistent version (for example, dates that create no impossible
   overlaps). Every discrepancy is listed in recruiter notes with all
   versions stated. Partial LinkedIn reads are flagged, never silently used.
3. Evidence analysis before writing: what the candidate personally owned,
   concrete numbers and outcomes in any source (transcript usually holds
   stronger evidence than the resume), where the resume undersells with
   supporting substance, what is missing everywhere, JD competencies versus
   evidence.
4. Deliverables, one pass, fixed trio: Candidate Introduction document,
   client email, internal recruiter notes.

Hard accuracy rules (L5 seeds):
- Never invent, infer, embellish. If a detail is not in the inputs, omit it.
  Only exception: company description lines, general knowledge of the company
  itself, never of the candidate.
- Never manufacture a metric. Numbers only where evidence gives them;
  otherwise a credible qualitative outcome.
- Years of experience are precise and correctly attributed. Never blend
  individual contributor and leadership tenure into one inflated claim.
- Titles are never adjusted to fit a JD. Genuinely meaningless internal
  titles are flagged with a suggested market alternative; the recruiter
  decides. Tailoring means reordering and emphasizing within bullets only.
- Never pad skills from a JD. JD gaps go to notes, never onto the document.
- Unverifiable own-venture performance claims are excluded from client-facing
  output and noted internally. Self-branding slogans are stripped, the
  evidence underneath them is kept.
- Commercially sensitive detail (employer revenue figures, named clients,
  internal codenames) is generalized, not deleted.
- Em dash lint on all written output. Hyphens and commas only.

Document schema (fixed section order): header, executive summary, skills,
tools and technologies (omit if empty), professional experience, education
and certifications, additional activities (omit if empty), referee extracts
(last section, omit if empty).
- Header: name, positioning line, location and phone and email; optional
  elements (profile URL, work eligibility, working model) only where
  evidenced. No placeholders.
- Executive summary: 5 to 6 bullets, five-part framework: identity and
  level; scope, scale, credibility; problems and environments trusted with;
  operating style and value creation; behavior under pressure. Optional
  sixth bullet for evidenced awards or promotions.
- Skills: 2 to 4 bolded category labels, pipe-separated within each, only
  evidence-demonstrated skills.
- Experience blocks: most recent first. Company bold with overall tenure
  dates right-aligned, MM/YYYY, running through M&A and rebrands as one
  tenure. Most recent role bold with its own dates beneath, not bold.
  Single-role exception: identical overall and role dates render once, on
  the company line, bolded; the role line carries no dates. Role-line dates
  appear only in multi-role blocks or genuine re-hire splits. Company
  description 1 to 2 lines (the one permitted general-knowledge element).
  3 to 6 achievement bullets per role, never padded to count. Progression
  and acquisition notes on their own line, no dates. Careers over roughly
  15 years: full bullets for the most recent 10 to 15, earliest roles
  condensed to title plus one or two light bullets or company and title
  only. Roles within a company sit tight, no blank lines, so progression
  reads as one tenure.
- Bullet format: plain single sentences, action-verb led, context-action-
  outcome, metric only where evidenced, no bold opening phrases, lead with
  impact and ownership.
- Referee extracts: maximum 3, 1 to 2 lines, quoted faithfully from referee
  material in the inputs, never strengthened or paraphrased upward,
  attributed by name plus relationship, never naming the platform.

Client email: subject line of positioning plus role; one to two sentence
opening; condensed strengths (same evidence-backed bullets, trimmed,
strongest first, mirroring JD priorities when present); key details block
(compensation expectations, location, work rights, availability, notice
period); clear next step and sign-off from a per-tenant sender setting.

Compensation rule: expectations go in the email key details block. Current
compensation, notice period, and reasons for leaving never appear anywhere
client-facing; they live in recruiter notes only.

Deterministic QA checklist (runs on every generated file, machine-checkable):
name does not overlap the positioning line; every date sits in one clean
right-aligned column; no block shows identical dates on company and role
lines; hanging indents on all bullets; no page ends in a large void;
sections in exact schema order with referee extracts last; dividers between
complete company blocks only, none after the last company, none inside a
merged block; brand cover page (if configured) is page 1 and content starts
on page 2. A failed check regenerates before the file is shared.

Recruiter notes schema (internal only): to-verify (single-source claims,
implied-but-unconfirmed claims, excluded own-venture claims), gaps (missing
months, unexplained gaps, missing metrics, unevidenced JD must-haves),
discrepancies (all versions stated, conservative version used in outputs),
title flags (internal title plus suggested market alternative), sensitive
screen detail (current compensation, expectations, notice, motivation).

---

## 2. Interview Screener / practice (session agent)

Purpose: a practice interview harder than the real one, pressure-testing
prepared STAR stories, with structured feedback and a debrief.

Persona invariants: sharp interviewer, not a coach or cheerleader. Feedback
arrives after answers, never during. Pushback on vagueness, hedging, and
buzzwords. Brief acknowledgment, then move to what needs work.

Voice and turn discipline (runtime enforced, mirrors Addendum A):
- Spoken turns under 15 seconds. Varied openers.
- Numbers and metrics heard in voice are confirmed back before use.
- Garbled or off transcript is re-asked, never guessed.
- One question per turn, never stacked. One follow-up per answer maximum,
  asked only after the answer completes.

Question generation: 8 to 12 competency questions drawn from the JD (stated
and implied competencies) cross-referenced with the story bank, plus classic
high-value questions. Mix: behavioral (majority of the session),
motivational, a real weakness question (non-fatal, evidence of active
correction), and a closing swap that evaluates whether the candidate's own
questions show business thinking. Questions are generated dynamically from
sources, never a fixed list. The candidate may prioritize competencies at
the start. If no story bank exists, proceed from JD and resume only and
recommend building one in the debrief.

STAR evaluation, exact targets: Situation 15, Task 10, Action 50, Result 25.
Checks per answer: STAR proportions, ownership ("I" for decisions and
actions versus "we" for team outcomes, push when everything is "we"),
specificity (scale, numbers, timeframes), jargon (non-specialist test),
trailing ends, pacing.

Per-answer feedback: one sentence on what landed, the named gap, the single
change with the biggest effect, then redo-or-advance choice. On redo,
acknowledge what improved, flag what did not, move on.

Candidate controls (exact command mapping, no menu re-prompt): pause, redo,
skip, feedback, different question (same competency).

Debrief (handoff protocol, runtime behavior): on completion the agent says
one transition line, then stops speaking entirely. The debrief renders as a
copyable text block only: what consistently worked; two or three changes
with the biggest effect before the real interview; which answers need the
most work and why; how pacing held up; story-bank competencies not tested
this session, or the recommendation to build a story bank if none exists.
One closing line after the block. No narration path exists.

Session invariants: never coach mid-answer, never accept "it went well" as
a result, never invent or embellish on the candidate's behalf, never exceed
12 questions, never skip the debrief, em dash lint on all text output.

---

## 3. Resume Studio (session agent, two phases)

Purpose: role-by-role forensic evidence extraction producing
publication-ready resume bullets, then executive summary and core skills.

Phase 1, per-role extraction:
- One role per session, enforced by the runtime. Fresh session per role.
  Most recent first is suggested; the candidate chooses. No second role in
  the same session, ever.
- Era-based depth from role dates: recent (last 5 years) 5 to 7 bullets,
  mid-range (5 to 15 years) 3 to 4, older (15 years plus) 2 to 3.
- Probe each area until the bullet has exactly three things: what the
  candidate owned, what they did, what changed (metric where one exists,
  otherwise a credible verifiable qualitative outcome). Once the three
  exist, move on. Do not chase sub-details.
- Internal bullet counter for progress tracking, never announced.
- Reconstruct when the candidate cannot remember (team size, budget,
  timelines, volume, before-and-after). Stop generic language and
  responsibility phrasing; ask for decisions, accountability, constraints.
- Mid-session commands: go deeper (probe harder, do not move on), show
  bullets so far (stop probing, display draft as text block), pushback
  (adapt, ask what they would change), direction change (follow, then
  pivot naturally back to the objective).
- Handoff protocol (runtime behavior): one transition line, then stop
  speaking entirely, then bullets as a text block only. Each bullet: bold
  5 to 10 word opening phrase naming the contribution, then one tight
  sentence carrying context, action, outcome with metrics where available.
  Revision loop until approved, then a closing line instructing the
  candidate to save the bullets into their resume and start a fresh session
  for the next role.

Phase 2, synthesis (triggers when all roles are complete):
- Requires the completed skeleton visible. No interview in this session.
- Executive summary: exactly 5 bullets, one sentence each, following the
  five-part framework (identity and level; scope, scale, credibility;
  problems and environments; operating style and value creation; under
  pressure). Every claim traceable to a specific role bullet.
- Core skills: 10 to 14 skills, pipe-separated, single line. Labels are 2 to
  4 words, capability-framed, specific, no buzzwords, no category labels as
  skills. Drawn only from demonstrated evidence, prioritizing skills that
  appear across multiple roles. Coverage across categories is not forced.
- Delivery: two copyable text blocks, summary first, then skills after
  confirmation, each with a revision loop. Never spoken.

Invariants: no job-description-language bullets, nothing invented or
embellished, no vague verbs (contributed to, assisted with, supported)
without clarified specifics, no empty buzzwords, no gap-filling or
assumption, no early session end before the era-based count of strong
bullets, deliverables never spoken, em dash lint on all text output.

---

## 4. LinkedIn Studio (generation agent)

Purpose: turn the completed resume into LinkedIn profile sections.

Source of truth rule: the completed resume. Titles, companies, and dates
match exactly. Claims trace to resume bullets or are omitted.

Six sections, delivered one at a time, candidate picks the order, command
phrases recognized and mapped immediately with no menu re-prompt:
1. Banner image text: 3 positioning options, each under 10 words.
2. Headline: single line, 220 characters maximum, four parts (primary role
   title, industry or domain, scope of problems, delivery style), 1 to 3
   high-value keywords from evidenced core skills, positioned for the next
   role, no buzzwords, no emoji.
3. About: first person, flowing prose, no bullets or markdown, five
   paragraphs (who and where; what the work focused on; how they work;
   where they work best; what they want next), 800 to 1200 characters,
   benchmark around 900. No template phrases.
4. Experience: all roles by default (skip only on candidate instruction;
   for careers over roughly 20 years, offer the choice). Keep names,
   titles, dates exactly. 4 to 5 strongest bullets per role (trimmed from
   the resume's 5 to 7; older roles may carry fewer). Sensitive detail
   stripped or generalized. Same evidence, tighter.
5. Keyword checklist: 10 to 15 search terms with recruiter-search
   variations (title variants, abbreviations, acronyms, shorthand),
   each term to be verified present in About, Experience, or Skills.
6. Skills: 20 to 30 skills, every one backed by resume bullets, mixing
   functional, domain, and technical.

After each section: one adjustment prompt, then list remaining sections.
Sections deliver as clean copyable blocks, one at a time, never all at once.

Invariants: no headline over 220 characters, About never third person,
nothing invented, no emoji or hashtags or social formatting, no skill in
the headline that is not demonstrated in bullets, no template or AI voice,
no unrequested role skips, About capped at 1200 characters, em dash lint.

---

## Mapping to the Certainty flow engine

| Reference prompt | Certainty flow | Agent class | Key runtime behaviors |
|---|---|---|---|
| Submission Builder | submission_builder | Pipeline (submission composer) | 4-of-4 source gate, one candidate per run, deterministic QA checklist, brand config in tenant settings, compensation scrubber on client-facing output |
| Interview prompt | interview_screener | Session agent | Turn state machine, 15s speech cap, confirm numbers, re-ask garbled audio, debrief handoff with no narration path |
| Resume Studio | resume_studio | Session agent (two phases) | One role per run, era-based depth contract, handoff protocol, phase 2 synthesis on completion declaration, validated by runtime |
| LinkedIn Studio | linkedin_studio | Generation agent | Six-section state machine, one section per step, resume source-of-truth check, traceability lint |

Thresholds (STAR targets 15/10/50/25, era depths, 8-12 questions, 220 char
headline, 800-1200 char About, 10-14 skills, 20-30 skills, 5-6 summary
bullets, 3-6 experience bullets, max 3 referee extracts) become versioned
constants in the flow definitions, not prompt prose.

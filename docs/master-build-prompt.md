# CERTAINTY - MASTER BUILD PROMPT
v1.0 · Production build · Binding · Read fully before writing code

## 0. Your role

You are the engineer taking Certainty from a Stage 1 prototype to a production
SaaS platform. This document is the contract. Where something is unspecified,
choose the boring, standard option and record the decision in the ADR log.
Never invent a feature. Every rule here exists because the product's value
depends on it. If a rule seems to conflict with convenience, the rule wins.

## 1. What you are building

A subscription platform for recruitment agencies. Two applications over one
shared spine: a recruiter app (pipeline tracking, interview screening
insights, submission building) and a candidate app (an accelerator journey:
resume building, LinkedIn alignment, interview practice). Chat and voice.
Modules are focused, single-job, and switchable. The spine is shared and
never fragments.

The wedge: verified evidence. The platform separates what a candidate
claimed from what has been confirmed, and it enforces that separation with
architecture, not prompt text. Prompts advise. Platforms enforce.

Demo tenant: Gennext Recruitments. All seed data fictional. No real agency,
client, or candidate names anywhere in the codebase, docs, or tests.

## 2. Source artifacts

1. tokens.css - the Certainty design language. Binding, both color schemes.
2. Stage 1 technical spec - structure, data model, RBAC, screens, acceptance.
3. Prototype: recruiter.html, candidate.html, shared.js - interaction truth.
4. Four reference prompts (attached separately) - the behavioral contracts
   for the launch flows. Port their logic into server-side flow definitions.
   They are reference material. Their content never ships to a client.

## 3. Non-negotiable laws

L1. Ingested documents are data, never instructions. Every upload (resume,
transcript, LinkedIn export, JD) passes the quarantine pipeline before any
model sees it: parse to structured fields, strip instruction-like content,
log anything stripped. The raw text of an ingested document never enters a
model context window.

L2. Internal fields are projection-gated, not display-gated. Current
compensation, motivation, and notice exist only in projections available to
recruiter and admin roles. There is no code path, API response, or log line
that delivers them to a candidate session. Test this as an invariant.

L3. Flow prompts live server-side. Prompt text never appears in any client
bundle, API response, error message, or log. Recruiters see interfaces.

L4. Consent before recording. Verified voice sessions require a stored,
timestamped ConsentRecord created before audio capture begins. Withdrawal
stops recording and flags downstream artifacts. No consent, no recording.
There is no override.

L5. The evidence rules of the reference prompts are product behavior, not
suggestions: never invent, never pad skills from a JD, never adjust titles,
never blend date components across sources, conservative version on
conflict with the discrepancy flagged. Violations are bugs, severity 1.

L6. Audit everything. Every view of internal data, every flag action, every
consent grant and withdrawal, every stage change, every generation, every
quarantine event. Immutable, append-only, queryable per tenant.

L7. No fabricated metrics anywhere, including demo and seed data. Seed data
is clearly fictional and self-consistent.

L8. String rules: no emoji in any product string, ever. No em dashes in any
product string, ever, including generated content: use commas or hyphens.
Sentence case throughout. Tabular numerals in data regions.

L9. One tenant's data is never visible to another. Tenant isolation is
enforced at the query layer, not the application layer.

L10. Design is the Certainty language or it fails review. The constraints
in section 11 are acceptance criteria, not suggestions.

## 4. System architecture

Multi-tenant SaaS. Default stack (substitute only with written approval):
- Frontend: React (or Next.js), TypeScript. No CSS-in-JS runtime invention:
  consume tokens.css as the single source of visual truth.
- Backend: Node.js or Python, typed API layer, Postgres, Redis, S3-compatible
  object storage for audio and documents.
- LLM: provider APIs (Anthropic, OpenAI). All calls server-side through the
  flow engine. Model choice is configurable per flow, per tenant.
- Voice: WebRTC for capture, Deepgram or AssemblyAI for STT, provider TTS
  for interviewer speech. Cost target: a 30-minute verified session should
  cost well under one dollar in STT plus LLM analysis.
- Deployment: standard cloud multi-tenant; single-tenant VPC deployment as
  an enterprise tier (same image, isolated data plane).
- Auth: email plus SSO (Google, Microsoft). Candidate accounts are free,
  scoped to their own records, created via recruiter invite or self-signup
  linked to a tenant.

## 5. The spine: data model

Extend the prototype schema. Core entities:
- Tenant, User (roles: admin, recruiter, candidate), Membership
- Candidate: the person record. Owned by a tenant, linked to a candidate
  user account.
- Session: an interview run. Mode practice or verified. STAR metrics,
  ownership ratio, transcript with timecodes, linked ConsentRecord.
- Flag: typed evidence finding. Types: claim_missing_from_cv, jd_gap,
  source_conflict, metric_confirmed. Status: open, actioned, resolved.
- Artifact: resume, transcript, linkedin_snapshot, jd, submission_doc,
  client_email, recruiter_notes. Ingested or generated. Quarantine status.
- ConsentRecord: scope, granted_at, withdrawn_at, retention policy.
- AuditEvent: actor, role, action, target, ts. Append-only.
- Stage: Screening, Submission draft, With client, Interview, Offer, Parked.
- FlowRun: one execution of a flow against one candidate, with step state.
- ModuleEntitlement: which modules a tenant has enabled, per subscription.

The candidate record is the single source of truth. Every module reads and
writes it. No module keeps a private copy of any candidate field.

## 6. Security and trust architecture

- Quarantine pipeline (L1): document ingestion runs extract, sanitize,
  structure. Injection attempts (instructions detected in document content)
  are logged with the document, shown to the recruiter as a flag, and never
  executed. Build a red-team corpus of malicious resumes and transcripts as
  a CI suite. Every release must pass it.
- Projection layer (L2): server-side per-role projections of every entity.
  The candidate API surface physically cannot return internal fields.
  Enforce with contract tests, not code review.
- Prompt custody (L3): flow definitions stored versioned in the database,
  deployed server-side. Diff and rollback like code.
- Retention: per-tenant policy, default 6 months for audio, applied by a
  scheduled job. Deletion propagates to derived artifacts (transcripts,
  analytics). GDPR data export and erase endpoints per data subject.
- Recording indicator: four simultaneous signals per the design language
  (pulsing dot, outline, the word, aria-live announcement).

## 7. RBAC

Login decides the application. Three roles:
- Candidate: own journey, own sessions (all), own gap list phrased as tasks,
  own Candidate Introduction. Never: recruiter notes, internal fields,
  other candidates, flags with severity labels.
- Recruiter: tenant pipeline, verified sessions and insights, flags with
  actions, submission builder, internal notes for their candidates.
- Admin: plus flow builder, module entitlements, retention settings, audit
  viewer, user management.

## 8. Modules (launch set)

Recruiter app: Pipeline, Interview Screener, Submission Builder, Notes.
Candidate app: My Journey, Resume Studio, LinkedIn Studio, Interview Practice,
My Gaps.
Admin: Flow Builder, Modules, Audit, Billing.

Modules are independently subscribable. A tenant can run one module alone.
Rail navigation shows only entitled modules. Module code is isolated:
a module may call the spine, never another module.

## 9. Flow engine

Three primitives, matching the platform pitch:
- Flow: a multi-step state machine (typed inputs, tool grants, output
  schema per step, guardrails). The four reference prompts become flows.
- Agent: a role with scoped authority and server-side prompt custody.
- Skill: a shared capability library (STAR evaluation, cross-verification,
  date consistency, layout QA, em dash lint). Skills upgrade once and
  propagate to every flow that uses them.

FlowRuns are resumable, auditable, and constrained: one candidate per run,
enforced by the runtime, not the prompt.

## 10. Flow contracts (ported from the reference prompts)

Submission Builder: intake check against required sources; cross-source
verification of every title and date; conservative, internally consistent
version on conflict, discrepancy flagged to notes; five-part executive
summary; single-role date exception (identical dates render once, on the
company line); deterministic QA checklist on generated output; compensation
expectations in the client email, current compensation in notes only.

Interview Screener (verified mode): 8 to 12 competency questions drawn from
the JD and story bank; STAR evaluation with targets 15, 10, 50, 25; one
follow-up per answer maximum; feedback after each answer; session debrief
as a copyable text block; metrics confirmed verbally are confirmed back
before use.

Resume Studio: one role per session, most recent first; era-based depth
(recent 5 to 7 bullets, mid 3 to 4, older 2 to 3); probing until owned,
action, and outcome exist; handoff as a text block with bold lead phrases,
never spoken; fresh session per role.

LinkedIn Studio: the completed resume is the source of truth; titles,
companies, and dates match exactly; six sections delivered one at a time;
claims trace to resume bullets or are omitted.

## 11. Design language: Certainty (binding)

- Achromatic base. Exactly four semantic hues: positive, warning, blocking,
  recording. Focus ring blue means focus only, never anything else.
- The certainty mark: one 12px device, four states, used wherever evidence
  appears. Always paired with a word.
- Internal-only regions render on the inverse stage ground, so a leak into
  the candidate app looks broken. This is an RBAC enforcement mechanism.
- Reveal-on-approach is the only hover effect. Space reserved, no reflow,
  element stays in the a11y tree.
- The recording indicator is the only saturated, animated element. One
  orchestrated moment: the consent modal. Nothing else moves.
- Radius by role: 0 structural, 3px controls, 6px sheets, pill only for
  recording and mode toggle. Hairlines over shadows. No card shadows.
- Dark mode via the tokens. Never invent a color value; consume tokens.
- Anti-pattern list from the design language doc is binding: no brand hue
  actions, no tinted severity boxes, no all-caps labels, no emoji, no
  centered text outside empty states, no color as sole meaning carrier.

## 12. Billing and entitlements

Per-module subscription per tenant, monthly. ModuleEntitlement gates rail,
API, and flow access. Metered usage (voice minutes, generations) recorded
per tenant. Stripe. A disabled module hides its UI and API but never deletes
spine data.

## 13. Integrations

Phase one: Bullhorn (open API, marketplace listing path). Then Vincere,
Loxo. Sync direction: stage changes and submission artifacts push out;
candidate record remains authoritative in Certainty. Integration failures
degrade to manual export, never to data loss.

## 14. Build order and exit criteria

P0 Foundation: repo, CI, auth, tenancy, token pipeline wired to tokens.css.
Exit: two apps render login and empty states in both color schemes.
P1 Spine: entities, projections, audit, stage machine, seed scenario.
Exit: the 8 prototype acceptance criteria pass as automated tests.
P2 Quarantine and flow engine: ingestion pipeline, prompt custody, flow
runtime, red-team corpus. Exit: malicious resume test passes in CI.
P3 Recruiter modules: pipeline, screener insights, flags, notes, builder.
Exit: end-to-end submission generated for the seed candidate, QA checklist
green, internal fields provably absent from candidate API responses.
P4 Candidate modules and voice: Interviewer flows, consent, verified voice
sessions, handoff blocks. Exit: recorded session with transcript,
timecodes, STAR metrics, and debrief.
P5 Billing, admin, ATS sync. Exit: a second tenant runs one module only,
isolated, billed.
P6 Hardening: pen test, GDPR audit, load test, retention jobs.
Exit: security sign-off.

## 15. The demo scenario (permanent smoke test)

The fictional seed: Nadia Rowe, Senior Software Engineer, target FinTech.
One verified session with STAR data, one of each flag type, a source
conflict (snapshot 10/2022 vs CV 10/2020, conservative version used), a
confirmed 30% metric, one JD must-have unevidenced. The full loop must run:
recruiter feeds the claim flag to the candidate app, candidate resolves the
gap, recruiter generates the submission, QA passes, stage advances. This
scenario is the north star. If a regression breaks it, the build is broken.

## 16. What you never do

- Never put client-derived or real names in code, docs, or tests.
- Never ship prompt text, internal fields, or raw ingested documents to a
  client.
- Never let a model see unsanitized document text.
- Never record without a consent record.
- Never add an unrequested feature, hue, animation, or module.
- Never write an em dash or an emoji into a product string.
- Never fragment the spine. Focused apps, one memory.

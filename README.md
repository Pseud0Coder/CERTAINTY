# Certainty

A recruitment evidence platform. It separates what a candidate claimed from
what has been verified, and enforces that separation with architecture, not
prompt text.

- Product contract: `docs/master-build-prompt.md` (binding)
- Agentic runtime: `docs/addendum-a-agentic-runtime.md` (binding)
- Design language: `docs/design-language.md` + `tokens.css` (single visual source)
- Flow contracts, sanitized: `docs/reference-flows.md`
- Decisions: `docs/adr-log.md`

## Run

```bash
npm install
npm run build:web   # compiles the TS clients and syncs html/css into web-dist
npm start           # serves http://localhost:8331 (seeds the demo scenario on first boot)
npm test            # unit, projection-contract, red-team, golden-transcript, intelligence and scenario tests
npm run typecheck   # server, spine and browser projects
```

`/` is the public marketing page (scrollytelling, real screenshots of the
demo, pricing); `/login` is the sign-in form for the three apps below
(ADR-0017). It runs its own small design system (`src/web/marketing.css`),
a bold poster register sharing the product's own hue family rather than a
copy of the app's dark-academia UI.

## Intelligence

Agents call a real model when one is configured, and run their
deterministic scripted implementation when one is not (ADR-0005, ADR-0012).

```bash
cp .env.example .env      # then paste an OpenRouter key into OPENROUTER_API_KEY
npm start                 # logs the selected provider on boot
```

The default model is `z-ai/glm-5.3-flash` via OpenRouter. With no key, a
blank key, or `CERTAINTY_LLM=off`, the scripted provider is selected and the
demo behaves exactly as before. The test suite constructs the Engine without
a provider, so it stays deterministic and never reaches the network.

What the model is allowed to do is a deliberate split (ADR-0012):

| Model writes it | Deterministic, always |
|---|---|
| research findings, judged by meaning | STAR proportions, ownership, trailing counts |
| resume probes and bullet text | cross-source conflict detection |
| interview questions and feedback wording | the CV assembler and the QA checklist |
| LinkedIn sections | stage advice and every journey gate |
| the client-facing executive summary | tenant isolation and the projection layer |

An audited number that moves between identical runs is not a measurement,
and a gate a model can talk its way through is not a gate.

Everything the model returns passes three guards before it can reach the
spine: typographic repair for L8, shape validation, and number grounding,
which rejects the whole output if it states a figure that is not in the
supplied evidence (L5). Any failure falls back to the scripted producer,
and the flow trace records which producer served the step, so a fallback is
visible in the admin flow inspector rather than silent.

Light and dark mode via the toggle in every topbar (persisted per browser);
a dark-academia palette, aged parchment and oak in light mode, a
candlelit study in dark mode, brass as the one accent hue (ADR-0006,
ADR-0015).
The reference prompts’ persona branding is proprietary to another party and
appears nowhere in the project; the flows are named Resume Studio and
LinkedIn Studio, and the interviewer is simply the Interviewer (ADR-0007).

Demo accounts (password `certainty-demo`), all data fictional:

| Account | Role | App |
|---|---|---|
| `admin@gennext.demo` | admin | /app/admin (audit, modules, usage, flows) |
| `recruiter@gennext.demo` | recruiter | /app/recruiter (pipeline, builder, notes) |
| `nadia@gennext.demo` | candidate | /app/candidate (dashboard, studios, split-screen interview, to-do) |

A second tenant (`recruiter@northgate.demo`, pipeline module only) exists to
prove isolation and single-module subscription.

## The candidate journey

The platform walks one gated chain, one source of truth, agents wired into
the transitions (ADR-0009):

0. **Profile Agent.** Recruiter enters the candidate email, optionally the
   client job description and the CV file; the agent creates the profile and
   a temporary password, shown to the recruiter once. The candidate must
   replace it at first sign-in (the server refuses every other route until
   they do), so the recruiter never knows the real password.
1. **Onboarding.** The CV is uploaded once, as a PDF or Word file, by
   whoever has it first; everything later reuses it. The candidate confirms
   what was read (roles, dates, bullets), adds a LinkedIn URL or profile
   text, and supplies the target and job description only if the recruiter
   has not.
2. **Research Agent** runs on submit and writes the research report: good,
   improve, needs work, every finding evidence-bound. Private interview
   practice opens at this point.
3. **Resume Studio.** One session per role, each role with its own
   interviewer; the role assist probing runs until owned, action, and
   outcome exist per bullet.
4. **CV assembler.** Fires when a role run completes; the revamped CV is
   written only when every role has a completed handoff.
5. **LinkedIn Studio** unlocks after all roles and writes six sections,
   each saved as it is written. The **verified interview** unlocks once the
   CV exists and LinkedIn is complete; practice is private and open since
   step 2. Verified sessions are shared with the recruiter plus suggested
   gaps.
6. **Profile page.** A one-page insight for the target company: each JD
   requirement with its evidence and source (CV, verified interview, GitHub,
   LeetCode), marked claimed or verified, plus achievements, connected-account
   work, interview proportions and the CV download. Nothing is shared until
   the candidate approves; an approval lasts 30 days and either side can
   stop it.

Every gate is enforced server-side and mirrored in the UI with the unlock
condition stated.

## Documents and connectors (ADR-0022)

- **CV and JD files.** PDFs are read locally by LiteParse
  (`@llamaindex/liteparse`, Apache 2.0, prebuilt binaries for macOS, Linux
  and Windows; no network, no OCR). Sidebar layouts are read column by
  column. Word files are read directly from their XML, so no LibreOffice is
  needed. Scans with no text layer are refused with a clear message. Parsed
  text goes through `quarantine()` like any document, then a structurer that
  handles real-world headings, date formats and two-line role headers.
- **Connectors.** GitHub (public REST) and LeetCode (its public GraphQL
  endpoint). Linking is consented (`connect:<provider>`) and counts as a
  claim; a one-time code placed in the account's public bio proves
  ownership. Fetching is allowlisted per host, redirect-free, time and size
  bounded; fetched text is sanitized. Disconnecting withdraws the consent and
  deletes the data. Set `GITHUB_TOKEN` to raise GitHub's anonymous rate limit.

## Voice sessions (L4, ADR-0020)

Verified voice runs on LiveKit and is gated by a server-side consent chain:

1. The candidate starts the screener flow, which parks at the consent gate.
2. Granting consent stores a ConsentRecord and creates the verified session.
3. Only then can a room token be minted (`POST /api/candidate/livekit/token`
   with the run id). Every other request is refused with no token.
4. The webhook (`POST /api/webhooks/livekit`) is verified against the raw
   body with the SDK WebhookReceiver; unsigned requests are 401 and never
   parsed. Ingestion requires an active consented session, and every artifact
   carries its sessionId and consentId.
5. Withdrawal, mode switches, navigation and unload all run one cleanup:
   the microphone stops, the room disconnects, and the recording indicator
   clears. Ingest after withdrawal is refused.

The fix was verified by a pre-registered experiment with raw probe outputs:
`experiments/2026-09-28-p0-voice-consent-webhook-auth/`.

## Demo scenario (permanent smoke test)

Nadia Rowe, fictional Senior Software Engineer. One verified session with STAR
data, one suggestion of each type, a source conflict (snapshot 10/2022 against
CV 10/2020, conservative version used), a confirmed 30 percent metric, one JD
must-have unevidenced. The full loop runs: AI evaluation proposes suggested
gaps, the recruiter approves them into the candidate To-Do, the candidate
resolves the gap, recruiter generates the submission through the builder, the
deterministic QA checklist passes, and the stage advances by human action.
`tests/scenario.test.ts` enforces all of it.

## Architecture

```
src/
  spine/            one shared spine. No module keeps a private copy.
    intelligence.ts model-backed producers, with the guards and the
                    scripted fallback that make them safe (ADR-0012)
    providers/
      llm.ts        the only code that talks to a model. OpenRouter plus
                    the fail-closed scripted provider
    journey.ts      the gated candidate journey, derived, never stored twice
    profile.ts      the Profile Agent: recruitment provisioning
    types.ts        entities (tenant, candidate, session, flag, artifact,
                    consent, audit, flow run, entitlements)
    db.ts           storage. Tenant isolation enforced at the query layer (L9)
    projections.ts  role projections. The candidate surface physically cannot
                    return internal fields (L2), enforced by contract tests
    quarantine.ts   ingest pipeline: extract, sanitize, structure (L1)
    contracts.ts    output contracts: em dash lint, emoji lint, caps lint,
                    compensation scrubber, date consistency (A7)
    stages.ts       stage machine. Humans advance, agents suggest (A9)
    agents.ts       deterministic agent implementations (scripted provider)
    pipeline.ts     event-triggered pipeline agents (A1)
    seed.ts         the demo scenario
    billing.ts      module entitlements, usage meters, invoice projection
    retention.ts    retention job, GDPR export and erase
    flows/
      defs.ts       the four launch flows, versioned
      engine.ts     FlowRun state machine, retries, human gates, tracing
      tools.ts      tool layer: allowlists, idempotency, fail closed (A4)
      prompts.ts    prompt custody, server-side only (L3)
  server/           node:http API, auth (scrypt, HttpOnly sessions, CSRF),
                    RBAC, SSE event bus, static serving, security headers
  web/              TypeScript ES module clients compiled by tsc (ADR-0003),
                    consuming tokens.css with no invented color values and
                    no inline style attributes, which the CSP blocks (ADR-0013)
    marketing.html/.css, marketing/main.ts
                    the public page at "/": its own design system, real
                    screenshots under img/, scrollytelling with no
                    external library (ADR-0017)
tests/              projections, quarantine red-team corpus, contracts and
                    golden transcripts, demo scenario, auth, and the
                    intelligence guards and provider transport (ADR-0012)
```

## The laws in code

- L1 quarantine pipeline with a red-team corpus in CI (`tests/quarantine.test.ts`)
- L2 projection-gated internal fields (`tests/projections.test.ts`)
- L3 prompt custody, server-side, with a leak probe run against the API
- L4 consent gate as a human gate step for verified capture, enforced by the
  runtime; practice sessions skip it because they never record
- SuggestedGaps approval gate: AI evaluation proposes, the recruiter approves,
  only then does a candidate task exist (ADR-0007)
- L5 evidence rules as flow contracts; a failed contract is a run error,
  and model output is rejected whole if it states a figure absent from
  the evidence (`tests/intelligence.test.ts`)
- L6 append-only audit on every mutation, viewable in the admin app
- L8 string rules enforced by the output contract layer
- L9 tenant id always from the session, parameterized into every query
- A0 agents produce state; dashboards render state over the event bus (SSE)
- A5 FlowRun retries bounded at 2, then a visible error with a human resume path

Providers (LLM, STT, TTS, Stripe) sit behind interfaces and fail closed
without keys; the scripted provider runs the demo deterministically (ADR-0005).

# CERTAINTY - Handoff Document

Date: 2026-09-28
Repository: `https://github.com/Pseud0Coder/CERTAINTY` (branch `main`)
Production: `https://certainty-8efb.onrender.com/`
Local path in the origin workspace: `LearningRND/notProjectAbhigyan/CERTAIN`
Test status at handoff: 73/73 passing (`npm test`), typecheck clean
(server + web), `npm run build:web` synced.

> Read this whole document before touching code. Then read
> `docs/adr-log.md` (21 entries, ADR-0001 to ADR-0020) and, for the newest
> work, `experiments/2026-09-28-p0-voice-consent-webhook-auth/`.

---

## 0. State of the tree at handoff (read first)

The last pushed commit is `680a47b` (self-hosted LiveKit bundle). On top of
it there is **verified but uncommitted work**:

| Path | Status | What it is |
|---|---|---|
| `src/server/livekit.ts` | new | Consent chain, webhook verification, consent-gated ingestion |
| `src/server/api.ts` | modified | Token route requires the chain; webhook handled with raw-body verification |
| `src/web/candidate/main.ts` | modified | Client consent chain, room cleanup, withdraw-and-stop |
| `src/web/vendor/livekit-client.esm.d.mts` | modified | Type stub gained `LocalTrack.stop()` and `disconnect(): Promise` |
| `tests/livekit.test.ts` | new | 12-test harness for the consent chain, signature verification, payload shapes |
| `experiments/2026-09-28-p0-voice-consent-webhook-auth/` | new | The experiment record that verifies the P0 fixes (prereg, journal, 6 runs, raw outputs) |
| `.env.example`, `.gitignore`, `README.md`, `docs/adr-log.md`, `web-dist/candidate/main.js` | modified | Documentation, env sample, rebuilt client |

**First action suggested:** review the diff, run `npm test`, then commit and
push. Production still runs the pre-fix `680a47b`; until this lands, the
consent bypass (below) is live on Render.

---

## 1. What Certainty is

A recruitment evidence platform. It separates what a candidate **claimed**
from what has been **verified**, and enforces that separation in the
architecture rather than in prompt text. Two apps over one shared spine:

- **Recruiter app** (`/app/recruiter`): pipeline, verified interview
  insights, suggested-gap review, submission builder with deterministic QA,
  internal notes on an inverse surface.
- **Candidate app** (`/app/candidate`): a gated accelerator journey
  (onboarding, research report, role-by-role resume studio, CV assembly,
  LinkedIn studio, interview, To-Do).
- **Admin app** (`/app/admin`): audit viewer, module entitlements, usage and
  invoice projection, flow definitions, users.
- Plus a marketing page (`/`), login (`/login`), and public profile pages
  (`/p/:id`, capability-UUID addressable).

Governing documents (binding): `docs/master-build-prompt.md`,
`docs/addendum-a-agentic-runtime.md`, `docs/design-language.md`,
`docs/reference-flows.md`, `docs/adr-log.md`.

---

## 2. Getting started on a new machine

Prerequisites: **Node >= 26** (the runtime uses native TypeScript type
stripping, `node:sqlite`, `node:test`), npm. No other build tooling.

```bash
git clone https://github.com/Pseud0Coder/CERTAINTY.git
cd CERTAINTY
npm install            # MUST run before build:web (vendor sync reads node_modules)
cp .env.example .env   # then fill what you have; everything is optional
npm run build:web      # tsc-compiles src/web -> web-dist, vendors LiveKit, copies html/css
npm start              # http://localhost:8331, seeds the demo on first boot
npm test               # 73 tests, offline, deterministic
npm run typecheck      # server + spine + web projects
```

Environment variables (all optional, see `.env.example`; loaded via
`process.loadEnvFile` in `src/server/index.ts`):

| Variable | Effect when missing |
|---|---|
| `OPENROUTER_API_KEY` | Scripted deterministic agents only (demo still works) |
| `CERTAINTY_MODEL` | Defaults to `z-ai/glm-5.3-flash` |
| `CERTAINTY_LLM=off` | Force scripted even with a key (tests do this implicitly) |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Voice returns `livekit_not_configured`; text mode unaffected |
| `PORT` | 8331 |

Secrets live in `.env` (gitignored). Never print key values into logs,
traces, or docs; the codebase already follows this (trace records prompt
**length**, never the body; LLM diagnostics are body-free).

Demo accounts (password `certainty-demo`), all data fictional:

| Account | Role | Notes |
|---|---|---|
| `admin@gennext.demo` | admin | Gennext Recruitments tenant (demo) |
| `recruiter@gennext.demo` | recruiter | Sees Nadia Rowe, mid-journey |
| `nadia@gennext.demo` | candidate | Onboarding + research done, 1 of 3 roles complete |
| `recruiter@northgate.demo` | recruiter | Second tenant, pipeline module only (isolation proof) |

---

## 3. Deployment (Render)

- Web service at `https://certainty-8efb.onrender.com`, Node runtime.
- `typescript` and `@types/node` are in `dependencies` (not devDependencies)
  because Render's `NODE_ENV=production` prunes dev deps during build.
- `web-dist/` is **committed**. The server serves from it. Any client change
  requires `npm run build:web` and committing the rebuilt `web-dist`.
- Cold start on the free tier is ~20s; warm responses are fast.
- The LiveKit Cloud webhook must point at
  `https://certainty-8efb.onrender.com/api/webhooks/livekit` (owner task).
- The webhook now requires a signature; LiveKit signs automatically once the
  API secret on Render matches the LiveKit project.

---

## 4. Architecture map

```
src/
  spine/                    one shared spine; no module keeps a private copy
    types.ts                entities: tenant, user, candidate, session, flag,
                            artifact, consent, audit, flow run, entitlements
    db.ts                   sqlite storage (node:sqlite). Tenant isolation is
                            enforced at the query layer; additive migrations
                            via Store.migrate()
    projections.ts          role projections (L2). assertNoInternalFields is
                            the recursive guard; contract-tested
    quarantine.ts           ingest pipeline: extract, sanitize, structure (L1)
    contracts.ts            output contracts: dash typography lint, emoji,
                            caps, compensation scrubber, date consistency;
                            normalizeModelOutput repairs model type crimes
    stages.ts               stage machine; humans advance, agents suggest
    agents.ts               deterministic (scripted) agent implementations
    intelligence.ts         model-backed producers + guards (ADR-0012)
    providers/llm.ts        the ONLY code that talks to a model. OpenRouter,
                            strict JSON schema, timeouts, transport retries,
                            never throws; nullProvider fails closed
    pipeline.ts             event-triggered pipeline agents (conflict
                            detector, evaluator, stage advisor, CV and
                            profile-page assemblers)
    journey.ts              the gated candidate journey, derived from the
                            spine, never stored twice
    profile.ts              the Profile Agent: provisioning + one-time password
    seed.ts                 demo scenario; fictional, self-consistent
    billing.ts              module entitlements, usage meters, invoice
    retention.ts            retention job, GDPR export and erase
    flows/
      defs.ts               the five flows (submission_builder,
                            interview_screener, resume_studio,
                            linkedin_studio, research)
      engine.ts             FlowRun state machine: retries (max 2), human
                            gates, tracing, contract enforcement
      tools.ts              tool layer: per-step allowlists, idempotency by
                            run+step+seq, fail closed
      prompts.ts            prompt custody; bodies server-side only (L3)
  server/
    index.ts                http server, security headers/CSP, SSE event bus,
                            static serving, boot (env, seed, retention)
    api.ts                  routes; projections only; CSRF on POSTs; audits
    auth.ts                 scrypt hashing, in-memory sessions, login limits
    livekit.ts              consent chain, webhook verify, voice ingestion
  web/                      TypeScript ES modules compiled by tsc (ADR-0003)
    shared/                 api client (CSRF), dom helpers, theme controller
    candidate|recruiter|admin|marketing|public-profile
tests/                      node:test, offline. Engine is constructed WITHOUT
                            a provider, so tests never touch the network
experiments/                lab-notebook experiment records (see section 8)
docs/                       binding product docs + ADR log
```

### The agentic runtime in one paragraph

Agents produce state, dashboards render state (A0). Flow runs are state
machines in code; agents never decide transitions alone; completion
declarations are validated; retries are bounded; human gates (consent, stage
advance, submission generation) are runtime-enforced (A9). The intelligence
layer decides what the model may write (language and judgment: research
findings, probes, bullet text, feedback wording, LinkedIn sections,
executive summary) and what stays deterministic (STAR metrics, ownership,
trailing counts, conflict detection, CV assembly, QA, all gates). Every
model output passes three guards: typographic repair, shape validation, and
**number grounding** (any figure absent from the supplied evidence rejects
the whole output). Failures fall back to the scripted producer; the trace
names which producer served each step.

### Voice pipeline (newest, most fragile)

- **Token:** `POST /api/candidate/livekit/token {runId}`. The only path is
  `voiceChain()`: a verified `interview_screener` run of the same candidate
  whose consent record is granted, not withdrawn, with a verified session
  that is not stopped. The token embeds `{candidateId, sessionId,
  consentId}`. Anything else is refused (409 `consent_required`).
- **Journey gate applies first:** candidate-initiated screener starts are
  blocked (409 `interview_locked`) until the journey unlocks the interview
  (CV complete + LinkedIn complete). The seeded demo candidate is
  intentionally locked; probes that need the chain pre-condition this
  (see the experiment scripts).
- **Webhook:** `POST /api/webhooks/livekit`. Public endpoint, but
  signature-verified against the **raw body** with the SDK
  `WebhookReceiver` (HS256, `iss` = API key, `exp` required, `sha256` claim
  = base64 SHA-256 of the body). Unsigned -> 401, nothing parsed.
- **Ingestion:** candidate resolves from JSON-string or object
  `participant.metadata`, then room name `interview-<candidateId>`, then
  `data.candidateId`. Artifacts are written only inside an **active**
  consented verified session (named sessions must themselves be active),
  with `sessionId`, `consentId`, `source` on every artifact; bullets cap at
  50, fields 400 chars, note 2000 chars; ingestion is audited
  (`voice_artifacts_ingested`).
- **Withdrawal:** `POST /api/consents/:id/withdraw` stops the session, flags
  downstream artifacts, and then blocks both token re-mint and ingestion.
- **Client:** verified start runs the chain (start flow -> grant consent ->
  mint token -> connect). One `stopVoice` cleanup stops the track,
  disconnects the room and clears the indicator on withdrawal, mode switch,
  navigation, and `beforeunload`.

---

## 5. The laws in code (verify before you break)

| Law | Where enforced | Test |
|---|---|---|
| L1 quarantine; documents are data | `spine/quarantine.ts`, red-team corpus | `tests/quarantine.test.ts` |
| L2 internal fields projection-gated | `spine/projections.ts` + API serialization | `tests/projections.test.ts` |
| L3 prompt custody server-side | `flows/prompts.ts`; traces store length only | API leak probe in README/suite |
| L4 consent before recording | `server/livekit.ts` + engine consent gate | `tests/livekit.test.ts`, `tests/scenario.test.ts` |
| L5 evidence rules; no invented metrics | `spine/contracts.ts` + intelligence guards | `tests/contracts.test.ts`, `tests/intelligence.test.ts` |
| L6 audit everything | `Store.audit` on every mutation | admin app + suite |
| L8 string rules (no emoji/em dash in product strings) | contracts + normalizeModelOutput | `tests/contracts.test.ts` |
| L9 tenant isolation at the query layer | every `Store` method | `tests/scenario.test.ts` |
| A5 bounded retries + human resume | `flows/engine.ts` | flow tests |
| SuggestedGaps: AI proposes, recruiter approves, only then a To-Do task | flag review queue + `api.ts` approve action (ADR-0007) | `tests/scenario.test.ts` |

---

## 6. Conventions and discipline (non-negotiable for this repo)

1. **ADR log is append-only in spirit.** Every architectural decision lands
   in `docs/adr-log.md`. Corrections append with a note (see the 0018 -> 0019
   renumbering note). Read ADR-0012 (intelligence split) and ADR-0020
   (voice consent) before touching agents or voice.
2. **Experiment-log discipline for fixes and model work.** The repo contains
   `experiments/<date>-<slug>/` records with `prereg.md` (pre-registered
   falsifiable hypotheses), `journal.md` (append-only; DEVIATION entries for
   every plan change), `runs/` (immutable JSON + hashes) and `data/raw/`
   (verbatim outputs). Helper:
   `/Users/pragyan_fello/.bb/runtime/global-skills/.../experiment-log-skill/scripts/exp.py`
   with `init`, `log-run`, `digest`, `verify`. Do not edit hashed scripts or
   raw data; supersede with new numbered files.
3. **Strings:** no emoji, no em dashes in any product string or generated
   content. Sentence case. Tabular numerals in data regions.
4. **Styling:** consume `tokens.css`; compose with classes (utility classes
   and CSSOM `setWidthPct` for data-driven widths). Do not hand-write colors.
   CSP note: `script-src 'self'` (never inline scripts; that is why the
   LiveKit bundle is self-hosted), styles currently allow `'unsafe-inline'`
   for the marketing page's font stack; do not rely on it for app chrome.
5. **Secrets:** never print, log, trace or commit key values.
6. **Tests:** offline and deterministic; `Engine` is constructed without a
   provider by default. New behavior needs a test; fixed bugs get a
   regression test (see `tests/livekit.test.ts` for the pattern).
7. **web-dist is committed.** After any client change: `npm run build:web`,
   then commit the rebuilt assets.

---

## 7. Open items (prioritized)

### P1 - finish the voice loop (the next experiment)

Voice is now safe but not complete. `ingestVoicePayload` writes linked
artifacts, but there is no `InterviewSession` completion for voice: no
transcript view, no STAR metrics, no debrief-as-session, and the recruiter's
suggestedGaps pipeline is not fed from voice. Design sketch: handle a
LiveKit `session_end` (or agent-completion) event, close the session through
the screener flow's `evaluate` and `suggest` steps so
`agentSessionEvaluator` and the stage advisor run exactly as they do for
text, and render the debrief in the candidate and recruiter apps. This
should be a new pre-registered experiment following the same pattern as
`2026-09-28-p0-voice-consent-webhook-auth`.

### P2 - the Connector + Retrieval pipeline (partly built 2026-10-01, ADR-0022)

> Update: CV/JD file upload (LiteParse), GitHub and LeetCode connectors with
> bio-code ownership proof, and the one-page profile insight are built; see
> ADR-0022. Still open below: the Retrieval Agent, connector evidence in the
> research report and suggested-gap queue, LinkedIn OAuth, manual portfolio
> projects, and a pre-registered parser comparison on real CVs.

Portfolios is a placeholder page today. The agreed plan (summarized from the
planning session; refine before building):

- **Spine:** new artifact kinds `connector_link` (state), `connector_snapshot`
  (evidence), `portfolio_project` (manual); consent scope `connect:{provider}`
  per link; disconnect = withdrawal + snapshot deletion + audit; GDPR
  export/erase extended to connector artifacts.
- **Connector layer** (`src/spine/connectors/`): `Connector` interface + a
  sandboxed fetch client (per-provider domain allowlist, timeouts, size caps,
  no off-domain redirects, server-side only). Providers: GitHub (public
  REST), LeetCode (public GraphQL), manual portfolio projects (no link
  fetch in phase 1), LinkedIn (keep link + pasted snapshot; OAuth OpenID in
  phase 3; never scrape).
- **Every fetched payload goes through `quarantine()`** before storage or
  model contact (READMEs are prime injection terrain); injection attempts
  become quarantine events + recruiter flags (existing machinery).
- **Retrieval Agent:** new `retrieval` flow; normalizes snapshots into
  evidence signals, portfolio highlights, and suggested gaps through the
  existing recruiter review queue. Research Agent's corpus extends to
  connector evidence so findings can cite it.
- **API/UI:** connect/sync/disconnect routes (journey-gated), Portfolios
  page with connector cards and manual projects; recruiter evidence panel;
  public profile projects section later.
- **Phases:** P1 GitHub + manual portfolio; P2 LeetCode + research
  integration; P3 LinkedIn OAuth + resume-studio project pull.

### P3 - smaller carried items

- STT/TTS adapters for true voice (currently WebRTC audio only; no speech
  recognition) - the intelligence layer's wording is text.
- `lastProducer` in `Engine` is instance state; safe today because `trace()`
  runs without an intervening await, but move it per-run when convenient.
- Number-grounding treats single digits and years as benign; "3x" style
  fabrications could slip through. Consider tightening to multi-digit or
  context-bounded numbers.
- Marketing page runs a separate design system (ADR-0017); keep it isolated.
- Public profile pages are capability-UUID addressable by design; revisit if
  enumeration resistance needs to be stronger.

---

## 8. The experiment record for the newest work

`experiments/2026-09-28-p0-voice-consent-webhook-auth/`:

- `prereg.md` - Q0, three falsifiable hypotheses (H1a consent chain, H1b
  signed + consent-gated webhooks, H1c payload resolution), design, stopping
  rule, materials.
- `journal.md` - append-only: Q0, H1, D1, M1, four DEVIATION entries (probe
  corrections and one real code loophole the experiment caught), runs
  R001-R006, A1 analysis, I1 interpretation, C1 conclusion.
- `runs/R001-R006.json` + `index.jsonl` - immutable, hash-verified
  (`exp.py verify` reports ok).
- `data/raw/*.txt` - verbatim probe outputs with recorded SHA-256s.
- Repro scripts (hashed): `repro_baseline*.sh`, `repro_postfix*.sh`,
  `sign_webhook.mjs` (mints LiveKit-contract webhook JWTs for tests).

Baseline facts worth remembering: pre-fix, a no-chain token request
returned 200 with a token, and any authenticated platform user could inject
artifacts unsigned (anonymous is blocked by the global auth gate; CSRF is
no defense against the attacker's own session). Post-fix, every
pre-registered prediction holds.

---

## 9. Suggested reading order for the next agent

1. This document.
2. `README.md` (run + intelligence + journey).
3. `docs/adr-log.md` - at minimum ADR-0003, 0005, 0007, 0009, 0011, 0012,
   0013, 0018, 0019, 0020.
4. `experiments/2026-09-28-p0-voice-consent-webhook-auth/journal.md` - the
   complete record of the most recent work.
5. `src/spine/flows/engine.ts` then `src/server/livekit.ts` - the two files
   where behavior is most tightly enforced.
6. `tests/` - read the scenario and livekit suites; they are the executable
   specification.

---

## 10. Immediate checklist for resuming elsewhere

- [ ] Clone, `npm install`, `npm run build:web`, `npm test` (expect 73/73).
- [ ] Decide and execute: commit + push the uncommitted P0 fix and the
      experiment record; redeploy Render so production gets the consent
      chain.
- [ ] Provide `LIVEKIT_*` and `OPENROUTER_API_KEY` on the new host if voice
      and model-backed agents are wanted (both optional).
- [ ] Point the LiveKit Cloud webhook at the deployment and send one test
      event; expect 200 from a correctly signed request, 401 otherwise.
- [ ] Start the next experiment (voice session completion, section 7 P1)
      with a fresh `prereg.md` before writing code, per section 6.

# Experiment 2026-09-28-p0-voice-consent-webhook-auth

## Q0 - Question

Can the three P0 defects in the voice pipeline be fixed such that
(a) no LiveKit token is minted without an active ConsentRecord,
(b) no webhook-claimed artifact enters the spine without a verified LiveKit
signature, and
(c) the webhook resolves the candidate from real LiveKit payload shapes
(participant metadata is a JSON string; room events carry the room name)?

## Background

Prior results in this repo (all SOURCED from code + handoff):

- SOURCED: `showConsentModal()` in `src/web/candidate/main.ts` connects a
  LiveKit room and publishes a microphone track after a checkbox, with no
  server-side ConsentRecord created. The token endpoint
  (`src/server/api.ts`, `POST /api/candidate/livekit/token`) mints a room
  token for any authenticated candidate with no consent check. This violates
  law L4 ("Consent before recording. There is no override.").
- SOURCED: `POST /api/webhooks/livekit` performs no signature verification
  (no WebhookReceiver, no Authorization check), and writes artifacts into a
  tenant resolved from an unchecked `candidateId` in the request body.
- SOURCED: the same handler reads `body.participant?.metadata?.candidateId`;
  the token mints metadata as `JSON.stringify({candidateId})`, so real
  LiveKit payloads carry a string and the object access yields undefined.
- SOURCED: `livekit-server-sdk@2.19.1` `WebhookReceiver` verifies an HS256
  JWT with `iss` = API key, requires `exp`, and compares the `sha256` claim
  against base64(SHA-256(raw body)).

## Scope

In scope: token minting, webhook verification and ingestion, client consent
chain, replay/withdraw behavior, tests, records.

Out of scope: STT/TTS providers, transcript capture, STAR evaluation of voice
sessions, UI redesign, connector pipeline.

## H1 - Hypotheses (pre-registered)

Three sub-hypotheses, each falsifiable.

### H1a - Consent gate on token minting

- H1a: After the fix, minting a LiveKit token requires a verified
  `interview_screener` run for the same candidate whose `_consent` record is
  active (not withdrawn) and whose `_session` exists with mode `verified`;
  every other request is refused with no token.
- H0a: Token minting remains possible without any of those conditions.
- Prediction: baseline probe P1 returns a token (H0a); post-fix probe P1
  returns 409 `consent_required`, and the full chain probe P1c returns a
  token only after `grantConsent`.
- Falsification: any post-fix probe returns a token without the chain, or the
  full chain probe is refused.

### H1b - Authenticated webhook ingestion

- H1b: After the fix, an unsigned or badly signed webhook is refused
  (401) and writes zero artifacts; a correctly signed webhook whose target
  candidate has no active consented verified session is refused (409) and
  writes zero artifacts; a correctly signed webhook with an active consented
  session ingests bullets and note with `sessionId` and `consentId` recorded
  on every artifact.
- H0b: unsigned requests continue to write artifacts.
- Prediction: baseline probe P2 creates an artifact from an unsigned request
  (H0b); post-fix P2a/P2b write nothing (401/409), P2c ingests with the
  linkage fields set.
- Falsification: an unsigned post-fix request creates an artifact, or a
  signed in-consent request is refused.

### H1c - Payload resolution

- H1c: After the fix, the webhook resolves the candidate from (in order)
  `participant.metadata` parsed as JSON when it is a string, the room name
  `interview-<candidateId>`, and an explicit `data.candidateId`; malformed
  input is refused 400 with no writes.
- H0c: string metadata continues to yield `missing_candidate_id`.
- Prediction: baseline probe P3 returns 400 (H0c); post-fix P3 resolves and
  ingests (given an active consented session), and a no-candidate-id probe
  returns 400.
- Falsification: a valid string-metadata or room-name payload fails to
  resolve after the fix.

## Primary outcomes (declared now)

One primary outcome per sub-hypothesis, measured by scripted HTTP probes
against a locally booted server with fake LiveKit credentials and a demo
database; plus the project test suite result.

- P1: HTTP status and presence of a token field for a no-chain request.
- P2: artifact count delta for the candidate after an unsigned webhook.
- P3: HTTP status and error code for a string-metadata webhook.

Secondary: full-suite pass/fail and count; typecheck status; exact raw
outputs stored under `data/raw/`.

## Stopping rule

Fixed n = 1 execution of `repro_baseline.sh` (pre-fix) and n = 1 execution of
`repro_postfix.sh` (post-fix), plus one full `npm test` and one
`npm run typecheck` after the fix. No re-tuning of probes after seeing
baseline data; probe scripts are written before the baseline run and hashed.
No further sampling to reach a desired outcome.

## D1 - Design

- Independent variable: code state (pre-fix commit 680a47b vs post-fix
  working tree).
- Dependent variables (operational):
  - D1.1 token_minted ∈ {yes, no} from HTTP 200 + `token` key present.
  - D1.2 artifact_delta = count(artifacts for candidate, any kind) after
    minus before the webhook call, via direct sqlite read.
  - D1.3 resolve_error ∈ {none, missing_candidate_id, consent_required,
    invalid_signature, other}, read from response JSON.
  - D1.4 linkage = presence of sessionId and consentId in ingested artifact
    fields (post-fix only).
- Controlled variables: same machine, same Node (26.8.1), same database seed
  (fresh demo seed restored from a byte-identical backup between arms), same
  fake LiveKit key/secret (`fake-key` / `fake-secret...`), same port (8391),
  same probe scripts (sha256 recorded), same demo candidate.
- Confounds and mitigations:
  - C1 server boot timing: mitigated with a readiness poll (up to 15s).
  - C2 leftover artifacts across probes: baseline and post-fix each count a
    per-probe delta, and the database is restored between arms.
  - C3 .env interference: probes pass LIVEKIT_* in the process environment
    explicitly; OPENROUTER key presence does not affect this path (noted,
    accepted).
  - C4 token verification differs from LiveKit Cloud: accepted. The SDK's own
    WebhookReceiver is the verifier in both the fix and the probes, so the
    contract under test is the SDK's, not a re-implementation.
- Control condition: the pre-fix commit (baseline arm), probed identically.
- Randomization/blinding: not applicable (deterministic endpoints); no human
  evaluator.
- Replicates: n=1 per arm per probe. Deterministic system, fixed inputs;
  a second replicate is run only if a probe output is ambiguous, and any
  such rerun is logged as a new run.
- Sample size: not statistical. This is a binary behavioral contract, and
  the pre-declared decision is direct observation of the endpoint outputs.
- Pre-specified analysis: exact status/field matching as stated in the
  predictions. Decision: H1 supported iff every prediction above holds and
  the full suite passes with zero failures.
- Smallest effect of interest: any token minted outside the chain, or any
  artifact written from an unverified request, counts as fix failure
  regardless of magnitude.

## M1 - Materials

- Code: commit 680a47b1ed0b3d86289a46ff10d00a05b33dab46 (pre-fix), working
  tree of this repository (post-fix). File hashes recorded in the journal.
- Runtime: Node 26.8.1 (darwin), npm 11.19.0.
- Libraries: livekit-server-sdk 2.19.1, livekit-client 2.22.3 (vendored
  browser bundle, untouched by this experiment), typescript 5.9.2.
- Database: sqlite at data/certain.db, fresh demo seed, backed up and
  restored byte-for-byte between arms (`shasum -a 256` recorded).
- Probes: `repro_baseline.sh`, `repro_postfix.sh` in this directory, hashes
  recorded; signer `sign_webhook.mjs` (node:crypto HS256 + base64 sha256 of
  body, mirroring the SDK verifier).
- Environment variables for probes: LIVEKIT_URL=wss://fake.livekit.cloud,
  LIVEKIT_API_KEY=fake-key, LIVEKIT_API_SECRET=fake-secret-p0-experiment,
  PORT=8391.
- No model calls are made in this experiment; the OpenRouter path is not
  exercised. The AI-run metadata reference does not apply and that is
  recorded as a NOTE.

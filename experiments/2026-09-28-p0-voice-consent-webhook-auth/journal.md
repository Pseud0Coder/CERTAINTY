# Journal: 2026-09-28-p0-voice-consent-webhook-auth

Append-only. Newest entries are added at the end. Never edit a past entry; correct it with an AMENDMENT.

## [Q0] QUESTION - P0 fixes: consent-enforced voice tokens and authenticated LiveKit webhooks
Timestamp: 2026-09-28T03:18:42Z
Author: opencode (thr_apviqng9ta)
Deviation-from-plan: none

Can the three P0 defects be fixed such that (a) no LiveKit token is minted without an active ConsentRecord, (b) no webhook-claimed artifact enters the spine without a verified LiveKit signature, and (c) the webhook resolves the candidate from real LiveKit payload shapes?

## [H1] HYPOTHESIS - three P0 defects, three falsifiable sub-hypotheses
Timestamp: 2026-09-28T03:19:38Z
Author: opencode (thr_apviqng9ta)
Deviation-from-plan: none

H1a (consent gate): after the fix, a LiveKit token is minted only for a
verified interview_screener run of the same candidate whose consent record is
active and whose session exists with mode verified; all other requests are
refused with no token. H0a: minting remains possible without the chain.
Prediction: baseline P1 yields a token; post-fix P1a/P1b yield 409 with no
token; P1c (full chain) yields a token.
Falsification: any post-fix token without the chain, or a refused full chain.

H1b (authenticated webhook): unsigned or badly signed requests are refused
401 with zero artifacts; signed requests without an active consented session
are refused 409 with zero artifacts; signed requests inside an active
consented session ingest with sessionId and consentId on every artifact.
H0b: unsigned requests write artifacts. Prediction: baseline P2 writes one;
post-fix P2a/P2b write zero; P2c writes two, linked.
Falsification: an unsigned post-fix write, or a refused signed in-consent write.

H1c (payload resolution): candidate resolution accepts JSON-string or object
metadata, falls back to room name interview-<candidateId>, then data.candidateId;
malformed input is 400 with no writes. H0c: string metadata keeps failing.
Prediction: baseline P3 is 400; post-fix P3a (string metadata) and P3b (room
name only) resolve and ingest; P3c (no identity at all) is 400.
Falsification: any valid identity form failing to resolve post-fix.

## [D1] DESIGN - pre-fix vs post-fix, scripted HTTP probes
Timestamp: 2026-09-28T03:19:38Z
Author: opencode (thr_apviqng9ta)
Deviation-from-plan: none

Independent variable: code state (commit 680a47b vs working tree).
Dependent variables: token minted (yes/no from 200 + token field); artifact
count delta per probe via direct sqlite read; resolve error code; linkage
fields on ingested artifacts.
Controlled: same host, Node 26.8.1, fresh demo seed restored byte-for-byte
between arms, fake LiveKit credentials (fake-key / fake-secret-p0-experiment),
port 8391, probe scripts hashed before the baseline run.
Confounds: server boot timing (readiness poll); residue across probes
(per-probe deltas, database restored between arms); .env interference (env
passed explicitly; OpenRouter not exercised); SDK-vs-cloud verification
difference (accepted; the SDK receiver is the verifier in both arms).
Control: the pre-fix commit, probed with identical scripts.
Replicates: n=1 per probe; deterministic endpoint, fixed inputs.
Analysis: exact-match on declared predictions; fix fails on any single
violation regardless of magnitude.
Smallest effect of interest: any out-of-chain token, or any artifact from an
unverified request.

## [M1] MATERIALS - code, runtime, probes
Timestamp: 2026-09-28T03:19:38Z
Author: opencode (thr_apviqng9ta)
Deviation-from-plan: none

Code pre-fix: 680a47b1ed0b3d86289a46ff10d00a05b33dab46.
Runtime: Node 26.8.1, npm 11.19.0, darwin.
Libraries: livekit-server-sdk 2.19.1 (verifier + token mint),
typescript 5.9.2. livekit-client 2.22.3 vendored bundle untouched.
Database: data/certain.db demo seed, backed up and restored per arm.
Probes: repro_baseline.sh, repro_postfix.sh; signer sign_webhook.mjs
(node:crypto HS256, sha256 claim = base64 of raw body hash, iss = API key,
exp required: mirrors the SDK TokenVerifier contract).
NOTE: no model calls occur in this experiment; the AI-run metadata reference
does not apply.

## [D1-DEVIATION-1] DEVIATION - baseline probes P2/P3 lacked an authenticated session
Timestamp: 2026-09-28T03:21:21Z
Author: opencode (thr_apviqng9ta)
Deviation-from-plan: D1 controlled-variable list did not specify that the webhook sits behind the dispatcher's global auth gate

Observed: the original repro_baseline.sh sent the webhook probes with no
session cookie and received HTTP 401 unauthenticated before the route was
reached (raw: data/raw/baseline-20260928T032006Z.txt). This does not test
H0b/H0c. The correct condition is an authenticated user of the platform,
because the route's role list is null and the dispatcher admits any logged-in
role. The probe was corrected with repro_baseline_auth.sh (hash in M1/R002).
No data were discarded; the 401 observation stands as a boundary fact.

## [D1-DEVIATION-2] DEVIATION - corrected probe omitted the attacker's CSRF header
Timestamp: 2026-09-28T03:21:21Z
Author: opencode (thr_apviqng9ta)
Deviation-from-plan: the amended probe covered auth but not CSRF

Observed: HTTP 403 csrf (raw: data/raw/baseline-auth-20260928T032025Z.txt).
CSRF defends against cross-site requests, not against a malicious
authenticated client, who holds a matching cookie and header for their own
session. Corrected again with repro_baseline_auth2.sh (hash in M1/R003).
The injection vector was then reproduced (HTTP 200, one artifact).

## [R001-R003] RUN - baseline arm, three probe executions
Timestamp: 2026-09-28T03:21:21Z
Author: opencode (thr_apviqng9ta)
Deviation-from-plan: R001/R002 superseded by R003 for P2/P3, per the two DEVIATION entries above

- R001 (unauth): P1 token minted with no consent, HTTP 200, token length 427
  (value redacted and recorded as a NOTE) -> H0a supported.
  P2/P3 HTTP 401 (probe gap; see D1-DEVIATION-1).
- R002 (auth, no CSRF): P2/P3 HTTP 403 csrf (probe gap; D1-DEVIATION-2).
- R003 (auth + own CSRF): P2 HTTP 200, artifact_delta 1, newest artifact
  handoff_block "Extracted Resume Bullet", created_by livekit_agent -> H0b
  supported: any authenticated platform user can inject artifacts with no
  signature and no consent. P3 HTTP 400 missing_candidate_id, delta 0 ->
  H0c supported: real string metadata is not resolved.

Raw outputs: data/raw/baseline-20260928T032006Z.txt (sha256 7f75edf4...),
data/raw/baseline-auth-20260928T032025Z.txt (sha256 e0716cfd...),
data/raw/baseline-auth2-20260928T032039Z.txt (sha256 66a603c3...).
NOTE: the P1 token value is redacted to length only. It is signed with the
fake experiment secret and grants a room that does not exist; redaction is
hygiene, not impact assessment, and the replacement data (length, presence)
is sufficient for the decision.

## [D1-DEVIATION-3] DEVIATION - post-fix v1 probe could not start the verified flow
Timestamp: 2026-09-28T03:23:52Z
Author: opencode (thr_apviqng9ta)
Deviation-from-plan: D1 did not foresee the journey gate (ADR-0011) applying to the probe candidate

Observed in R004: the seeded candidate's interview is journey-locked (cv
pending, linkedin locked), so POST /api/candidate/flows/interview_screener/
start answered 409 interview_locked and the consent chain was never
exercised through the API. The gate itself behaved correctly; the probe was
wrong. Correction (append-only, v2 script repro_postfix2.sh): pre-condition
the journey gate with direct spine writes (a cv artifact and a completed
linkedin_studio run), documented inside the script, because the journey gate
is not the variable under test.

## [D1-DEVIATION-4] DEVIATION - the named-session ingest path accepted any non-stopped status
Timestamp: 2026-09-28T03:23:52Z
Author: opencode (thr_apviqng9ta)
Deviation-from-plan: H1b requires an ACTIVE consented session; the first implementation checked only "not stopped" for a session named in the payload

Observed in R004: P2c ingested two artifacts into the seeded session whose
status is complete, because the payload named it and the code accepted any
status other than stopped. This violates the intent of H1b. Fix applied to
src/server/livekit.ts: a named session is eligible only when its status is
active; the fallback path was already active-only. The harness gained no new
test for this rule; it is covered by the tightened code path and re-verified
in R005 (P2c linked to the active session created by the chain, P3a now
resolved to that active session).

## [R004-R006] RUN - post-fix arm
Timestamp: 2026-09-28T03:23:52Z
Author: opencode (thr_apviqng9ta)
Deviation-from-plan: R004 superseded by R005 for P1b/P1c/P2c/P3a, per DEVIATION-3 and DEVIATION-4

- R004 (v1): P1a 409 as predicted; P1b/P1c blocked by the journey gate;
  P2a/P2a2 401; P2b 409; P2c 200 delta 2 but attached to a complete session
  (loophole); P3a 409 for the extraneous reason; P3b 400.
- R005 (v2, after preconditions and the active-session tighten): P1a 409,
  P1b 409, P1c 200 with token metadata ids equal to the database ids;
  P2a 401 delta 0, P2a2 401 delta 0, P2b 409 delta 0, P2c 200 ingested 2,
  both artifacts carrying sessionId and consentId; P3a 200 ingested 1 via
  room-name fallback; P3b 400 delta 0. Every pre-registered prediction holds.
- R006: npm run typecheck (clean), npm test 73/73 pass (61 pre-fix, +12 new
  harness tests), npm run build:web synced.

Raw: data/raw/postfix-20260928T032249Z.txt (sha256 03ae5ed356ec868dee32477bab717dd683c9a090262a9daf19840a410c74d3cf); data/raw/postfix2-20260928T032313Z.txt
(sha256 cdc8131ffafbb2bf4b6892152de0040c69ddc4e8c243b5165db9c9501850ba46).

## [A1] ANALYSIS - pre-registered comparisons, n and dispersion
Timestamp: 2026-09-28T03:23:52Z
Author: opencode (thr_apviqng9ta)
Deviation-from-plan: none beyond the recorded probe corrections

Token minting (H1a): pre-fix, n=1 request with no chain returned HTTP 200
and a token (len 427). Post-fix, n=3 no-chain requests (P1a empty body, P1b
run-without-consent, plus the v1 repetitions) all returned 409
consent_required with no token field; n=1 full-chain request returned 200
with a token whose iss/exp/metadata match the contract and whose sessionId
and consentId equal the database rows. Effect: 1/1 vs 0/4 out-of-chain
mints. Binary contract, exact match; no dispersion to report.

Webhook writes (H1b): pre-fix, an authenticated unsigned request wrote 1
artifact (delta 1). Post-fix, unsigned (n=1), wrong-secret (n=1) and
no-session signed (n=1) requests wrote 0 artifacts (delta 0 x3, all
refused with declared codes 401/401/409); the in-consent signed request
wrote 2 artifacts, both linked. Effect: injection delta 1 -> 0; linkage
absent -> present on 2/2 artifacts.

Resolution (H1c): pre-fix, real string metadata produced 400
missing_candidate_id (0/1 resolution). Post-fix, string metadata resolved
(n=1, delta 1), room-name-only resolved (n=1, delta 1), identity-less
refused 400 (n=1, delta 0). Effect: 0/1 -> 2/2 resolved valid forms.

Suite: 61 -> 73 tests, all passing; typecheck clean in both projects.

## [I1] INTERPRETATION - what supports H1, alternatives, threats
Timestamp: 2026-09-28T03:23:52Z
Author: opencode (thr_apviqng9ta)
Deviation-from-plan: none

H1a supported: the only path to a token now runs through voiceChain, and
every refusal reason observed matches the declared codes. Alternative
explanation: the probes could have failed to reach the endpoint at all.
Refuted by P1c returning a token with correct metadata on the same endpoint
in the same run.

H1b supported: unsigned and mis-signed requests are refused before parsing
(401), and signed requests outside an active consented session write
nothing (409), while in-consent requests write linked artifacts. Residual
threat: the SDK verifier is the trust anchor; a compromised LiveKit account
or secret would defeat it. That is accepted (the secret is the platform's
own credential) and is the standard webhook trust model.

H1c supported: all three real identity forms resolve, malformed input is
400. Residual risk: candidate ids remain the lookup key for room-name
fallback; ids are UUIDs and the ingest still requires an active consented
session, so an id alone is not sufficient to write.

Threats to validity: n=1 per probe (deterministic endpoint; declared in D1);
fake credentials (the contract tested is the SDK's own verifier, not LiveKit
Cloud); the journey precondition was written directly to the spine in v2
(documented; the gate's own behavior is covered by tests/journey.test.ts).

## [C1] CONCLUSION - the claim this evidence licenses
Timestamp: 2026-09-28T03:23:52Z
Author: opencode (thr_apviqng9ta)
Deviation-from-plan: none

The three P0 defects are fixed and verified at the API boundary: no token
without the consent chain (H1a), no artifact from unverified or
out-of-consent webhooks (H1b), and candidate resolution works on real
payload shapes (H1c). The client now performs the server chain (start,
consent, token) and routes room teardown through one cleanup path on
withdrawal, mode switch, navigation and unload, which also closes the
microphone-lifecycle bug (P1-4) and the missing withdraw control (P1-6).
This does not show: voice-session completion semantics (transcript, STAR
metrics, debrief as a session rather than loose artifacts), STT/TTS
integration, or multi-provider webhook dialects beyond the forms tested.
Next experiment: voice session completion through the screener flow's
evaluate and suggest steps, with the session closed on webhook
session_end, so recruiter insights populate for voice the same way they do
for text.

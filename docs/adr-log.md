# ADR log

Decisions made under the master build prompt rule: where something is
unspecified, choose the boring, standard option and record it here.

## ADR-0001: Reference prompts are sanitized before entering the repo

Date: 2026-09-09. Status: accepted.

Four proprietary reference prompts were supplied in chat (submission builder,
interview practice, resume studio, LinkedIn Studio). They contain agency and
founder identities, program names, brand styling values, and third-party
tooling instructions.

Decision:
- The originals are never committed to this repository and never ship to a
  client. They remain reference material in the working conversation only.
- `reference-flows.md` is the sanctioned, sanitized architectural summary.
  Removed: agency and founder names, program and course names, document
  brand values (colors, fonts, margins, cover page), platform and connector
  instructions, founder sign-off defaults.
- Retained: flow architecture, step order, gates, thresholds, output
  schemas, handoff protocol, behavioral invariants.
- Document brand styling becomes per-tenant brand configuration consumed by
  the document generator. Sign-off sender becomes a per-tenant setting.
- All numeric thresholds from the prompts become versioned constants in
  flow definitions, not prompt prose.

Consequences: the flow engine implements behavior from `reference-flows.md`
and master prompt section 10. If a rule appears in an original prompt but
not in the sanitized summary, it is raised with the product owner before
implementation.

## ADR-0002: Dev runtime is zero-dependency Node with node:sqlite

Date: 2026-09-09. Status: accepted, revisit before cloud deployment.

The default stack names Postgres, Redis, S3 and a framework server. For the
foundation build the runtime ships with zero runtime dependencies:
node:http, node:sqlite, node:test, node:crypto. The schema is written to be
Postgres-portable (normal types, no SQLite-specific tricks beyond the
driver), and all spine access goes through one storage module, so swapping
the driver for Postgres is a contained change. Redis (event bus fan-out) and
S3 (audio, document blobs) are behind interfaces with in-memory and local
disk implementations. Frameworks (Fastify) and the pg driver are introduced
when the project moves to a hosted environment.

Consequences: single-process dev deployment, WAL mode for concurrent reads.
Production deployment requires the driver swap plus Redis and S3 adapters.

## ADR-0006: Design language evolves toward Notion, pastel accents, theme toggle

Date: 2026-09-10. Status: accepted. Supersedes the achromatic-only constraint
per product owner direction.

Product owner review of the first production build:
- The pure achromatic system read as government software, not a sellable
  product. More color and flair was requested.
- The reference aesthetic is Notion: warm neutrals, soft rules, quiet
  surfaces, generous radius, understated hover states.
- Pastel shades in light mode. Dark mode with matching deep accents.
- A manual light/dark toggle, persisted per browser.

Decisions:
- tokens.css restructured onto [data-theme="light" | "dark"]. All component
  color still comes from tokens; the pastel set (blue, green, yellow, orange,
  red, purple, pink, each with a matching ink) is the sanctioned palette.
- The interactive accent is a single brand blue; severity roles map onto the
  pastel set (positive green, warning orange, blocking red). Focus keeps its
  own blue. The recording indicator stays the one saturated animated element.
- View titles carry a small accent mark as the one recurring flourish.
- The certainty mark, severity spines, reveal-on-approach, the orchestrated
  consent modal, and the anti-pattern list remain binding.

## ADR-0007: Third-party persona branding removed; suggestedGaps approval gate

Date: 2026-09-10. Status: accepted.

Two product owner decisions:

1. The interviewer persona branding of the reference prompts is proprietary
   to another party and is removed from the entire project: code, docs, seed
   data, UI, and the persona name itself. Mapping: the resume flow is now
   Resume Studio, the LinkedIn flow is now LinkedIn Studio, and the
   interviewer speaker is named Interviewer. Flow ids are resume_studio and
   linkedin_studio. The reference prompt summary in reference-flows.md keeps
   its behavioral content under the new names. The term does not appear
   anywhere in this repository, including this log.

2. Candidate tasks are never auto-populated from AI assessment. The
   evaluation pipeline writes suggestions (suggestedGaps) that land in a
   recruiter review queue. Only a recruiter approval converts a suggestion
   into a candidate To-Do item; discards resolve the suggestion. This
   replaces the gap projector row of Addendum A section A2: the event
   agent is removed and the recruiter approval action is the human gate.
   The candidate To-Do nav item carries an orange badge with the open count.

## ADR-0008: Candidate information architecture

Date: 2026-09-10. Status: accepted.

Per product owner direction, the candidate rail is restructured:
Dashboard replaces My Journey, and carries the target role as an expandable
group (My Resume, LinkedIn, Portfolios; Portfolios ships as a declared
placeholder). Interview is the next major header with the sessions view.
The interview view is a split screen: left pane carries the chat agent with
a voice toggle (text mode until speech providers are configured), right pane
is a scratchpad reserved empty until the product owner defines it. Practice
sessions are private and give the candidate improvement suggestions; verified
sessions are shared with the recruiter together with the suggested gaps.
Practice screener sessions skip the consent gate because they are never
recorded; L4 continues to gate verified capture.

## ADR-0009: Candidate journey, linked agents, recruiter provisioning

Date: 2026-09-10. Status: accepted.

Product owner defined the end-to-end flow, implemented as a gated chain
whose state is derived from the spine (src/spine/journey.ts), never stored
twice:

0. Profile Agent: the recruiter enters the candidate email. The agent
   creates the profile and generates a shareable password, returned to the
   recruiter exactly once (stored hashed). Provisioning is audited.
1. The candidate signs in with the shared password.
2. Onboarding: target company, job description, existing resume, LinkedIn
   link (profile text optional until the sandboxed LinkedIn reader is
   configured). Submitting runs the Research Agent automatically, which
   analyses the JD and company against the CV and writes a research report:
   green good, blue improve, red needs work. Findings are evidence-bound
   with no invented content.
3. Resume Studio: one session per role, each role with its own interviewer
   run. Role assist probing continues until owned, action, and outcome
   exist. Completed handoffs are stored per role.
4. CV assembler: a pipeline agent fires when a resume run completes and
   writes the revamped CV once every role has a handoff.
5. LinkedIn Studio unlocks only when every role is complete and research is
   done. The interview unlocks only when the CV exists and LinkedIn is
   complete. Gates are enforced server-side (409 with a reason) and shown
   in the UI with the condition that unlocks them.

The seeded demo candidate intentionally sits mid-journey (research done,
one role complete, CV and LinkedIn pending) and carries a verified session
that predates these gates so the recruiter surfaces render on first boot.
New candidates walk the full chain.

Consequences: the interview and LinkedIn APIs are unreachable before their
gates; the journey contract tests cover every transition.

## ADR-0010: Responsive boundaries and the mobile bottom bar

Date: 2026-09-10. Status: accepted.

Reported: UI elements broke across screen sizes and aspect ratios. The
responsive system is now explicit and tested by inspection at each band:

- 1100px and up: full rail, five pipeline columns.
- 900 to 1099: icon rail, horizontal scrolling pipeline with fixed column
  widths, single-column grids.
- 720 to 899: stacking continues, builder steps stack, tabs scroll
  horizontally, tighter chrome.
- Below 720: the rail becomes a bottom navigation bar (order flipped, the
  content leads), the candidate sub-navigation collapses into the views,
  modals go full-screen, panes stack, and touch targets hold at 44px per
  the design language.

Titles, tables, badges, and long strings wrap or scroll instead of
overflowing. The topbar wraps on narrow widths and hides the display name.

## ADR-0011: Server-side journey gates and per-role runs

Date: 2026-09-10. Status: accepted.

Journey gating lives in the API layer, not the flow engine, so engine-level
tests and recruiter-initiated runs stay unconstrained while candidate routes
enforce the sequence. Resume Studio runs carry a roleKey validated against
the parsed resume roles; invalid keys fail closed. One active session per
candidate per flow remains engine-enforced.

## ADR-0003: Frontend is TypeScript ES modules compiled by tsc, no bundler

Date: 2026-09-09. Status: accepted, revisit when design system grows.

Master prompt default is React or Next.js. The foundation build ships
TypeScript ES modules compiled with tsc, consuming tokens.css directly as
the single source of visual truth. The DOM layer is isolated behind small
render helpers so screens port to React as a contained follow-up when the
team adds a bundler. No CSS-in-JS, no invented color values: both apps
import tokens.css and compose with class names only.

Consequences: no HMR; a build step (tsc) produces client bundles; React
adoption is a screen-level migration, not a rewrite.

## ADR-0004: Acceptance criteria derived from the demo scenario

Date: 2026-09-09. Status: accepted.

The Stage 1 technical spec (source artifact 2) has not been supplied, so the
"8 prototype acceptance criteria" are derived from master prompt section 15
and the prototype's interaction truth, encoded as automated tests in
tests/scenario.test.ts and tests/projections.test.ts. When the Stage 1 spec
arrives, its criteria extend the suite; they do not replace the demo
scenario, which the master prompt calls the permanent smoke test.

## ADR-0005: LLM, STT, TTS and Stripe providers are pluggable adapters

Date: 2026-09-09. Status: accepted.

No provider keys are available in the build environment, and L3 forbids
prompt text in the client. All model, speech and payment access sits behind
provider interfaces configured per environment and per tenant flow step:
model providers (Anthropic, OpenAI) with a deterministic scripted provider
for tests and offline demos, STT (Deepgram, AssemblyAI) and TTS adapters
behind the session agent turn machine, and a Stripe adapter behind the
billing meters. Unconfigured providers fail closed with a visible error
state; the scripted provider runs the demo scenario deterministically, and
golden transcript evals gate releases exactly as Addendum A10 requires.


## ADR-0012: The intelligence layer, and what a model is not allowed to do

Date: 2026-09-10. Status: accepted.

ADR-0005 put model access behind provider interfaces and shipped a
deterministic scripted provider so the demo could run without keys. The
prompt registry in `src/spine/flows/prompts.ts` was therefore versioned,
custodied and never actually sent anywhere: every agent was a scripted
implementation, and the research analyst in particular could only ask
whether a job description term appeared verbatim in the CV corpus.

An OpenRouter provider is now configured against `z-ai/glm-5.3-flash`
(`src/spine/providers/llm.ts`), and `src/spine/intelligence.ts` decides
which agents may use it.

The division is between language and measurement.

Language and judgment go to the model: reading a must-have against the CV
for meaning rather than for keyword overlap, phrasing a probe, writing a
bullet from captured evidence, wording per-answer feedback, drafting a
LinkedIn section, writing the client-facing executive summary.

Measurement, verification, assembly and gating stay deterministic: STAR
proportions, the ownership ratio, trailing counts, cross-source conflict
detection, the CV assembler, the stage advisor and every journey gate. An
audited number that moves between identical runs is not a measurement, and
a gate a model can talk its way through is not a gate. `tests/scenario.test.ts`
and the golden transcript evals depend on exactly this.

Session agents keep their scripted state machine. The intelligence layer
wraps it: sequencing, era depth targets, the follow-up budget and the
completion declaration are byte for byte what the scripted turn produced,
and only the wording of the reply changes. Every gate behaves identically
whether or not a provider is configured.

Three guards apply to everything the model returns, because a strict output
schema constrains shape and says nothing about truth:

1. Typographic repair (`normalizeModelText`). A model emits em dashes,
   emoji and smart quotes regardless of instructions, and L8 forbids them.
   Repair is mechanical. All-caps labels are deliberately not repaired,
   because rewriting an unrecognized acronym would corrupt it, so caps stay
   a genuine contract failure.
2. Shape validation. A strict schema still permits empty strings, four
   bullets where the QA checklist asserts five, and bands outside the enum.
3. Number grounding (`numbersAreGrounded`). Any digit run in model prose
   that does not appear in the supplied evidence rejects the entire output.
   This cannot catch a fabricated qualitative claim, but a fabricated metric
   is the failure that would damage a candidate or a client (L5).

Every producer returns null rather than a guess, and the caller then runs
its scripted implementation. The flow trace records which producer served
each step, so a fallback is visible in the audit rather than silent.

Consequences: agent steps are now asynchronous, so `Engine.startRun`,
`turn`, `resume`, `grantConsent` and `retryFailed` return promises. Model
calls cost roughly 10 to 16 seconds on a reasoning model, which the flow
engine absorbs because agent steps were already asynchronous from the
client's point of view. Prompt bodies now leave the machine for the
OpenRouter endpoint; that is inherent to a hosted model, and custody
otherwise holds, with bodies never logged, never traced and never served.
`CERTAINTY_LLM=off` forces the scripted path, and the test suite runs
without a provider so it stays deterministic and offline.

## ADR-0013: No inline style attributes, because the CSP forbids them

Date: 2026-09-10. Status: accepted.

The server sends `style-src 'self'` with no `'unsafe-inline'`. Under CSP
Level 3, `style-src-attr` falls back to `style-src`, so the browser ignores
every `style="..."` attribute. Sixty inline styles across the three clients
were therefore dead: panel and board spacing never applied, the polite live
region rendered full width instead of being hidden, and the STAR meters and
ownership bar rendered with no fill at all, because their widths were
data-driven inline styles.

The policy is correct and stays. Static spacing composes from utility
classes built on the spacing scale, which is what ADR-0003 asked for when
it said to compose with class names only. Data-driven dimensions are
written through CSSOM (`setWidthPct`), which `style-src` does not govern.

`npm run typecheck` now covers `src/web` as well as the server and spine.
It previously excluded the browser project, so a type error there surfaced
only when the build ran.

## ADR-0014: Mobile responsiveness audit, verified against a real touch viewport

Date: 2026-09-12. Status: accepted.

ADR-0011's responsive boundaries scaled layout correctly (grids collapse,
the rail becomes a bottom bar), but scaling a grid is not the same claim as
"works on a phone". A pass driven by an actual CDP mobile viewport
(390x844 and 360x740, touch emulation on) instead of just a narrow desktop
window surfaced four defects that a layout-only review would not catch,
because each one is a behavior gap, not a sizing gap.

**Hover-revealed actions had no reliable touch fallback.** The pipeline
card's Advance and Park buttons are hidden by default (`.reveal{opacity:0}`
in tokens.css) and shown on `:hover`/`:focus-within`, with a fallback of
`@media (hover: none){ .reveal{opacity:1} }` for touch devices. That
fallback depends on the browser correctly reporting a touch-primary input,
which a touchscreen laptop or a tablet with a paired trackpad does not do:
those devices truthfully report `hover: hover`. Confirmed directly in this
CDP-driven touch session, where `matchMedia('(hover: hover)')` still
returned true. The fix does not touch tokens.css's hover-based rule, which
still helps on devices that do report `hover: none`; it adds
`.reveal{opacity:1}` unconditionally at the same <=1099px boundary where
the rail and board already switch to their touch-optimized layouts
(app.css), so visibility no longer depends on input-capability detection
succeeding.

**The bottom tab bar overflowed with no way to know it did.** Six candidate
nav items (Dashboard, My Resume, LinkedIn, Portfolios, Sessions, To-Do) sum
to 435px against a 390px viewport. `.nav{overflow-x:auto}` was already
correct, but a plain scrollable region with no visual cue reads as a
clipped layout, not an invitation to swipe. Added scroll-snap
(`scroll-snap-type:x proximity` / `scroll-snap-align:start`) so a swipe
settles on a whole tab, and a trailing-edge fade using the scroll
container's own background color, so it holds in both themes.

**The lock glyph rendered as a stray mark below the tab label.** `.nav-lock`
carried `margin-inline-start:auto`, a centering trick that only works
when `.nav-item` is a row. The bottom tab bar sets `.nav-item` to a column
flex (label under icon space), where `margin-inline-start:auto` does
nothing on the cross axis, so the lock fell to a new line below the label
as an orphaned dot. Fixed by making `.nav-lock` (and `.nav-badge`, which
had the equivalent desktop-only trick) an absolutely positioned corner
mark at this breakpoint, the same treatment `.nav-badge` already used on
the far side of the tab.

**A wrapping status line was styled as a single-line pill.** The recruiter
candidate-detail journey summary ("Setup complete · Research complete /
Roles 1/3 · CV pending · ...") and the stage-advisor suggestion line used
`.chip`, a fully round pill (`border-radius: var(--radius-pill)`) meant
for short one-line badges like "3 flags". On a phone the sentence wraps to
two lines, and a capsule that tall pinches the wrapped text against its
own curved corners. Introduced `.chip-row`: the same bordered surface,
`border-radius: var(--radius-control)` instead, `flex-wrap: wrap` built
in. `.chip` itself is unchanged and still correct for its remaining
single-line uses.

**The audit table's horizontal scroll had no affordance either.**
`.table-scroll{overflow-x:auto}` was already a genuinely working
independent scroll container (verified: `scrollWidth` 770 against a 366px
box, and manually driving `scrollLeft` did reveal the Action and Target
columns), but visually indistinguishable from a table that had simply been
cut off. Given the same trailing-edge fade treatment as the tab bar, so
the same "there is more this way" vocabulary is used everywhere a
horizontal scroll region appears in the app.

Verification method: raw CDP (`Emulation.setDeviceMetricsOverride`,
`Emulation.setTouchEmulationEnabled`) against the already-running browser
tab, because `window.resizeTo` cannot resize a normal user tab and the
app's own `X-Frame-Options: DENY` (correctly) blocks the alternative of
embedding it in a same-page test iframe. Confirmed with tight, scaled
`Page.captureScreenshot` clips where a full-page screenshot left cell text
too small to inspect (this is how the previously-invisible pipeline
actions and the pinched chip text were actually confirmed, not just
theorized from CSS). All fixes were re-checked at both 390px and 360px,
and the desktop layout was re-screenshotted afterward to confirm no
regression from the same rules.

## ADR-0015: Dark-academia palette, superseding the color specifics of ADR-0006

Date: 2026-09-13. Status: accepted. Supersedes the palette (not the
architecture) of ADR-0006.

Feedback on the running app: the Notion-adjacent cool-gray-and-blue palette
read as flat and impersonal ("dystopian, no color"). The request was for a
warmer, "dark academia" visual identity: aged paper and library oak,
candlelight rather than a SaaS dashboard, with no change to any UI copy.

Every color and font-family in the app is a token consumed through
`var(--name)`; ADR-0006 already committed to "accents are tokens only, no
component invents a color value," and grepping `app.css` and every web
client for raw hex or rgb values confirmed it holds in practice. That made
this a single-file change: only `tokens.css` moved. No component CSS, no
client TypeScript, no DOM structure, no test.

**Palette.** Light mode: aged parchment ground (`#F7F1E3`) and oak rail
(`#EDE3CC`) in place of white and off-white; ink-brown text (`#2E2419`) in
place of near-black gray; antique brass (`#8A6A1E`) as the one accent hue
in place of the old blue. Dark mode: a candlelit-study ground (`#1A1510`,
warm near-black rather than cool charcoal) with the same brass accent
brightened for contrast (`#C9A227`). The pastel badge set (good/improve/
needs-work findings, flag chips, role chips) moved from bright candy tones
to library hues carrying the same semantic mapping: sage hunter-green,
faded ink-blue, aged gold, burnt sienna, oxblood, muted plum, dusty rose.
Every light/dark pair was checked against WCAG contrast math before
committing (worst case, the light-mode accent button at 4.79:1, still
passes AA at normal text size).

**Type.** Added `--font-serif` (Georgia and other pre-installed OS serifs;
no external font request, so the strict `style-src 'self'` /
`default-src 'self'` CSP needed no change) and pointed only `--type-display`
and `--type-view-title` at it: the wordmark and page titles ("Dashboard",
"Pipeline", "Audit") read like book and chapter titles. Every other type
role (`t-section`, `t-body`, `t-secondary`, `t-caption`, `t-numeral`,
`t-mono`) stayed on the sans stack: this is still a data-dense evidence
tool, and serif at 12-14px body-copy sizes trades legibility for mood at a
scale rows of session dates and STAR percentages cannot absorb.

**Shape and shadow.** `--radius-control` and `--radius-sheet` tightened
slightly (6px/10px to 4px/7px): a touch more carved-oak furniture, less
rounded SaaS bubble. `--radius-pill` untouched, since a pill is a shape
requirement (badges, the segmented mode control), not a softness dial.
Elevation shadows and the modal scrim were retinted from neutral black to
a warm brown-black (`rgba(38,26,14,...)` light, `rgba(10,7,3,...)` dark
scrim) so depth reads warm rather than corporate-cool.

Verified across both themes on the candidate dashboard (journey stepper,
research-finding chips), the recruiter pipeline board and candidate
detail (STAR meters, flag badges), and the admin audit table (role
chips), and re-checked at the 390px mobile viewport from ADR-0014 to
confirm the retinted tokens did not disturb the scroll-snap, lock-glyph
or chip-row fixes made there. `npm run typecheck` and the full test suite
stayed green throughout, as expected for a change confined to custom
property values.

## ADR-0016: A brand mark, a larger type scale, and surfaces with depth

Date: 2026-09-13. Status: accepted.

Feedback on the running app after ADR-0015: the palette itself ("muddy
yellow") landed well, but the product had no logo, its type read as a
touch small, and the overall layout still felt like "a ledger, manual
form filling" rather than a designed product. Three changes, still
confined to tokens.css, app.css and one new shared/dom.ts helper; no
copy changed anywhere.

**The brand mark.** A single SVG path: a checkmark whose long upstroke
flows directly into the start of an open ring reading as "C", one
continuous stroke rather than a checkmark badge glued next to a letter.
`brandMark()`/`brandLockup()` in shared/dom.ts (new), consumed by all
three rail-heads and the login card in place of a plain text wordmark.
The path went through two iterations verified by rendering it live in the
running app and screenshotting at multiple sizes (16 to 80px) before
committing, because SVG arc and dasharray geometry is easy to get
plausible-looking-wrong: the first attempt's dasharray on/off lengths
were swapped, drawing a small stray arc instead of a ring; the merge
requested afterward (the tick's tail into the ring's start, not just
touching but a shared point with no seam) required moving the checkmark
into the SAME path as the ring arc and, because reversing a path's
traversal direction on an already-computed arc flips which way it
sweeps, flipping the arc's sweep-flag to match. The same mark, fixed
colors, backs a new SVG data-URI favicon (`img-src` already allows
`data:`, so no CSP change).

**Type scale, up across every role.** `--type-body` 14px to 16px,
`--type-secondary` 13px to 14px, `--type-caption` 12px to 13px,
`--type-section` 14px to 15px, `--type-numeral` and `--type-mono` 13px
to 14px, `--type-view-title` 22px to 25px, `--type-display` 29px to
33px. `.badge`'s fixed 20px height became 22px so its caption-sized
label keeps clear top/bottom padding at the new size instead of nearly
filling the box. Checked afterward at the admin audit table (the most
column-dense screen) and at the 390px mobile viewport from ADR-0014: no
overflow, no wrapping regression: `ch`-based truncation widths
(`.c-actor`, `.c-target`) scale with the font automatically, and the
mobile tab bar's labels have their own fixed 11px override so they were
never part of this change.

**Surfaces got depth instead of just an outline.** This is what the
"ledger" feedback was actually pointing at: `.panel` had no shadow, and
every input sat at the exact background color of the panel around it,
so a form field was a blank rectangle with a ruled line, indistinguishable
in depth from the page it sat on. `.panel`, `.pcard`, `.flagcard`,
`.todo-card`, `.gapcard`, `.finding` and `.splitpane .pane` all now carry
`box-shadow: var(--elev-1)` at rest (cards that already lifted on hover
now escalate to `--elev-2` there instead of repeating `--elev-1`).
Inputs and textareas moved from `--sheet` to `--sheet-sunken` and gained
a new `--inset-field` shadow token (a warm-tinted inset, matching the
existing warm-shadow convention from ADR-0015) so a field reads as a
well to write into. `.stamp` and `.badge` gained the same `--sheet-sunken`
fill, since an outline-only chip on a matching background was the same
flatness problem in miniature. The audit table's per-row hairline (a
rule under literally every row, the single most "ruled ledger paper"
element in the app) became zebra striping via `:nth-child(even)`, with
one hairline kept under the header only. `--radius-control` (4px to 7px)
and `--radius-sheet` (7px to 12px) loosened slightly at the same time:
sharp corners read as document/form, softer ones as product surface.

Verified in both themes on the login card, the candidate dashboard, the
recruiter pipeline board and candidate detail (STAR meters, chip-row),
and the admin audit table; re-checked at the mobile viewport. Typecheck
and the full test suite stayed green throughout, expected for a change
confined to tokens, composed classes and one presentational DOM helper.

## ADR-0017: A marketing page, in a deliberately separate design system

Date: 2026-09-13. Status: accepted.

The request: a scrollytelling marketing page with real screenshots,
features, tables, statistics, and pricing, "highly professional, high
visual impact, low textual verbosity, colourful but muted, minimal,
modernist Bauhaus." The product UI's own design system (ADR-0015, ADR-0016)
is a warm, cozy dark-academia reading room; a bold poster register is a
different register on purpose, not a fork of the same look.

**A new, self-contained system, same hue family.** `src/web/marketing.css`
defines its own tokens rather than reusing tokens.css: the same brass,
oxblood, hunter-green and parchment hues the product already uses, composed
as flat geometric color blocks (a circle, a square, a triangle, a ring) per
section instead of one continuous surface. This is the Bauhaus register
the brief asked for; sharing the hue family instead of inventing a new
palette is what keeps the marketing page and the product feeling like the
same company. `src/web/marketing/main.ts` and `marketing.html` follow the
same per-surface pattern the three apps already use (own folder, own HTML
entry), so the existing build picked them up with no new tooling.

**The screenshots are the real product**, captured live against the
running dark-mode and light-mode app (candidate dashboard with the journey
stepper and research findings, the recruiter pipeline board, STAR
proportions and ownership meters, the audit table's zebra striping), not
mockups. Static PNGs under `src/web/img/`, served the same way the compiled
per-app JS bundles already are (`/assets/<name>` stripped back to the
matching `web-dist/<name>` path).

**Every number in the stats strip is real and checked before writing it
down**: 56 from `npm test`'s own count at the time of writing, 11 from
counting the bullets under the README's "laws in code" section, 3 from
the three role-scoped apps, 0 for the design system's "no invented color
values" rule. A landing page is exactly the kind of copy that drifts into
unverifiable claims by default; these are all falsifiable against the
repo, and wrong ones would be a bug, not a rewrite.

**The scrollytelling mechanic is a pinned visual plus an
IntersectionObserver**, no scroll-jacking library: whichever `.beat` is
nearest the viewport center gets marked active, and its matching
screenshot and progress dot follow. It, the section reveal-on-scroll, and
the stat count-up are all skipped outright under
`prefers-reduced-motion: reduce`.

**Root now serves the marketing page; `/login` is unchanged.** `/` and
`/login` previously served the identical login page; nothing depended on
`/` specifically being login rather than `/login`, so pointing `/` at
`marketing.html` (with a "Sign in" link to `/login`) is the standard
marketing-site-at-root, app-behind-login shape and breaks nothing that
was there before.

**Bugs the build surfaced, fixed in place rather than worked around:**

- `scripts/sync-web.mjs`'s static-file copier computed each destination
  path relative to the *current recursion directory* instead of the
  fixed `src/web` root. It had never been exercised on a nested directory
  before (every prior `.html`/`.css` file lived at the top level), so the
  bug was latent until `src/web/img/*.png` became the first nested asset:
  every screenshot landed at `web-dist/shot-*.png` instead of
  `web-dist/img/shot-*.png`. Fixed by threading a fixed `base` path through
  the recursion instead of reusing `dir`.
- The CTA band's decorative triangle was styled `var(--ochre)` on a
  section whose own background is `var(--ochre)`: same-color-on-same-color
  is invisible regardless of opacity. Recolored to `var(--ink)`.
- On narrow viewports, the hero's and CTA band's decorative shapes are
  positioned by percentage, tuned for a wide desktop canvas; the same
  percentages on a 390px viewport land the shapes directly over the
  headline and the CTA buttons. Fixed with fixed-pixel corner anchoring
  and reduced opacity below 560px, not just a smaller `scale()` of the
  same overlapping position.
- The platform section's pinned-visual pattern (one sticky screenshot,
  four scrolling beats of text) depends on a two-column layout to make
  sense: once the grid collapses to one column below 980px, `position:
  sticky` on the visual just parks it fixed on top of the beat text
  scrolling underneath. Rather than patch the symptom, each beat gets its
  own small inline screenshot below that width (via a `::before` matched
  to `[data-beat]`), so mobile reads as a plain linear list and still
  shows all four real screens, instead of showing only the first one and
  hiding the rest behind a pin that no longer holds together.

Verified: `npm run typecheck`, the full test suite (unaffected, since
nothing in `src/spine` or `src/server` changed beyond the one route line),
and a full-page pass in both the 1600px desktop viewport and the 390px
mobile viewport from ADR-0014, including the CSP (no `securitypolicyviolation`
events fired; the page's images, script and stylesheet are all same-origin,
so the existing `default-src 'self'` header needed no changes).

## ADR-0018: The interview voice console, and where its honesty boundary sits

Date: 2026-09-13. Status: accepted.

Four visual directions for the interview screen and its voice control were
built as a standalone, non-shipped comparison page
(`design-review-interview.html`, same-origin CSS/JS files rather than
inline, per the CSP constraint ADR-0013 already established) and reviewed
live with a state switcher (Idle/Listening/Speaking/Muted) and a light/dark
toggle before any code changed in the real app. "Studio Console" was
chosen: the existing split-pane transcript stays on the left: a voice
console replaces the right pane's placeholder "Scratchpad", built around a
breathing orb, a mic toggle, and a live STAR readout.

The one constraint that shaped the real implementation past the mockup:
there is no speech recognition or synthesis wired up, so the console
cannot honestly claim to hear or speak. The four mockup states became
three real ones, each tied to an actual, observable condition rather than
a timed animation: `idle` (no active run), `waiting` (the run is active
and awaiting the candidate's next answer, labeled "Your turn"), `thinking`
(a turn request is genuinely in flight, labeled "Thinking" rather than
"Speaking", since nothing is playing audio), and `muted` (voice is off,
which is also every session's default state until the candidate opts in).
Toggling voice on keeps the existing toast explaining that text is what
actually works right now.

STAR proportions follow the same rule. The evaluator scores a whole
transcript once, at session completion (`agentSessionEvaluator` in
agents.ts); there is no incremental per-turn score to show truthfully
while a session is running. The console's STAR area is an explicit
placeholder ("STAR proportions score once this session completes") until
`run.status === 'complete'`, then renders the real evaluator output,
reusing `setWidthPct` for the meter fills for the same CSP reason
(`style-src 'self'`) established in ADR-0013 rather than inventing a
class-per-percentage scheme.

Verified end to end against a real completed session (driven via the API
directly, using the scripted provider for speed during setup and the real
OpenRouter provider for the final visual check), in both themes, and at
the mobile breakpoint. A matching screenshot of the real console mid-session
(a genuine OpenRouter-generated question, not a placeholder) backs a new
marketing-page section between Platform and Features, making the same
promises the implementation actually keeps: consent before capture,
deterministic scoring, ownership measured.

## ADR-0019: The LiveKit client bundle is self-hosted; no CDN, no import map
Numbering note: this entry and the previous one both carried ADR-0018;
corrected to 0019 when ADR-0020 was appended.

Date: 2026-09-26. Status: accepted.

The candidate app served an inline `<script type="importmap">` mapping
`livekit-client` to `https://esm.sh/livekit-client@2.6.2`. Inline scripts
are exactly what `script-src 'self'` (ADR-0013) forbids, so the browser
refused the map, the bare specifier in `candidate/main.ts` failed to
resolve, and one unresolvable import killed the entire module graph before
any app code ran. `/app/candidate` returned 200 with an empty `#root`: a
blank screen invisible to the API, the server logs, and every test, because
none of them load a browser.

The fix removes the third party from the critical path entirely. The
livekit-client ESM bundle is vendored at `src/web/vendor/`, copied into
`web-dist` by the build, and imported by relative path. The bundle is fully
self-contained, so a single file suffices. The CSP drops the esm.sh
exception from `script-src` and `connect-src`: scripts are now same-origin
only. This also removes a version-skew hazard (the import map pinned 2.6.2
while package.json carried 2.22.x) and a CDN availability dependency.

Keeping the failure class out of the codebase, not just this instance:
`tests/csp.test.ts` fails the build if any shipped page carries an inline
script, if any shipped app module uses a bare import specifier, if the
vendored bundle stops resolving on its own (proven by importing it, since
regex cannot tell code from string literals in a minified bundle), if the
bundle drifts from the installed livekit-client version, or if the CSP ever
references the removed CDN again.

The same audit surfaced the LiveKit webhook hand-building artifacts with a
`quarantine` status that does not exist, under a fake `system` tenant. That
route now resolves the tenant from the stored candidate (L9) and records
agent output as `clean`, the same as every other `write_artifact` call.

Verified end to end: the served page carries one module script and no
inline scripts, the CSP header ships `script-src 'self'`, the vendor asset
serves through the `/assets` route, and the full compiled module graph of
the candidate app resolves with no import map.

## ADR-0020: Voice consent is a server-side chain; webhooks are signed and consent-gated

Date: 2026-09-28. Status: accepted. Verified by the experiment record at
experiments/2026-09-28-p0-voice-consent-webhook-auth/ (prereg.md, journal.md,
runs R001-R006, raw outputs hashed).

Three P0 defects were found on the voice path:

1. Consent bypass (L4). The candidate client connected a LiveKit room and
   published a microphone track after a checkbox, with no ConsentRecord
   created. The token endpoint minted a room token for any authenticated
   candidate with no consent check. Verified: pre-fix, a no-chain request
   returned 200 and a token (R001).
2. The webhook was unverified and wrote artifacts into a tenant resolved
   from an unchecked body field. Verified: any authenticated platform user
   (any tenant, own CSRF) could inject a handoff_block with no signature and
   no consent (R003).
3. Candidate resolution read `participant.metadata` as an object while real
   payloads carry a JSON string. Verified: string metadata returned 400
   missing_candidate_id (R003).

The fix, all in src/server/livekit.ts plus the client:

- voiceChain: the only path to a room token. Requires a verified
  interview_screener run of the same candidate whose consent record is
  granted, not withdrawn, and whose session exists with mode verified and is
  not stopped. The token carries {candidateId, sessionId, consentId} in its
  metadata.
- Signature verification over the raw body with the SDK WebhookReceiver
  (HS256, iss = API key, exp required, sha256 claim), refused 401 with no
  parsing when absent or invalid. The webhook is handled before the generic
  JSON path because the signature covers exact bytes.
- Consent-gated ingestion: the candidate resolves from string or object
  metadata, then the room name interview-<candidateId>, then an explicit
  data field; artifacts are written only inside an active consented verified
  session (a named session must itself be active) and every artifact carries
  sessionId, consentId and source. Bullets cap at 50, fields at 400 and the
  note at 2000 characters. Every ingest is audited.
- Client: the verified start now runs the server chain (start flow, grant
  consent, mint token) before connecting; one stopVoice cleanup stops the
  track, disconnects the room and clears the recording indicator on
  withdrawal, mode switch, navigation and beforeunload. The run branch's
  withdraw control routes through it, and a dedicated voice-active panel
  exposes "Withdraw consent and stop" while the room is live.

Consequences: the token endpoint now requires {runId}; requests without a
chain fail closed with 409 consent_required regardless of the reason
(specific codes for run-not-found and wrong flow). The journey gate
(ADR-0011) still applies first to candidate-initiated verified starts, so a
locked candidate cannot reach the consent gate at all. Voice sessions still
do not complete the screener flow's evaluate and suggest steps; that is
recorded as the next experiment.

## ADR-0021: Neutral certainty: the interface returns to achromatic, structure returns to hairlines

Date: 2026-10-01. Status: accepted. Supersedes the palette of ADR-0015 and
the elevation and field treatment of ADR-0016. Keeps ADR-0016's type sizes
and brand mark.

Review of the running app found three problems. The parchment-and-brass
palette tinted every surface (ground, rail, cards, inputs, chips), so the
evidence hues no longer stood out and the product read as a reading app
rather than a verification tool; design-language.md section 2 had
rejected exactly this ("warm cream ground"). ADR-0016's fix for the
"ledger" feel put a shadow on nearly every container, which produced
shadowed cards inside shadowed panels and pipeline trays. And the layout
did not prioritise: on candidate detail the verified insights sat below a
shareable-URL panel, empty pipeline stages dominated the board, the topbar
repeated the role already shown in the rail, and the candidate dashboard
never said what to do next.

**Palette (tokens.css only).** Neutral ground (#F7F7F8 light, #0B0B0C
dark), white sheets, near-black ink, and near-black primary actions. Hue
is spent only on evidence (positive #14664A, warning #8A4B0A, blocking
#B0231A, and brightened dark-mode pairs), recording, and focus (#1A5FD0,
now its own hue again instead of brass). These are the section 3 values
from design-language.md. The blue, yellow, purple and pink pastel token
names survive but resolve to neutrals, so no component can carry meaning
through them. Research findings now map to evidence roles: good is
positive, improve is warning, needs work is blocking. Role chips in the
audit table are neutral: roles are identities, not evidence. The brand
mark is ink.

**Type.** Geist stays and Geist Mono joins it for timestamps and
identifiers (same Google Fonts origin, already allowed by the CSP). The
serif role is retired (`--font-serif` aliases sans). Titles are 600 weight
with tight tracking; the accent dot before view titles is gone.

**Surfaces.** Structure comes from hairlines and space. Panels and cards
carry at most a one-pixel lift (`--elev-sheet`, none in dark mode);
`--elev-1` and `--elev-2` are reserved for toast, login card and modal.
Inputs are white wells with a strong hairline and a focus-hue ring. Each
pipeline stage is one continuous sheet with hairline-divided candidate
rows; empty stages collapse to a narrow dashed column. Research findings
are list rows rather than shadowed cards. Flag cards keep the severity
spine (an app.css rule restates it, since the flat card border would
otherwise override tokens.css).

**Shell.** New shared helpers in shared/dom.ts: a 16px line icon set,
initials avatars, `railHead`, `railFoot` (the account block: name, role,
theme toggle, log out), `topbar` with a breadcrumb trail, and
`viewHeader`. The topbar's breadcrumb starts at the tenant name, exposed
by a new tenant-scoped `Store.tenantName(ctx)` as `tenantName` on
`/api/me` (additive, tested). Below 720px the account controls move into
the topbar, because the rail becomes the bottom tab bar.

**Candidate detail.** An identity header (avatar, name, stage, role line)
with the profile link actions in it, a stats strip (open flags, verified
sessions, roles revamped, CV, LinkedIn, interview), then tabs with an open
flag count and a roving tabindex. The stage advisor suggestion is a
one-line callout.

**Candidate dashboard.** The stepper is ink (completed stages filled,
current ringed) inside a progress card that ends in one next-step action
derived from the same journey state, so the two cannot disagree.

**Bugs fixed on the way:**
- At 720 to 1099px the rail collapses to icons, but nav items had no
  icons, so they rendered as blank buttons. Every nav item now carries one.
- Recruiter detail printed "One source conflict flagged. Conservative
  dates in use." for every candidate. It is now derived from the open
  source-conflict flags and omitted when there are none.
- The ownership line printed "trailing ends: 0" from a reduce that always
  returned zero. It now reads the session's `trailing` value, which the
  projection already carried.
- STAR meters now draw the target as a 2px tick (design-language 8).
- The mobile tab bar clipped "To-Do" and stacked the lock over
  "Sessions". Items now share the bar equally and the lock is a corner
  mark.
- The candidate rail showed the "Target role" placeholder and no To-Do
  count on first load, because the shell rendered before the candidate
  record arrived. The record now loads first.
- Transcript annotations sat on top of the preceding turn's hairline.
- The builder title-cased raw kind names ("Jd", "Linkedin Snapshot"). It
  now uses a label map.

**Marketing screenshots.** The five captures in src/web/img were
recaptured from the running app in dark mode at 1600x1000, 2x. The
interview shot needs Nadia's interview unlocked, which the seed does not
have, so it was taken on a backed-up copy of the local demo database after
completing the LinkedIn studio flow through the real API (scripted
agents). The database was restored afterwards. The marketing page itself
(ADR-0017) is unchanged and keeps its separate design system.

Verified: typecheck (server and web), 74/74 tests (one new: tenant name
isolation), and screenshots of every surface in both themes at 1440px,
900px (icon rail) and 390px (bottom tab bar).

## ADR-0022: One CV upload, portfolio connectors, and a profile page that says how sure it is

Date: 2026-10-01. Status: accepted. Follows a review of counterintuitive
practices in the product. Decisions the owner did not make explicitly were
taken on the recommended default and are marked (default).

**Documents arrive once, as files.** Onboarding asked the candidate to
paste their CV as plain text, the JD as text, and the recruiter's builder
asked again for everything by paste. Now a CV (and optionally a JD) is
uploaded once, by whoever has it first (default), through
`POST /api/candidate/documents` or `/api/recruiter/candidates/:id/documents`.
Format is sniffed from the bytes. PDFs are read by LiteParse
(`@llamaindex/liteparse` 2.15, Apache 2.0, a Rust core with prebuilt
binaries for macOS, Linux glibc and musl, and Windows), locally, with OCR
off (default: CVs never leave our infrastructure, and LlamaParse's cloud
fallback is not wired). LiteParse's text output projects onto a spatial
grid, which keeps sidebar columns on shared lines, so the JSON output's text
items are split at a detected gutter and each column read top to bottom.
LiteParse converts Office files through LibreOffice, which a Node host does
not have, so DOCX is read directly from `word/document.xml` with `node:zlib`
(tabs become field separators, numbered paragraphs become bullets). A scan
with no text layer is refused with a plain message rather than guessed at.
The text then goes through `quarantine()` unchanged: parsing is extraction,
not trust (L1). Each artifact records its source (file name, parser, size,
hash, who uploaded it).

The structurer was the bigger weakness: `parseResume` read exactly one
template (positioning on line 2, "|" separated contact, upper-case
headings), so real CVs produced no roles. `structureResume` keeps it for
template input and falls back to `parseResumeLoose`, which handles heading
variants, five date formats, open ends, title and company in either order on
one line or two, bullet glyphs and wrapped bullets. The candidate sees what
was read (roles, dates, bullet counts) and re-uploads if it is wrong; there
is no field editor yet.

Around it: onboarding no longer asks for anything already on file; the
recruiter's target and JD are shown as set by the recruiter, not editable
duplicates; the profile picture field is gone (it was stored, never shown,
and pushed through the text sanitizer); the builder counts a recorded
verified interview as its transcript source instead of demanding a paste,
says when only a LinkedIn URL is on file and what the profile text is for,
and uploads CVs and JDs as files.

**Connectors (GitHub, LeetCode).** `src/spine/connectors.ts`. Linking is a
consented act (ConsentRecord scope `connect:<provider>`), counts as a claim,
and becomes verified when a one-time code appears in the account's public
bio, which needs no OAuth app for either provider. Fetching is allowlisted
per host, redirect-free, timed out at 8s and capped at 1 MB; bios, repo
descriptions and PR titles pass the document sanitizer. Figures are counted
in code: owned non-fork repositories, languages, merged pull requests to
repositories the candidate does not own (the hardest public signal to
game), months active in the last year; LeetCode solved counts, contest
rating, badges. Raw commit counts and stars are not used as evidence.
LeetCode has no official API; its public GraphQL endpoint is best effort and
fails closed. Disconnecting withdraws the consent and deletes link and
snapshot. Connector evidence feeds the profile insight; it does not yet feed
the research report or the suggested-gap queue.

**The profile page is a one-page insight.** `src/spine/insight.ts` builds,
at view time and from public-safe data only: each JD must-have with a status
(verified, claimed, partly evidenced, not evidenced) and the sources behind
it; top achievements, quantified first; GitHub and LeetCode work; the
verified interview's STAR proportions (numbers only, never transcript text);
background; and the CV download. "Verified" is reserved for what the
platform checked itself: a verified interview, or a connected account whose
ownership was proven. Matching reuses the research agent's term extraction
so the page and the report cannot judge one requirement two ways. Interview
evidence ignores sentences that deny something: Nadia's "I have not,
honestly... I never owned the clusters" contains the Kubernetes terms and is
evidence of the opposite (a regression test pins this). Keyword matching is
still literal; a model-backed matcher with the number-grounding guard is the
obvious next step.

Sharing changed from a permanent capability URL to an approval: nothing is
shared until the candidate approves, an approval lasts 30 days, the
candidate can stop it and the recruiter can revoke it, and an inactive link
answers 410. The candidate and their agency can preview an unapproved page.
One page per candidate, tied to the candidate's target role and JD
(default); per-submission pages for several companies would need a
submission entity first. The page moved off the marketing design system onto
tokens.css, because it is evidence in the product's language, not
marketing; print styles make it a one-page PDF.

**Accounts.** A recruiter-generated password is now temporary
(`users.must_change_password`, an additive migration); the server refuses
every route but `/api/me` and `/api/auth/password` until the candidate sets
their own. The login page lists demo accounts only when `/api/public/config`
reports demo mode (on unless `CERTAINTY_DEMO=off`).

**Controls that now do what they look like.** The Verified toggle opens the
consent dialog and moves only once consent exists; cancelling or Escape
leave practice untouched. Without LiveKit configured, a consented session
runs as text instead of stalling after consent. The microphone switch that
changed only a label is gone; the console states the real mode (text
session, your turn, thinking, live audio). Private practice opens after
research instead of after LinkedIn copywriting (`journey.practice`, enforced
server-side as `practice_locked`). Locked nav items open a page that says
what unlocks them and links there, instead of a disabled-looking item that
only toasted. LinkedIn Studio is six saved cards with copy buttons, written
in one action, saved section by section (`linkedin_sections` artifact), not
a chat whose output vanished on navigation. "Copy bullets" is gone (they go
into the CV automatically). The To-Do action says "I have fixed this" and
the recruiter's flag card shows "Candidate says fixed. Check the CV",
because the candidate's word is a claim. Pipeline cards say where Advance
goes; the submission builder exists once, linked from candidate detail; the
theme toggle shows and names the theme it switches to; STAR figures are
spelled out; admin modules are on/off switches with product names; nav
labels match page titles ("Interview", "Portfolio").

**Verification.** 89/89 tests, 15 new: document intake against fictional
fixtures regenerated by `tests/fixtures/make-fixtures.mjs` (a two-column PDF
and a deflated Word file with real list numbering), and an HTTP-level suite
(`tests/platform.test.ts`) running the real router with a fake `fetch` that
refuses unlisted hosts: temporary passwords, one upload reused through
onboarding, practice gating, connector ownership proof, sanitization and
deletion, LeetCode parsing, profile approval, preview, revocation and
expiry, the denial regression, the builder transcript rule, and LinkedIn
persistence. Every changed screen was checked in the running app at desktop
and phone widths. Not done: the pre-registered parser comparison against a
real CV corpus that the experiment discipline calls for (the fixtures are
synthetic and few); it should run before claiming extraction accuracy.

## ADR-0023: Notary: a branded design system, chosen from three mockups

Date: 2026-10-02. Status: accepted. Supersedes the palette, type and shell
of ADR-0021; keeps its evidence semantics, hairline structure and every
behaviour from ADR-0022.

The owner's verdict on ADR-0021 was that the UI had "no branding or polish,
no symmetry, no theme". Three static mockups of the same screen (recruiter
candidate detail, real demo data) were built in `mockups/`: A "Notary"
(editorial, certificate language), B "Instrument" (dark console), C
"Atrium" (warm, rounded). The owner chose A, with one change: the logo is
the landing page's mark (the check that flows into an open C) and its bold
Geist wordmark, not the seal drawn for the mockup.

**Theme.** The product certifies claims, so it speaks the language of
certificates: navy ink (#16244F) on paper (#F5F2EC), white sheets, an
Instrument Serif display face for names, page titles, card titles and
figures, Geist for the interface and the wordmark, Geist Mono for small
figures. One ornament, the guilloche band (engraved waves, drawn through a
CSS mask so its colour is the `--brand` token), on certificate headers, the
login card and the public profile. Corners are crisp (3px controls, 4px
sheets); sheets carry no shadow, paper on a desk. Eyebrow labels (small,
tracked, upper case) mark data labels, crumbs and card captions; this
deliberately reverses design-language.md's ban on tracked capitals, which
belonged to the achromatic system. Dark mode is "Notary at night": navy
paper, warm ink, the same structure.

**Symmetry.** The left rail is gone. The shell is a three-column top bar,
brand left, pill navigation centred, account right, from the existing DOM
(`rail-head`, `nav`, `rail-foot`), so no app changed its markup to get it.
Crumbs became an eyebrow line above the page. The recruiter candidate page
is a certificate: identity left, the seal gauge centred (requirements
evidenced, split into verified and claimed arcs, `sealGauge()` in
shared/dom.ts), facts right, mirrored; stamps and actions run along its
foot. The journey is six numbered cells with a navy rule under each
completed gate and a dashed rule under the current one, on both the
recruiter and candidate sides. The Insights tab sets the requirement table
(the same insight the shared profile shows) beside the structured interview
at 7:5. Below 1100px the navigation becomes icons; below 720px it becomes
the bottom tab bar and the certificate stacks.

**Semantics kept.** Navy marks what Certainty verified, a lighter navy what
is claimed, amber what is partial, vermilion a gap or block; a gap now uses
the blocking mark everywhere. Target ticks on STAR meters are vermilion.
Focus keeps its own blue. App favicons moved to a navy tile; the marketing
page keeps its own system (ADR-0017), and its logo is the reference.

Verified: typecheck, 89/89 tests (no behaviour changed), and screenshots of
the recruiter pipeline and candidate detail, candidate dashboard and
portfolio, admin audit, login and the public profile, light and dark, at
1440, 900 and 390px.

## ADR-0024: The hiring data model: requisitions, applications, and per-tenant hiring models

Date: 2026-10-02. Status: accepted. Governs phase 1 (the "build now, fully
real" plan): every feature in it extends this model and keeps no private copy.

**Why.** Certainty was candidate-centric: one candidate, one target role, one
JD artifact, one pipeline stage. An enterprise hiring lifecycle needs a role
that many candidates apply to, ranked against each other, with approvals and
offers around it. The candidate journey (resume studio, CV, LinkedIn,
practice) stays candidate-level and unchanged.

**Tenant settings.** `tenants.settings` (JSON, additive migration):
`hiringModel` (`agency` or `in_house`) and `timezone`. Stage sets come from
the hiring model:
- agency: Screening, Submission draft, With client, Interview, Offer, Placed
- in-house: Applied, Screening, Assessment, Interview, Offer, Hired

`Stage` becomes a string checked against the tenant's set; `STAGES` remains
the agency set for existing callers.

**Requisition.** A role being hired for: title, department, location,
client (agency only), headcount, salary band (internal), description (the
JD), status `draft -> pending_approval -> open -> closed` (or `rejected`;
"changes requested" returns to draft), an approvals history, criteria and a
progression rule. Criteria: must-haves (label, weight 1 to 3, required),
minimum years, accepted locations with a remote flag, and whether work
authorisation is required. The approver may not be the submitter.

**Application.** Candidate x requisition, unique per pair, the unit of the
pipeline: stage, status (`new`, `screened`, `shortlisted`, `knocked_out`,
`rejected`, `withdrawn`, `hired`), source (`recruiter`, `bulk`,
`apply_page`, `seed`), a `primary` flag, apply-form answers, the latest
score snapshot, and an override. Stage lives here. `candidate.stage` is a
mirror of the primary application's stage, written only by the same
`advance` function; a test pins that the two never drift.

**Scoring (deterministic, no model).** Per must-have, evidence strength from
the shared requirement matcher (the one the profile insight uses): verified
1.0, claimed 0.7, partly 0.35, gap 0. Weighted total, 0 to 100. Knockouts are
evaluated apart from the score and only on explicit evidence: a required
must-have with no evidence, years below the minimum, a location outside the
accepted list without remote, a "no" to work authorisation. An unknown value
is a "check" note, never a knockout. Rank is computed at read time among
eligible applications, ties broken by verified count then application date.

**Overrides.** A recruiter or HR can adjust a score (plus or minus, shown as
its own line), include an application despite a knockout, or exclude it from
the ranking. A reason is required; actor, role and time are stored and
audited. An adjustment moves rank through the numbers, so every rank stays
explainable from its components. Re-scoring never clears an override.

**Progression.** A per-requisition threshold sets status automatically
(knocked out, shortlisted, screened). Those changes are audited as
`agent:screening`. Stage advances stay human (A9); a bulk "advance
shortlisted" action is still a human action.

**Candidates without logins.** Bulk upload and the apply page create
candidates with no user account (`user_id` null), plus `email`, `phone` and
`source` columns (additive). An account is created only on invitation.

**De-duplication.** Before creating a candidate: same email, same phone,
same CV hash, or the same normalised name with an overlapping employer. A
match attaches a new application to the existing candidate and records why.

**Later tables** (added in their batches, same tenant-scoped pattern):
`offers` (versioned, approvals), `messages` (outbox and inbox with a `locale`
field, English only in phase 1), `meetings` (scheduling), `assessments` and
`assessment_attempts`. Stage history comes from audit `stage_advance`
events, not a second table.

**Role.** A new `hr` role approves requisitions and offers and sees every
pipeline and the reports. It uses the recruiter app, with navigation by role.

**Laws carried over.** Every store method is tenant-scoped; scores, rank,
knockouts, overrides, salary bands and unsent offer terms are internal and
never reach a candidate projection; every mutation is audited; agents
suggest, humans decide.

## ADR-0025: The rest of the lifecycle: communications, scheduling, assessments, live assist and SSO

Date: 2026-10-02. Status: accepted. Extends ADR-0024 (batch 2 of the "build
now, fully real" plan). Every module below is deterministic first, and every
external service sits behind an interface that fails closed.

**Communications.** Every automated candidate message is a stored `Message`,
never a flow side effect. The template catalog has an English and an Arabic
variant per event; the locale decides the render. The transport
(`MessageProvider`) fails closed: with no `CERTAINTY_MESSAGE_URL`, messages
stay `queued` and the outbox shows why. An inbound reply matching an
escalation cue (in either language) flips to `escalated` for a human rather
than being answered by an agent. Renders obey L8.

**Scheduling.** `proposeSlots` is deterministic from windows and duration.
A `Meeting` carries its own change history. The calendar file is a
standards-compliant ICS any client opens. The calendar provider (Microsoft
365 in production) fails closed: with no configured endpoint the meeting and
the ICS still exist. Confirm and reschedule queue a reminder through the
communications outbox. Times are UTC instants; the timezone is carried for
display.

**Assessments.** Multiple choice is exact; text and code score on rubric term
coverage. No model is in the scoring path, so a score never moves between
identical runs. Scores are min-max normalized across the cohort, recomputed
on every submit. Anomalies (`fast_completion`, `impossible_speed`,
`straightlining`, `duplicate_attempt`, `outlier`) are flagged to aid a human,
never to change the score. The candidate view carries no flags.

**Live interview assist and voice completion.** Follow-up suggestions target
the weakest part of each answer (no result, no context, "we" for decisions),
one per answer. Compliance-sensitive **questions** (age, family status,
religion, national origin, health or disability, political affiliation,
gender or orientation) are flagged to the interviewer, never accused.
`completeVoiceSession` evaluates the transcript, writes the metrics and a
deterministic summary with structured notes, and marks the session complete.

**Model-assisted parsing.** The deterministic parser in `agents.ts` is the
floor and always runs first. The model is consulted only when it found no
roles, only on sanitized text (L1), and only its shape-validated output is
used; anything otherwise falls back to the scripted result. The provider is
optional in `ApiDeps`.

**SSO.** Microsoft Entra sits behind an `SsoProvider`. The route is public
but verified, fails closed with no configured verify URL, and never creates
an account: a person is signed in only if their email already has a user, and
only in that user's tenant.

**Frontend.** The recruiter app gains Requisitions, Requisition detail
(ranked pipeline, overrides, offers) and Reports (HR and admin only). The
candidate app gains Offers (accept or decline). A public apply page at
`/apply/:id` renders only open requisitions and only their public fields.

## ADR-0026: The landing page returns to the product's design system

Date: 2026-10-02. Status: accepted. Supersedes the "deliberately separate
design system" decision of ADR-0017 for the visual design, and leaves the
scrollytelling, screenshots and lightbox mechanics of ADR-0017 intact.

**Why.** The marketing page had drifted into its own register: bold sans
display, Bauhaus colour blocks, ochre/terracotta/forest accents, its own
type scale and button shapes. Read next to the app it was plainly a
different product. The Notary language (ADR-0023) is the company now, so
the public page should be the same product seen from the street.

**What changed.** `marketing.html` links `tokens.css` and is composed on the
app's tokens. The top bar mirrors the app rail: brand lockup left, the
navigation a centred pill, the theme toggle and `Sign in` on the right. The
hero is the display serif in navy with the mark-stamp legend and a framed
product screenshot carrying the guilloche band and the seal; the decorative
Bauhaus shapes are gone. The feature grid is hairline sheets with brand-ink
icons, the compare table is ruled like the app's evidence table, the stats
and interview bands are the inverse stage, and the pricing cards and CTA use
the app's buttons and border language. Buttons, marks, stamps and type roles
come straight from `tokens.css`; `marketing.css` is reduced to layout and a
few page-specific classes.

**Shared mechanics.** The page now uses `shared/theme.ts`, so the light/dark
choice is the same `certainty_theme` key and the same `[data-theme]` switch
as the app. The reveal-on-scroll gained a small sweep so that jumping to an
anchor (the nav links) never leaves a heading stuck at opacity 0.

**No build or CSP change.** Still same-origin, no inline styles or scripts,
the same font import through `tokens.css`.

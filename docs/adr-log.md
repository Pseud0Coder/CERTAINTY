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

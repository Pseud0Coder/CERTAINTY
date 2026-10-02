# Certainty
### Design language for Gennext Recruitments · v1.0
Fills section 9 of the Stage 1 technical spec. No visual value is left undecided.
House rules honoured throughout: no emoji, no em dashes in any string, no all-caps labels, WCAG AA floor, keyboard path for everything.

> Status note (2026-10-01): ADR-0015 and ADR-0016 moved away from this document's palette and flat surfaces; ADR-0021 returns to them. Current values live in tokens.css and the ADR log; where they differ from this document (type sizes, radius, the icon set), the ADR log wins.

---

## 1. The thesis

The product has exactly one job that nothing else in a recruiter's stack does: **it separates what a candidate claimed from what has been verified.**

So certainty is the design language. Not "clean SaaS", not "dossier", not a skin. Every visual decision answers one question: *how sure are we about this?*

Three consequences, and they drive everything below:

1. **The interface is achromatic. Only evidence is coloured.** Neutral ground, black ink, black primary actions. Hue is a scarce resource spent only on severity, recording, and focus. A screen with nothing at stake has no colour in it at all.
2. **Certainty is encoded in a glyph, not a tint.** One 12px mark, four fill states, used everywhere evidence appears. Shape carries the meaning, colour reinforces it. Legible in greyscale, legible to colour-blind users, legible at 12px.
3. **Internal content is inverted, not tinted.** Recruiter-only blocks render on the opposite ground to the rest of the app. If an internal block ever leaks into the candidate app, it will look broken. The design enforces the RBAC rule.

Boldness is spent in one place: the certainty mark. Everything around it stays quiet.

---

## 2. What I rejected, and why

Recorded so the build does not drift back toward it.

| Rejected | Reason |
|---|---|
| Warm cream ground with serif display | The current default look for "considered software". Reads templated, and warm paper fights a product about cold verification. |
| Tinted near-black ink (#111, #0B0B0B) | A hedge. Ink is `#000000` because evidence either exists or it does not. |
| All-caps tracked labels above every heading | Template chrome. Section headings are sentence case at body size. |
| Monospace for small data labels | Mono is reserved for handoff blocks, per spec. Numerals carry the data personality instead, via tabular figures. |
| Pastel tinted alert boxes for severity | Four severities times three statuses times tinted backgrounds is visual noise and fails greyscale. Severity is a 2px spine plus a mark plus a word. |
| Coloured brand accent for primary actions | Would spend the colour budget on a button. Primary action is black fill. |
| Hover transitions on every card, entrance animations per section | Scattered motion. One orchestrated moment only: the consent modal. |
| Pill radius as a global style | Pill is a signal here, not a shape. It appears twice in the whole system. |

---

## 3. Base palette

Six named base values. Achromatic on purpose.

| Name | Light | Dark | Use |
|---|---|---|---|
| `ground` | `#EFEFEF` | `#131313` | App background. The desk. |
| `sheet` | `#FFFFFF` | `#1B1B1B` | Raised content. Cards, panels, modal. |
| `rule` | `#DCDCDC` | `#2E2E2E` | Hairline. The primary structural device. |
| `ink` | `#000000` | `#FFFFFF` | Primary text, primary action fill. |
| `ink-quiet` | `#5C5C5C` | `#9A9A9A` | Secondary text, captions, metadata. |
| `stage` | `#1C1C1C` | `#F5F5F5` | Internal-only surface. Always the inverse of `ground`. |

Semantic hues. Four, total, in the entire product.

| Role | Light | Dark | Where it is allowed |
|---|---|---|---|
| `severity-positive` | `#14664A` | `#4FBE92` | Discovered strength: a claim worth adding to the CV. |
| `severity-warning` | `#8A4B0A` | `#D99A3D` | Gap, or a conflict between two sources. |
| `severity-blocking` | `#B0231A` | `#F0837A` | Blocks submission. Rare by design. |
| `recording-active` | `#E01B0F` | `#FF5247` | Verified sessions only. The one saturated, animated, large element. |
| `focus-ring` | `#1A5FD0` | `#5C9BFF` | Focus only. This hue means nothing else, ever. |

`severity-confirmed` has no colour. It resolves to `ink`. Confirmed facts are simply black.

Chromatic budget: **at most three coloured marks visible in any one region.** If a pipeline column shows four warnings, the badge counts them; the cards do not each shout.

---

## 4. Type

System stack only, since the spec forbids network calls and build steps. One family, three weights, and the numerals do the expressive work.

```
sans : -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif
mono : ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace   /* handoff blocks only */
```

| Role | Size / line | Weight | Tracking | Notes |
|---|---|---|---|---|
| `display` | 26 / 32 | 500 | -0.015em | Candidate name, agency name at login. Sentence case. |
| `view-title` | 20 / 26 | 600 | -0.01em | Module title in the topbar. |
| `section-heading` | 14 / 20 | 600 | 0 | Sentence case, no rule above, no eyebrow. |
| `body` | 14 / 21 | 400 | 0 | Default. Measure capped at 68ch in prose regions. |
| `secondary` | 13 / 19 | 400 | 0 | `ink-quiet`. Supporting lines inside cards. |
| `caption` | 12 / 17 | 400 | 0 | Metadata, audit lines, retention notes. `ink-quiet`. |
| `tabular-numeral` | 13 / 18 | 500 | 0 | `font-variant-numeric: tabular-nums slashed-zero`. |
| `mono` | 13 / 20 | 400 | 0 | Handoff blocks. Nowhere else. |

Rules:
- Every numeral in a data region uses the tabular role, so columns of percentages, durations and counts align vertically without a table.
- Never bold a single word inside a sentence for emphasis. If something needs weight, it needs its own line.
- Sentence case everywhere, including buttons, chips and stamps.

---

## 5. Signature devices

Five. Implement these and the language is present even before the components exist.

### 5.1 The certainty mark
A 12px square SVG, `currentColor`, 1.25px stroke, square caps. Four states:

| Mark | Meaning | Colour |
|---|---|---|
| Filled square | Confirmed in two sources | `ink` |
| Diagonal half fill | Claimed, one source only | `severity-positive` |
| Hollow, hairline | Nothing found for this requirement | `severity-warning` |
| Hollow with a slash | Two sources disagree | `severity-warning` |

Appears in: flag cards, transcript annotations, submission evidence rows, the LinkedIn checklist, the QA checklist. Always paired with a word. Never alone as the only label.

### 5.2 The hairline grid
Structure comes from 1px rules, not from gaps, shadows or nested cards. Pipeline is five columns divided by vertical hairlines; cards inside a column are divided by horizontal hairlines and share one continuous sheet. No card carries a shadow.

### 5.3 Reveal on approach
Row actions sit at `opacity: 0` and rise to 1 on `:hover`, `:focus-within`. Space is always reserved, so nothing reflows. The element stays in the DOM and the accessibility tree at all times, so keyboard and screen reader users lose nothing. This is the only hover effect in the system.

### 5.4 The inverse stage
Internal-only regions render on `stage` with inverted text. A one-line banner sits at the top of the region in `caption`: "Internal only. Never shown to the candidate." The audit line sits at the bottom in `caption`. No hatching, no tint, no lock icon required.

### 5.5 The stamp
A verification fact renders as a bordered inline chip: hairline border, 3px radius, `caption` size, sentence case, certainty mark plus text plus date. "Verified session, 12 Apr 2026". "Consented 12 Apr 2026, 90 day retention". Stamps are never coloured pills and never decorative.

---

## 6. Space, radius, elevation, motion

**Spacing.** 4px base. Scale: 4, 8, 12, 16, 24, 32, 48, 64.
Density rule: data regions use 4 / 8 / 12 only. Empty states use 32 / 48. Nothing in between, so density itself signals which kind of region you are in.

**Radius by role**, not one value everywhere:
- `0` structural regions: pipeline columns, table cells, transcript rows
- `3px` controls: buttons, inputs, chips, badges, stamps
- `6px` raised sheets: modal, popover, handoff block
- `pill` exactly two elements: the recording indicator and the practice/verified toggle

**Elevation.**
- `0` hairline only. Default for everything, cards included.
- `1` popover: `0 1px 2px rgba(0,0,0,.06), 0 8px 24px rgba(0,0,0,.08)` plus hairline.
- `2` modal only: `0 24px 64px rgba(0,0,0,.20)`, scrim `rgba(0,0,0,.36)`, no backdrop blur.

**Motion.**
- `micro` 120ms, `standard` 200ms, easing `cubic-bezier(.2,0,0,1)`.
- Only opacity and 2 to 8px translate. No scale on press. No spring.
- Layout of data rows is never animated.
- **One orchestrated moment:** the consent modal. Scrim fades 120ms, sheet rises 8px over 200ms. It is the one consequential action in the product, so it is the one thing that moves.
- **One continuous animation:** the recording dot, 1.6s ease-in-out opacity 1 to 0.35. Under `prefers-reduced-motion` it becomes a static filled dot; the word "Recording" and the outline carry the state regardless.

**Icons.** One line set, 1.5px stroke, square caps, miter joins, 16px and 20px grid, `currentColor`. Nine icons total: chevron-right, chevron-down, check, plus, copy, play, pause, lock, close. Certainty marks are not icons and live outside this set. No emoji anywhere.

---

## 7. Layout

```
RECRUITER                                            CANDIDATE
+--------+------------------------------------+      +------------------------------+
| rail   | topbar: view title      role badge |      | topbar: title    agency name |
| 216px  +------------------------------------+      +------------------------------+
|        | S'ning | Sub draft | Client | Int  |      |  progress stepper            |
| Pipe   |--------|-----------|--------|------|      |  o----o----o----x            |
| Screen |[card]  |[card]     |        |[card]|      +------------------------------+
| Submit |--------|-----------|        |------|      |  module cards, stacked       |
| Notes  |[card]  |           |        |      |      |  measure capped at 68ch      |
| Set    |--------|           |        |      |      |                              |
|        | parked row, collapsed, one line    |      |                              |
+--------+------------------------------------+      +------------------------------+
```

Candidate detail drill-in, transcript tab:

```
+----------------------------------------------------------+
| Priya Anand                            Screening   4y 2m |  display + stamp
+----------------------------------------------------------+
| Insights | Transcript | Gap flags | Notes                |  hairline underline on active
+--------+-------------------------------------------------+
| 00:04:12| Recruiter: text of the question here           |  56px timecode column,
|        | Candidate: text of the answer here              |  tabular figures, right aligned
|        |   [half-fill mark] Claimed, one source only     |  annotation indented under the turn
| 00:05:38| ...                                            |
+--------+-------------------------------------------------+
```

Alignment: everything left aligned to one rule. No centred text except inside empty states. The 56px timecode column exists only in transcript and audio views, where timecodes are real data.

**Responsive.**
- ≥1100px: full rail, five pipeline columns.
- 720 to 1099: rail collapses to 56px icon-only with tooltips and full labels in the accessibility tree; pipeline scrolls horizontally with hairline column headers pinned.
- <720px: rail becomes a bottom bar, 5 items max; pipeline becomes stacked stage sections, collapsed by default with a count in the header; the timecode column moves inline above each turn as a caption; tabs become a horizontally scrolling strip with the hairline underline preserved; the consent modal goes full-screen with the confirm control fixed to the bottom.
- No horizontal scroll in the candidate app at any width. Data reflows to label and value pairs.
- Touch targets 44px minimum below 720px. Reveal-on-approach actions are always visible on touch, since there is no hover.

---

## 8. Component treatments

Mapped to the section 6 inventory. States only where they differ from the defaults above.

**App shell.** Rail on `ground`, content on `ground`, panels on `sheet`. One hairline between rail and content. Role badge is a stamp, not a coloured pill.

**Nav item.** Default `ink-quiet`. Hover: `ink`, no background. Active: `ink` at weight 600 plus a 2px `ink` bar on the leading edge. Disabled: `ink-quiet` at 45%, `aria-disabled`, still focusable.

**Pipeline card.** Sheet, no radius, hairline separated. Name at `body` 600, target role at `secondary`. Flag counts as square badges, right aligned, tabular. Flagged: nothing changes on the card body; the badge carries it. Parked: 2px dotted spine, name at `ink-quiet`. Advance affordance reveals on approach at the trailing edge, label "Advance to Submission draft", never a bare arrow.

**Badge / chip.** 3px radius, hairline, `caption`, sentence case. Flag count badges are square with tabular numerals. Quarantined chip carries a hollow certainty mark. Never a coloured fill; colour appears in the mark and the text only.

**Tab set.** Hairline underline across the full width; active tab has a 2px `ink` segment. Roving tabindex, arrow keys move, Home and End jump. Focus ring on the tab, not the panel.

**Proportion bar.** 6px tall, `rule` track, `ink` fill, target as a 2px `ink` tick on the track. Over or under target is stated in words plus a tabular number to the right in a fixed 5ch column. Never red for "under". A missed target is information, not a failure.

**Split bar.** Two segments, `ink` and `rule`, hairline between them. Both percentages printed, tabular, one at each end.

**Flag card.** The most-used component and the identity carrier. Sheet, 3px radius, 2px severity spine on the leading edge. Row one: certainty mark, severity word, type in plain language. Row two: the quote at `body`, capped at 68ch. Row three: two source lines at `caption`. Row four: action row, revealed on approach, with one primary and one quiet action. Status: `open` full opacity; `actioned` adds a stamp "Sent to Resume Studio, 12 Apr"; `resolved` drops to 60% opacity, spine goes to `rule`, actions removed.
Candidate variant: the projection layer strips severity, so the spine class is never emitted. Task cards get a neutral `rule` spine, task-phrased headline, no severity word, no source lines.

**Consent modal.** Sheet at elevation 2, 6px radius, 480px wide, 32px padding. Title as a question in sentence case. Scope as three lines each with a certainty mark. Checkbox gated, and the confirm button is `aria-disabled` with a visible disabled state until checked. Focus trapped, focus lands on the title, ESC cancels, cancel restores practice with no record written. Confirm label "Start recorded session". Cancel label "Keep practicing privately". This is the one animated moment in the product.

**Mode toggle.** Pill, hairline, two segments, `ink` fill on the selected one with inverted text. The verified segment shows a hollow lock at 16px until consent exists. Radio group semantics, arrow keys move, activation is deliberate rather than on focus.

**Stepper.** Done: filled certainty mark plus label at `ink`. Current: half-fill mark, label at 600. Pending: hollow mark, label at `ink-quiet`. Locked: hollow mark plus lock icon plus a caption naming the unlock condition. Connectors are 1px `rule`, `ink` on completed segments.

**Chat surface.** AI turn on `ground`, no bubble, no avatar, speaker named at `caption` 600 above the text. User turn on `sheet` with a hairline, indented 32px. Feedback card is a distinct block with a hairline top rule and a `section-heading`. Measure 68ch throughout.

**Handoff block.** 6px radius, `sheet`, hairline, mono, 16px padding, `white-space: pre`. Copy action in the top trailing corner, always visible. Label "Copy bullets", toast "Bullets copied", plus an `aria-live="polite"` announcement so the toast is never the only feedback. No narration path exists in the UI.

**Audio player.** Single row: play or pause at 20px, elapsed and total in tabular figures, a hairline scrub track with an `ink` fill, then a consent stamp and a retention caption. No waveform. A waveform would be decoration here.

**Notes panel.** Inverse stage per 5.4. Fields as label and value pairs, label at `caption`, value at `body`. To-verify list uses hollow certainty marks. Audit line at the bottom in `caption`: "Viewed by 3 recruiters. Last opened 12 Apr 2026."

**Toast.** Bottom leading corner, `sheet`, elevation 1, 3px radius, `body`, 4s, dismissible. Always mirrors a permanent state change elsewhere on screen, and always announced via `aria-live`.

**Empty state.** Generous space, 32 to 48px. One sentence in the interface voice, one action. Sentence case, active voice, no apology.
- Pipeline column: "No candidates in this stage." / "Add candidate"
- Candidate gaps: "Nothing to fix right now. Your CV and your interview answers line up."
- Submission sources: "Add four sources to generate deliverables. Two are in." / "Add source"

---

## 9. Accessibility contract

- Focus ring: 2px `focus-ring`, 2px offset, on every interactive element including custom controls. Never removed, never replaced by a colour change alone. On `ink` surfaces the ring keeps its hue and gains a 1px `sheet` inner edge so it survives the dark fill.
- Contrast targets: text ≥ 4.5:1, large text and non-text ≥ 3:1. Verify these pairs specifically, they are the tightest: `ink-quiet` on `ground`, `severity-warning` on `sheet`, `severity-positive` on `sheet`, disabled states.
- Severity, certainty and status are never colour alone. Mark plus word plus colour, in that priority order.
- Recording state carries four simultaneous signals: pulsing dot, `recording-active` outline, the word "Recording", and an `aria-live` announcement on start and stop. Unmistakable was the requirement.
- Keyboard: tabs use a roving tabindex, the modal traps focus and returns it to the trigger on close, ESC cancels every dismissible surface, the pipeline is a listbox per column with arrow key navigation, and the advance action is reachable without hover.
- `prefers-reduced-motion` removes the modal rise and the recording pulse. Nothing else moves anyway.

---

## 10. Build priority

Re-issue in this order. Each tier is shippable and reviewable on its own.

**Tier 1, the language layer.** Nothing looks right until these exist.
1. Token layer and base reset, both colour schemes
2. Type roles including the tabular numeral utility
3. Certainty mark, all four states, as a single reusable SVG function
4. Hairline grid primitives: region, column, row
5. Focus ring and the keyboard base
6. Button set: primary black fill, quiet, disabled
7. Stamp
8. Empty state

**Tier 2, the identity carriers.** Highest visual risk and highest use.
9. Flag card, all four types by three statuses, recruiter and candidate variants
10. Consent modal with the focus trap and the one orchestrated moment
11. Recording indicator plus mode toggle
12. Pipeline column and card, including parked and reveal-on-approach advance
13. Inverse stage and the notes panel

**Tier 3, the data instruments.**
14. Proportion bar and split bar
15. Tab set with roving tabindex
16. Transcript row with the timecode column and inline annotations
17. Stepper
18. Handoff block with copy and the live region

**Tier 4, the remainder.**
19. Chat surface and feedback card
20. Audio player stub
21. Toast
22. Submission stepper source chips and the QA checklist

Ship Tier 1 and Tier 2 before writing any screen. If the flag card and the consent modal are right, the rest of the product follows.

---

## 11. Anti-patterns that would break this language

- Adding a brand hue and using it for primary actions
- Tinted card backgrounds for severity
- Shadows on flag cards or pipeline cards
- Pill radius on anything other than the recording indicator and the mode toggle
- All-caps tracked labels, or a monospace face outside handoff blocks
- Icons standing in for words in severity, status or actions
- Hover-only affordances with no keyboard equivalent
- Any second continuously animating element
- Centred text outside empty states
- Colour used as the only carrier of any meaning

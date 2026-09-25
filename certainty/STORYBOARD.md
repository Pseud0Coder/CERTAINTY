---
format: 1080x1080
duration: 40s
message: "Certainty is recruiting software that separates what a candidate claims from what's been verified, end to end."
arc: Feature-Benefit Cascade — hook -> research -> resume studio -> verified interview -> document security -> recruiter pipeline -> shareable proof -> brand close
audience: recruiters and hiring teams evaluating a recruitment evidence platform
mode: collaborative
music: none
---

## Video direction

- **v5: 40s, full feature tour, one unified layout regardless of screenshot shape.** v4 (20s, 5 beats) covered research, interview, and the shareable profile. This version doubles the length and adds resume studio (role-by-role CV rebuild), document quarantine/security, and the recruiter pipeline, so the tour covers most of the real product. It also fixes a clarity gap: v4's copy never said what kind of claims were being verified. From Beat 2 on, the copy names the category directly ("Recruiting software for hiring teams") and keeps "candidate" in the line wherever natural.
- **One screenshot, one recruiter-side desktop screen.** Every beat but one uses a real mobile-viewport screenshot (`assets/mobile-*.png`, 780px native width) in a portrait phone frame. Beat 6 (the recruiter pipeline board) is genuinely desktop-shaped software - recruiters manage a multi-column board, not a phone screen - so it uses the real desktop capture (`assets/flow-pipeline.png`, 1600x1000) in a wide bordered panel instead of forcing it into a phone frame.
- **Unified top-screenshot / bottom-copy template, every beat (this is the fix for "flows seamlessly" across mixed orientations).** Screenshot zone: a bordered window (1px `#C9A227`, rounded corners - 32px for the phone frames, 14px for the one desktop panel), box `top:70, height:590`, horizontally centered on the 1080-wide canvas (mobile window `width:330` -> `left:375`; the one desktop window `width:900` -> `left:90`, height computed from its own 1600x1000 aspect at that width, i.e. 900 * (1000/1600) = 562.5, so `height:563`). Copy zone: two centered lines directly below, Georgia serif, starting around `top:720`, inside a centered text column `left:100, width:880`. Nothing in either zone comes within a few px of the bottom edge - stay well clear of it. Frame 1 (the cold open) uses the same screenshot geometry but no copy beneath it (its own real headline already carries the message); every other beat has both zones filled.
- **Palette** (from `frame.md`): cream `#FBF7EC` ground, ink `#1B1712` text, ochre `#C9A227` accent/hairline, forest `#55703F` secondary accent, deep ochre `#8A6A1E` for any ochre-colored TEXT specifically (plain `#C9A227` fails WCAG contrast on cream for body-sized type - a real check failure caught once already in this project, do not reintroduce it).
- **Type**: `"Georgia", serif` for every set-copy element and the "Certainty" wordmark (a real system font, declared via `@font-face { font-family: 'Georgia'; src: local('Georgia'); }` in every frame that sets any text - HyperFrames' `check` step hard-fails on a named font with no `@font-face`/`local()` declaration; confirmed this exact pattern works elsewhere in this project - do not use a bare Google Font name without this, and do not skip the declaration).
- **CRITICAL - a real bug from the previous version, do not repeat it:** every positioned screenshot window (`.beatN-window` or similar) MUST have `position: absolute` explicitly set in its own CSS rule, even though its parent `.clip` wrapper already has `position:absolute`. A frame in the previous version omitted `position` on the window element itself; the window defaulted to `position:static`, its `left`/`top` were silently ignored, and its absolutely-positioned child (the inner scrollable "world" layer) escaped to position itself against a different ancestor entirely, rendering at nearly full-canvas size and covering the copy beneath it. Before finishing, confirm your window element's own CSS rule includes `position: absolute;` explicitly - do not assume it's inherited.
- **Motion grammar**: `power3` for all camera/text moves, no bounce. Every beat has continuous, deliberate motion (a slow push, pan, or content-swap crossfade) - nothing sits frozen for more than a beat's opening/closing settle. Text reveals stagger word-group by word-group (never the whole line at once), timed to their own cue, spread across the beat, not dumped at t=0.
- **Transitions**: `zoom-through` at the two structural boundaries (Frame 1 -> Frame 2, the cold open into the tour; Frame 7 -> Frame 8, the tour into the brand close). `crossfade` between every beat within the tour itself (Frames 2-7).
- **Negative list**: no stock imagery, no invented UI, no browser chrome beyond what the real screenshots show, no beat that is purely static, no bounce easing, no screenshot forced into the wrong-shaped frame (desktop content never squeezed into a portrait phone, and vice versa).

## Frame 1 - Claimed. Verified. Never confused.

- scene: The real marketing homepage hero, mobile viewport, in the shared phone-frame geometry with a slow continuous push-in - no added copy, its own real headline carries the cold open
- voiceover: ""
- duration: 5s
- transition_in: cut
- status: animated
- src: compositions/frames/b1-hook.html
- type: hook
- persuasion: Negative contrast (a claim vs. a verified fact)
- beat: clarity
- blueprint: titlecard-reveal (Reproduce)
- focal: assets/mobile-hero.png
- roles: mobile-hero.png = cutout (phone frame, top zone, foreground subject)
- asset_candidates: assets/mobile-hero.png — the real marketing homepage hero, mobile viewport (native 780x1688 at 2x): "RECRUITING SOFTWARE" badge, headline "Claimed. Verified. Never confused.", subhead ("The platform recruiters use to separate what a candidate claims from what the evidence actually shows"), CTA buttons

Cold open on the product's own real promise. The screenshot's own subhead already names the category and the audience; nothing is added on top of it. Same shared window geometry as every later beat (top:70, mobile phone width 330 centered) even though there is no copy beneath it this time - the empty lower zone is deliberate, a breath before the tour starts.

Scene 1 (0.0-0.3s): phone frame enters filling its zone (opacity 0->1, scale 1.06->1.02, power3.out) - visible well before 0.5s.
Scene 2 (0.3-4.6s): one continuous slow push-in inside the frame, scale 1.02 -> 1.08, transform-origin toward the headline, power3, spanning nearly the whole beat - never fully static.
Scene 3 (4.6-5.0s): settle, at most a subtle jitter.

## Frame 2 - Recruiting software for hiring teams

- scene: The real candidate dashboard, mobile viewport, in the shared phone-frame geometry, with copy beneath naming the category directly
- voiceover: ""
- duration: 5s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/b2-research.html
- type: feature_showcase
- persuasion: Show-don't-tell proof
- beat: confidence
- blueprint: device-surface-showcase (Reproduce)
- focal: assets/mobile-dashboard.png
- roles: mobile-dashboard.png = cutout (phone frame, top zone) - copy = supporting (bottom zone)
- asset_candidates: assets/mobile-dashboard.png — the real candidate dashboard, mobile viewport (native 780x1688 at 2x): the gated journey grid and the start of the research-report findings cards

This is the beat that answers "whose claims, exactly?" - the first line names the category and audience outright before the value line follows.

Scene 1 (0.0-0.3s): phone frame settles into the top zone, opacity 0->1 + slight scale settle, power3.out - visible before 0.5s.
Scene 2 (0.3-1.4s): copy line 1 reveals, centered beneath the phone: "Recruiting software for hiring teams." (word-group stagger, power3.out).
Scene 3 (1.4-2.6s): copy line 2 reveals beneath it: "Every candidate claim, checked against evidence." (same stagger) - while the phone frame's inner image begins a slow continuous scale push-in (transform-origin toward the research-report card area), arriving by ~4.2s.
Scene 4 (2.6-4.6s): push-in continues/settles, the findings cards readable; both copy lines fully settled, holding.
Scene 5 (4.6-5.0s): settle, at most a subtle jitter.

## Frame 3 - Their real answers, not a template

- scene: The real "My Resume" page, mobile viewport, showing three completed roles and the start of the revamped CV, in the shared phone-frame geometry
- voiceover: ""
- duration: 5s
- transition_in: crossfade
- status: animated
- src: compositions/frames/b3-resume.html
- type: feature_showcase
- persuasion: Feature-to-benefit translation
- beat: confidence
- blueprint: device-surface-showcase (Reproduce)
- focal: assets/mobile-resume.png
- roles: mobile-resume.png = cutout (phone frame, top zone) - copy = supporting (bottom zone)
- asset_candidates: assets/mobile-resume.png — the real "My Resume" page, mobile viewport (native 780x1688 at 2x): "One role per session, in depth. Each role gets its own interviewer.", three role cards marked Complete/Done, and the top of the real revamped CV panel

Third stop: the resume itself isn't rewritten by a template - it's rebuilt one real role at a time.

Scene 1 (0.0-0.3s): phone frame settles into the top zone, visible before 0.5s.
Scene 2 (0.3-1.4s): copy line 1 reveals: "Their real answers, not a template." (word-group stagger).
Scene 3 (1.4-2.6s): copy line 2 reveals: "Every role, rebuilt bullet by bullet." - the phone frame's inner image begins a slow continuous scale push-in (transform-origin toward the "Revamped CV" panel at the bottom of the screenshot), arriving by ~4.2s.
Scene 4 (2.6-4.6s): push-in continues/settles on the CV panel; copy fully settled.
Scene 5 (4.6-5.0s): settle, at most a subtle jitter.

## Frame 4 - Every candidate interview, scored the same way

- scene: Two real mobile states of the candidate-detail page - the top (journey, shareable link) content-swapping to the real STAR proportions - in the shared phone-frame geometry
- voiceover: ""
- duration: 5s
- transition_in: crossfade
- status: animated
- src: compositions/frames/b4-interview.html
- type: feature_showcase
- persuasion: Statistical proof
- beat: trust
- blueprint: dataviz-countup (Adapt) - the STAR percentages are the proof; the copy and the content-swap land together
- focal: assets/mobile-detail-top.png
- roles: mobile-detail-top.png = cutout (phone frame, first state) - assets/mobile-detail-star.png = cutout (phone frame, second state - a real content-swap between two actually-captured mobile states, this app's own internal scroll container doesn't expose one continuous tall plate) - copy = supporting
- asset_candidates: assets/mobile-detail-top.png — candidate-detail page, mobile viewport, top: name, journey progress, the Shareable profile panel, the top of STAR proportions; assets/mobile-detail-star.png — the same page scrolled to the real STAR proportions (Situation/Task/Action/Result, real percentages), Ownership, and Ingested sources

Fourth stop: the interview itself, graded by a fixed evaluator, not a recruiter's gut read.

Scene 1 (0.0-0.3s): phone frame settles into the top zone, showing `mobile-detail-top.png` - visible before 0.5s.
Scene 2 (0.3-1.4s): copy line 1 reveals: "Every candidate interview." (word-group stagger).
Scene 3 (1.4-2.6s): copy line 2 reveals: "Scored the same way, every time." - at the same moment, the phone frame's content crossfades from `mobile-detail-top.png` to `mobile-detail-star.png` (~0.4s), landing on the real STAR percentages.
Scene 4 (2.6-4.6s): held on the STAR percentages, clearly readable; copy fully settled.
Scene 5 (4.6-5.0s): settle, at most a subtle jitter.

## Frame 5 - Every document, quarantined first

- scene: The same candidate-detail page as Frame 4, scrolled state, but this beat's push-in lands on the "Ingested sources" panel further down the same real screenshot - the document-security story
- voiceover: ""
- duration: 5s
- transition_in: crossfade
- status: animated
- src: compositions/frames/b5-security.html
- type: feature_showcase
- persuasion: Risk reversal
- beat: trust
- blueprint: device-surface-showcase (Adapt) - reuses Frame 4's second real screenshot, a different crop/push target within the same real page rather than a new capture
- focal: assets/mobile-detail-star.png
- roles: mobile-detail-star.png = cutout (phone frame, top zone, pushed toward its lower "Ingested sources" section) - copy = supporting
- asset_candidates: assets/mobile-detail-star.png — the same real candidate-detail screenshot used in Frame 4. Its lower section (below the STAR bars) shows an "Ingested sources" panel (resume, transcript, linkedin snapshot, jd, all marked Clean) and the real line "Documents are extracted to structured fields. Embedded instructions are stripped at ingestion. Injection attempts are logged, never executed."

Fifth stop: before any of that scoring happens, every document passes through quarantine - a real security property of the product, not a marketing claim.

Scene 1 (0.0-0.3s): phone frame settles into the top zone, initially framed on the STAR proportions area (matching where Frame 4 left off, for a seamless crossfade hand-off) - visible before 0.5s.
Scene 2 (0.3-1.4s): copy line 1 reveals: "Every document, quarantined first." (word-group stagger) - at the same moment, the phone frame's inner image begins a continuous scale push-in, transform-origin moving toward the "Ingested sources" section further down the same screenshot.
Scene 3 (1.4-2.6s): copy line 2 reveals: "Embedded instructions, stripped before any agent reads them." - push-in continues, landing on the "Ingested sources" cards and the real "stripped at ingestion" line by ~4.0s.
Scene 4 (2.6-4.6s): push-in settled, the ingestion-security text readable; copy fully settled.
Scene 5 (4.6-5.0s): settle, at most a subtle jitter.

## Frame 6 - One pipeline, every candidate's real stage

- scene: The real recruiter pipeline board - genuinely desktop-shaped software, so this is the one beat using the desktop capture in a wide bordered panel instead of a phone frame, same top-zone/bottom-copy template as every other beat
- voiceover: ""
- duration: 5s
- transition_in: crossfade
- status: animated
- src: compositions/frames/b6-pipeline.html
- type: feature_showcase
- persuasion: Show-don't-tell proof
- beat: confidence
- blueprint: device-surface-showcase (Reproduce) - desktop panel variant of the same blueprint, wide window instead of a phone frame, otherwise the identical top-zone/bottom-copy template as every sibling beat
- focal: assets/flow-pipeline.png
- roles: flow-pipeline.png = cutout (wide desktop panel, top zone) - copy = supporting (bottom zone)
- asset_candidates: assets/flow-pipeline.png — the real recruiter pipeline board, desktop viewport (native 1600x1000): candidates grouped by stage column (Screening / Submission draft / With client / Interview / Offer), Nadia Rowe's card visible in Screening

Sixth stop, a deliberate register shift: this is the one screen recruiters actually run on a desktop, so it's shown at its real shape - same top-zone/bottom-copy frame as every mobile beat around it, so the tour still reads as one piece.

Scene 1 (0.0-0.3s): the wide desktop panel settles into the top zone (opacity 0->1, slight scale settle, power3.out) - visible before 0.5s.
Scene 2 (0.3-1.4s): copy line 1 reveals: "One pipeline, every candidate's real stage." (word-group stagger).
Scene 3 (1.4-2.6s): copy line 2 reveals: "Nothing about them lost in a spreadsheet." - the panel's inner image begins a slow continuous scale push-in, transform-origin toward the Screening column where Nadia Rowe's card sits.
Scene 4 (2.6-4.6s): push-in continues/settles; copy fully settled.
Scene 5 (4.6-5.0s): settle, at most a subtle jitter.

## Frame 7 - One link, for the hiring manager

- scene: The real shareable public-profile page, mobile viewport, a genuinely tall stitched plate, in the shared phone-frame geometry, panning down to the download buttons
- voiceover: ""
- duration: 5s
- transition_in: crossfade
- status: animated
- src: compositions/frames/b7-profile.html
- type: social_proof
- persuasion: Risk reversal
- beat: peace of mind
- blueprint: titlecard-reveal (Adapt) - the calm payoff beat; the "card" is a real scrolled mobile webpage plate, not a built title card
- focal: assets/mobile-profile-full.png
- roles: mobile-profile-full.png = cutout (phone frame, top zone, panning content) - copy = supporting
- asset_candidates: assets/mobile-profile-full.png — the real public candidate-profile page, mobile viewport, full-length stitched plate (native 780 wide, genuinely tall): verified badge, companies worked with, highlights, skills, education, download buttons at the foot

The payoff: everything proven across the tour becomes one link anyone can open on their phone, no login required.

Scene 1 (0.0-0.3s): phone frame settles into the top zone, showing the plate's own top (name, verified badge, companies) - visible before 0.5s.
Scene 2 (0.3-1.4s): copy line 1 reveals: "One link, for the hiring manager." (word-group stagger).
Scene 3 (1.4-2.6s): copy line 2 reveals: "Fully verified. Ready to download." - the phone frame's inner world layer begins a continuous slow pan downward via `y` transform (never `top`), a single power3 tween spanning roughly 1.4s-4.2s.
Scene 4 (2.6-4.6s): pan continues past highlights/skills toward the download buttons near the plate's foot; copy fully settled.
Scene 5 (4.6-5.0s): settle, at most a subtle jitter.

## Frame 8 - Certainty

- scene: The brand mark and the "Certainty" wordmark (Georgia) settle together center-stage, hold, then the wordmark text fades away, leaving the mark alone as the final image
- voiceover: ""
- duration: 5s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/b8-brand.html
- type: branding
- persuasion: Inevitability
- beat: inevitability
- blueprint: logo-assemble-lockup (Adapt) - the settle-into-lockup signature, plus the text-fades-leaving-the-mark-alone choreography this project's brief calls for
- focal: assets/logo-25b1d3a3.svg
- roles: logo-25b1d3a3.svg = cutout (the only visual element; the wordmark is set type, not an image)
- asset_candidates: assets/logo-25b1d3a3.svg — the Certainty brand mark (checkmark flowing into an open ring), currentColor stroke

The close: no further claim, just the signature, simplifying to its purest form before the video ends. Unchanged from the previous version's brand-close choreography, just a 1s-longer hold to match this version's slightly slower overall pace.

Scene 1 (0.0-1.0s): cream ground, empty. The mark draws on at center (stroke draw-on, power2.out) and settles; the "Certainty" wordmark (Georgia) fades in immediately beside/below it, completing the lockup by ~1.0s.
Scene 2 (1.0-3.2s): held together, mark and wordmark both fully visible, centered - the one deliberate full stop of the video.
Scene 3 (3.2-3.9s): the wordmark text fades out (opacity 1->0, power2.in, ~0.5s) while the mark stays exactly in place - the mark itself may re-center slightly if the lockup's shared center shifts once the wordmark is gone, via a smooth power3 move finishing by ~3.9s.
Scene 4 (3.9-5.0s): the mark alone, centered, fully static - this is the video's literal last image.

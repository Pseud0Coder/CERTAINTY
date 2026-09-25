---
workflow: product-launch-video
flow: automation
storyboard: yes
message: "Certainty keeps what a candidate claims separate from what's been verified, end to end."
destination: social-feed
aspect: 1080x1080
language: en
length: 40s
angle: show-it-as-is
---

## Revision v5 (40s, full feature tour)

Doubling the length to 40s and covering more of the platform: research,
resume studio (role-by-role CV rebuild), verified interview, document
quarantine/security, the recruiter pipeline, and the shareable verified
profile - 8 beats at 5s each. Unified layout across every beat regardless
of source orientation: the real screenshot (mobile phone frame OR, for
the one genuinely desktop-shaped screen - the recruiter pipeline board -
a wide bordered panel) always sits in the SAME top zone of the canvas,
with the ad copy always in the same bottom zone below it, centered. This
was an explicit ask: "if you are switching to desktop-style screenshots,
keep those screenshots at the top and add the text at the bottom so the
whole thing flows seamlessly."

Also: the copy must say what kind of claims are being verified, not just
"claims" in the abstract. Beat 2 names it directly ("Recruiting software
for hiring teams. Every candidate claim, checked against evidence.") and
every subsequent beat keeps "candidate" in the line where it fits
naturally, so nobody has to infer the category from the screenshots alone.

## Intent

Revision (v3): v2 (a literal Playwright-recorded cursor click-through) was
also not what was wanted — "not a literal show of the flow in the form of
a recorded screen." What's wanted is a proper edited advertisement: the
platform's real screens used as B-roll, showcasing its flows (research,
verified interview, shareable proof), with well-crafted overlay ad copy
(not clunky invented captions), polished/varied transitions, continuous
camera motion (never a static hold), ending on a specific brand
choreography: the Certainty mark and the "Certainty" wordmark settle
together center-stage, hold, then the wordmark text fades away, leaving
the mark alone, centered, as the literal last frame.

Revision (v2): the first cut used isolated marketing screenshots with
invented headline captions pasted over them ("Evidence, not assertion.",
a good/improve/needs-work legend) — it read as a product-demo poster, not
something someone actually uses. This version is a **flow demo**: one real
recruiter session, captured live end to end (login through download) with
Playwright against the running app, no invented UI text anywhere. A
simulated cursor moves to each real button and clicks it; the cut to the
next frame happens ON that click, so the video reads as continuous use,
not a slideshow of disconnected feature beats.

Real flow captured, in order (all screenshots + click-target pixel
coordinates in `capture-flow/`):
1. Login, fields already filled — cursor moves to "Sign in", clicks.
2. Recruiter pipeline board — cursor moves to the Nadia Rowe card, clicks.
3. Candidate detail page — already shows the journey progress, the
   shareable-profile link, and the real STAR proportions in one real
   screen — cursor moves to "Open" next to the link, clicks.
4. The public shareable profile page, top — verified badge, companies,
   highlights — pans down toward the download buttons.
5. The public profile page, download buttons visible — cursor moves to
   "Download PDF", clicks; a small Certainty mark settles bottom-corner
   as the closing signature (no separate brand-outro frame this time).

## Assets

- `capture-flow/*.png` — 6 real Playwright screenshots of the actual running app (1600x1000, one 1600x1269 full-page plate), copied into `assets/flow-*.png`.
- `capture-flow/coords.json` — exact bounding boxes (x/y/width/height in the 1600x1000 screenshots) for every element the cursor must land on: the Sign in button, the Nadia Rowe pipeline card, the detail page's Open link and share-link field, the profile page's verified badge and both download buttons.

## Customizations

- No spoken narration (silent) — same as v1.
- No invented on-screen copy anywhere. Only real captured UI plus a simulated cursor + click-pulse.

## Notes

- Local dev server; the flow was captured live against http://localhost:8331 with Playwright (not the `hyperframes capture` CLI, since these pages need an authenticated session and a real click-through, not a single-URL crawl).
- v1's 5 frames (`f1-hook` … `f5-brand`, the marketing-hero-plus-camera-move treatment) are superseded by this flow. Superseded assets/frames are left on disk for reference but no longer referenced by STORYBOARD.md.

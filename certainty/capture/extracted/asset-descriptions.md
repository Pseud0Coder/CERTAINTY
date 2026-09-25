# Asset Descriptions

⚠️  No vision credentials — descriptions below are catalog-derived (alt text, headings, section context, filename) instead of Vision-generated. To get richer Vision descriptions on the next capture, set GEMINI_API_KEY (or GOOGLE_API_KEY), or HYPERFRAMES_VERTEX_PROJECT_ID plus HYPERFRAMES_VERTEX_SERVICE_ACCOUNT for Vertex service-account auth, and re-run.

The `logo-<hash>.svg` filename prefix is a structural hint (DOM said this SVG was inside a `<header>`, home-link `<a>`, or had an aria-label matching the page brand). To pick the actual brand logo without Vision, open the `logo-*` candidates in a previewer or rasterize them with `sharp` before referencing — composing a fake logo ships off-brand in the final video.

- svgs/logo-25b1d3a3.svg — logo 25b1d3a3
- svgs/logo-abace613.svg — logo abace613
- svgs/svg-4868d665.svg — svg 4868d665
- svgs/svg-4d265048.svg — svg 4d265048
- svgs/svg-94dfa14f.svg — svg 94dfa14f
- svgs/svg-95f342c7.svg — svg 95f342c7
- svgs/svg-cb0e693a.svg — svg cb0e693a
- svgs/svg-db55a31f.svg — svg db55a31f
- svgs/svg-db953947.svg — svg db953947
- svgs/svg-f34db857.svg — svg f34db857

The 5 product screenshots below were referenced by the page (`<img src="/assets/img/shot-*.png">` in the "platform" scrollytelling section and the "verified interviews" section) but were dropped by capture as unavailable (7 unavailable total). They were copied in by hand from the app's own source (`src/web/img/`) rather than re-fetched, since they are the real, currently-shipping product UI, not placeholders. Each is a native 3200x2000 screenshot of the actual running app.

- assets/shot-dashboard.png — candidate dashboard: the gated journey strip (Setup/Research/Resume/CV/LinkedIn/Interview) and the research report panel with good/improve/needs-work findings against real evidence
- assets/shot-pipeline.png — recruiter pipeline board, candidates grouped by stage column (Screening/Submission draft/With client/Interview/Offer)
- assets/shot-detail.png — STAR proportions (Situation/Task/Action/Result) and ownership meters for a completed verified interview session
- assets/shot-audit.png — immutable audit log table listing every login and flow event, append-only
- assets/shot-interview.png — the interview screen itself: a live question, the Studio Console voice indicator showing whose turn it is, STAR proportions scoring once the session completes

The 2 screenshots below are from a second capture (`../capture-profile/`, source `http://localhost:8331/p/<id>`, the new shareable public candidate-profile page) and were copied into this capture's own `screenshots/` folder because the staging script only looks under this project's single `capture/` tree.

- screenshots/profile-page-top.png — public profile page, top viewport: candidate name, headline, "Verified via structured interview" badge, and the "Worked with" company chips
- screenshots/profile-page-full.png — public profile page, full-length stitched plate (1920x1269, pixel-exact for a 1920-wide viewport), for a scroll/pan move down the page ending on the "Download PDF" / "Download DOCX" buttons at the bottom

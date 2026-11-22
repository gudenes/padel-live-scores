# Race MVP on latest main — 2026-11-22

Source: `/Volumes/Crucial/Apps/codex/home/generated_images/01a202a5-36aa-70b0-9c06-921a68c9379a/exec-f263009a-1a8d-413e-ab8d-7f13d77587c8.png`.

Checkout: `codex/live-race-mvp`, based on `origin/main` at `689482f47`.
The repository session check confirmed production code is contained in main.
Existing Coaches tab, four-tab swipe navigation, gender filters, and current application shell are preserved.

Target viewport: 412 × 915 CSS pixels. Source image is a higher-density mockup.
Implementation screenshots and density-normalized full-view/focused comparisons are unavailable: the in-app browser connection timed out. No visual pass is claimed.

- Fonts/typography: current app font and compact headings; browser wrapping checks pending.
- Spacing: restored 40px portraits and 12px vertical row padding (64px rows), matching the existing ranking list. Removed expanded summary and footer; a compact Live switch and info tooltip replace them. Narrow/mobile visual review remains pending.
- Colors/tokens: existing lime, charcoal and category accents. Illustrative preview controls have been removed.
- Images: public player portraits and flags, with initials fallback; no generated identities.
- Copy: five supported languages, dated official baseline, provisional standings, pending verification and stale status. Real match results replace fixtures; all 1,000 available rows per gender are returned by the local API.
- Tests: Race calculation, parser, full-list rendering, stale state and cutoff tests pass. Full repository typecheck passes.
- Browser interactions and console checks: pending. HTTP/API checks pass; no visual pass is claimed.

final result: blocked

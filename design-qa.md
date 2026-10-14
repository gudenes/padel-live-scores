# Video review QA — 2026-10-14

Visual target: refined replay concept exec-8f24da24-ed9d-4602-a356-8aec5193a002.png.
Preview: /scouting/311fc424-99af-49f9-9dad-37780b7f01b6/report, Video review tab.
Evidence: /Volumes/Crucial/Apps/codex/home/scouter-tmp/video-review-preview.png.

Implemented within the existing report shell: set-separated full-match event timeline, large player area, contextual point panel, custom filters and horizontal rally cards. Real match data contains 156 timed rallies and one unclassified point with no recording. Original video URL is absent from saved document and match metadata; requested it from user. Browser-only source connector accepts YouTube and HTTPS video files.

Verified: UE filter returns 41 points; next matching point selects point 4 with score 0–0 / 15–30 and saved 06:12:04 start. Timeline preserves all points despite filtering. Desktop layout corrected for min-content overflow and global header styling. Mobile report width now fits its parent; timeline scrolls horizontally internally. TypeScript passes; 3 unit tests pass for source validation, identity join and invalid timestamps/time input.

Intentional interim limitation: player portraits identify rallies, not fabricated video thumbnails. No actual rally frames are available. Full-video seeking and looping are implemented but cannot yet be verified against the match without the original video URL. Source saved locally only; no production mutation or deployment.

Final result: blocked — requires original match video URL for playback/alignment QA and final visual comparison in the playing state.

## Chip filters and player timeline iteration
- Browser now contains connected YouTube broadcast iNRkrLDLkTk; duration 11:54:57 is available.
- Replaced dropdown filters with grouped chips; multiple outcomes and ending shots can be combined. Player and rally-length selections are exclusive; tap selected player to clear it.
- Added 1–3, 4–6, 7–9, 10+ recorded-hit ranges and Not recorded. Unknown lengths are not classified as short rallies.
- Timeline has Winner, UE and Other lanes. Player colors follow team lime/coral, dotted for the second player. Player legend and explicit hover labels avoid color-only identification.
- Browser verified Campagnolo + Winner + UE + 10+ hits returns 7 points; removing length restriction returns 20. Next point navigates to point 14 and player clock seeks to 06:19:39. Portrait thumbnails remain an intentional limitation.
- Screenshot: /Volumes/Crucial/Apps/codex/home/scouter-tmp/video-review-chips.png.
- TypeScript passed; four replay utility tests passed. No deployment.
- Final result for requested chip/timeline iteration: passed. Broader replay alignment/loop QA remains separate from this UI iteration.

## Momentum replay iteration
- Replaced outcome lanes with set-separated game bars and player event markers. Hover, focus or tap expands a game into individual replay points; the match overview stays stable.
- Preserved chip filters and added explicit forced-error-created filtering/creator attribution. Reduced-motion styles disable transitions; mobile chart scroll stays inside its container.
- Verified 43 forced-error-created rallies, Set 2 Game 4 expansion, point 84 replay seek and its 3-second padding, and mobile game selection with no page overflow. TypeScript and five utility tests passed; diff whitespace check passed.
- Screenshot: /Volumes/Crucial/Apps/codex/home/scouter-tmp/replay-momentum-built.png.
- Final result: passed for this local UI iteration. No deployment. Full loop/alignment QA is not exhaustive.

## Production candidate · 2026-10-14
- Approved local report/replay, shared library, recent matches, watched-player settings, and momentum guide iterations are included. LLM takeaways remain deferred.
- Browser verified read-only Overview score cells, replay controls in Video review, coverage notice only on Data coverage, shared library below the admin header, and compact illustrated help.
- Admin production webpack build and TypeScript passed. Default local Turbopack build cannot resolve the shared node_modules symlink; production installs dependencies normally.
- 41 scouting utility tests and 14 catalog/report/access/header tests passed. Client harness updated for the sticky-header IntersectionObserver and new library entry.
- Extension suite: 162 passed, 3 failed; all three direct-entry failures also occur on unchanged origin/main (160 passed, 3 failed). New video-source tests pass.
- Video links and saved moments remain browser-local unless a source URL is present in saved scouting metadata. Existing downloaded extension package is unchanged.

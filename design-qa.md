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

## Matches catalog · 2026-10-19

Source visual truth: /Volumes/Crucial/Apps/codex/home/generated_images/01a1102e-efe0-79f2-9415-f4298ad0ea0e/exec-68f6021b-4ee3-487c-8bac-8bbcf015654f.png
Implementation screenshot: /Volumes/Crucial/Apps/codex/home/scouter-tmp/matches-catalog/desktop.png
Preview: http://localhost:8824/scouting?date=2026-10-18

Compared both images together. Source is a 1724×912 generated concept; desktop browser requested 1440×1000, screenshot includes browser scaling and surrounding canvas. Compared the content regions proportionally, not pixel-for-pixel. The reference uses fictional Today fixtures; the implementation uses real previous-day fixtures because Today is empty. Existing global navigation, search help, applied-filter chips, watched-player settings, and Scout menu intentionally remain available. These explain the taller header region and different data density.

Required surfaces: existing app typography and hierarchy retained; three equal card columns, compact paired avatars and aligned set scores match the proposed structure; existing cream/lime/coral tokens retained; real player photos used with existing initials fallback where absent; labels and dates use real catalog data rather than fabricated scheduling times. Full view and readable browser DOM checked; focused date controls additionally checked on a narrow viewport. Full player names intentionally wrap to preserve identity.

Interactions verified: Today empty state, previous-day populated results, All dates clears the date, Scout menu opens independently of the card link. Thirteen catalog/date tests and TypeScript pass; browser console has no recorded errors. Date arithmetic covers month boundaries and Madrid midnight/DST; filters retain selection and reset pagination. Narrow view fits all seven dates and switches cards to one column; desktop has three columns.

Findings: no actionable P0/P1/P2 issues for the requested catalog change. P3: existing filter help and applied-filter row could be consolidated in a later refinement. Existing sidebar stacking on narrow screens is unchanged.
Comparison history: initial browser comparison passed with the intentional existing-shell differences above; no visual repair loop required.
Implementation checklist: date strip complete; three-column cards complete; original scouting entry preserved; local preview running. Production deployment not performed.
final result: passed

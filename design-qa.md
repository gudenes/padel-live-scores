# Video & analysis drawer — local QA

2026-11-10. Reference: selected option 3 with neutral Local processing terminology. Implemented in the existing report rather than a separate demo.

## Verified
- Signed-in local second-match report in the in-app browser.
- White drawer, existing lime accents, typography, buttons and player portraits alongside the video.
- Uploaded video shows real filename, 59:48 duration and 3.20 GB size.
- Saved setup shows the four actual players; editing disabled while processing.
- Live player tracking advanced from 60% to 62% during review; percentage explicitly describes the current stage.
- Close and reopen retains job and saved setup. No analysis started/stopped during QA.
- Local processing / Connected replaces personal device naming; device management collapsed.
- Fixed global header style leakage discovered in screenshot review.
- Screenshot: /tmp/video-analysis-drawer.jpg
- TypeScript check passed. Four new progress tests and 21 related existing tests passed.

## Scope and limitations
- Local only; not deployed.
- Existing transfer and job APIs retained. No fresh multi-GB upload performed during this UI verification.
- Desktop visual QA passed. Responsive CSS included; mobile visual QA not performed.
- Existing second-match scouting timestamps appear unaligned (zero timed points); this is separate from transfer/analysis status and not corrected by this UI change.

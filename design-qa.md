# Floating invite button — independent visual QA

final result: passed

## Evidence and state

- Source visual truth: `/Volumes/Crucial/Apps/codex/home/generated_images/01a0ddb4-d548-7453-8f2c-b3ca5bb8615d/exec-5fb62db5-ad2c-477f-8a7e-22f0f6a86e1b.png` (1366 × 1152 px).
- Implementation: `http://localhost:3017/play?view=leaders`, authenticated leaderboard.
- Initial screenshot: `/tmp/invite-button-qa.png`.
- Scrolled screenshot: `/tmp/invite-button-qa-scroll.png` (1580 × 889 px).
- Drawer screenshot: `/tmp/invite-button-qa-drawer.png`.
- Focused source + implementation comparison: `/tmp/invite-button-comparison.png`. Source and screenshot crops normalized to approximately equal displayed size for icon/silhouette comparison; not a pixel-difference assertion.
- Browser viewport: 1422 × 800 CSS px; reported devicePixelRatio 0.9. Browser capture has a different output density; measurements below are CSS DOM measurements.
- Full-view comparison: reference shows lower leaderboard and nav only, implementation shows full phone and site background. Compared lower phone content and nav; surrounding site, mock framing and density differences are not defects.

## Initial findings (resolved in iteration 3)

- [P2] Invite control moves away from bottom navigation during outer scrolling.
  - Initial capture places the control above navigation. After scrolling the phone content, the control moves upward with `.pl-root`, rather than remaining directly above the persistent nav.
  - Evidence: `.pl-root` top -36, bottom 593; `.pl-invite-float` bottom 577; `.v3-nav` top 665, leaving approximately 88 CSS px to navigation (expected 16).
  - Fix: anchor the control to the persistent phone viewport/nav context outside the scrolling root, or use an equivalent sticky fixed-position wrapper. Resolved by portal anchoring; see iteration 3.
- Initial last row partially overlaps the control, but scrolling the standings to the end clears it thanks to bottom padding. No permanently inaccessible row established.

## Required fidelity surfaces

- Typography: control has no visible label; accessible name is “Invite friends.” Existing page typography unchanged.
- Spacing/layout: 52 × 52 CSS px face, 4px skirt, 32 × 32px icon and 10px face padding confirmed. Right gap is 16px within root. Initial scroll anchoring issue resolved in iteration 3.
- Colors: lime face computed rgb(126,211,33), black filled group-plus icon, dark green skirt; aligned with approved product tokens. No screenshot color sampling claims due density/color differences.
- Asset quality: official filled group-add icon preserves selected two-person-plus direction. Raster screenshot looks soft because of capture scaling, while DOM asset is SVG; no asset-resolution defect established. Square approved Press shape intentionally differs from rounded generated mockup.
- Copy: no new visible copy; button announces Invite friends. Drawer copy preserved.

## Interaction and diagnostics

- Clicking Invite friends opens existing invitation drawer.
- Clicking NOT NOW closes it and returns to leaderboard.
- No invitation sent/copied and no account data changed.
- Console: existing React missing-key warning from PressButton children supplied by MatchMarketCard; unrelated to invite control.

## Comparison history

1. Initial and scrolled captures: icon/face size confirmed, identified P2 scroll anchor mismatch. No pass yet.

## Implementation checklist

- [x] Correct persistent bottom anchoring.
- [x] Re-capture full context and focused button comparison after scrolling.
- [x] Initial drawer open/close verified.

## Follow-up polish

- None required beyond the scroll placement issue.

## Iteration 2 — fix applied, browser disconnected

The implementation agent moved the button into the persistent `.app-screen > nav` context through `FloatingInvite.tsx`, with a portal and positioning intended to retain the 16px rendered gap. This addresses the identified cause in code, but rendered verification is still required.

On resuming QA, browser ID 1 returned “Browser is not available: 1.” Current `cua.getState()` returned `browsers: []`, and creating a fresh in-app tab returned “Browser is not available: iab.” No other browser or automation route was used. Post-fix screenshots and interaction checks could not be captured. Earlier screenshots represent the pre-fix build only.

Historical result: blocked

Remaining blocker at that time: in-app browser unavailable for post-fix screenshot comparison, not a confirmed remaining visual defect.


## Iteration 3 — independent review of root-captured post-fix evidence

The root agent regained browser access and captured the revised implementation through CUA. This reviewer independently opened both screenshots, created combined source/implementation comparisons, and inspected them.

- Post-fix initial: `/tmp/invite-button-final-top.png`.
- Post-fix scrolled: `/tmp/invite-button-final-scroll.png`.
- Both capture dimensions: 1339 × 1176 px. No density-equal pixel-difference claim; cropped content is normalized by width for full composition, and focused controls by approximate face size.
- Combined full-view comparison: `/tmp/invite-button-final-comparison.png`.
- Combined focused comparison: `/tmp/invite-button-final-detail.png`.
- Root DOM measurements: nav top824.9479, button top758.0729/bottom814.0625, width51.9965/height55.9896. Identical before and after app-screen scrollTop80.

The P2 anchor issue is resolved: the control remains in the same position directly above navigation while content scrolls. No row obstruction appears in the revised captures. Icon, depth, lime color, placement and accessible action remain aligned with the selected direction. Fonts/copy unchanged. The approved square Press control and official Material icon are intentional design-system adaptations of the generated reference.

P3 only: the measured bottom gap is approximately10.9 CSSpx rather than the intended16; it is visually clear and does not block the nav or content. Optional adjustment can be deferred.

No remaining actionable P0/P1/P2 visual findings. Earlier blocked entries describe historical states only. Initial drawer open/close passed; post-portal retest passed (see below).

final result: passed


## Final interaction verification

Root CUA retest confirmed keyboard Enter opens the drawer, pointer activation opens it, and NOT NOW closes it. Post-fix drawer evidence: `/tmp/invite-button-final-drawer.png`, independently opened by this reviewer. Tooling coordinate offset was corrected during pointer testing; it was not an application hit-target defect. No invitations were sent. Typecheck and diff-check also passed per implementation agent.

final result: passed

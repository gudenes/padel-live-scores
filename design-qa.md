# Play onboarding — 2026-10-04

final result: local visual refinement verified; external provider sign-in still requires user testing

## Implementation

Real A01 avatars, court imagery and Guaca asset. Existing approved chunky button styles for setup, guide and provider sign-in. Login preview at `/play?onboarding=login`; setup preview at `/play?onboarding=preview`. Both preview switches are development-only. Game data remains whitelist-gated.

The guide now spotlights the wallet, actionable prediction and My plays, with the rest darkened and softly blurred. Target scrolling prevents setup scroll position from hiding the wallet. Guide is hidden while the existing trade dialog is open.

## Verification

- 15 focused onboarding tests pass (identity, account-scoped persistence, rejected access, failed saves, avatar selection, empty-market escape).
- TypeScript passes.
- Browser inspected login, identity, wallet and prediction spotlight. Login fits Google, Apple and email options within the phone frame.
- Screenshots: `/tmp/padel-onboarding-login.png`, `/tmp/padel-onboarding-spotlight.png`, `/tmp/padel-onboarding-prediction.png`.
- Provider authentication was not completed with a real Google or Apple account during this visual pass. Native iOS authentication remains unverified.
- Progress migration was previously validated in a rollback transaction and applied; existing balances were unchanged.


---

# Connected Play and matches

final result: partial — match panel verified; live-state visual check outstanding

## Target
Selected revised option 2: exec-41134177-4fc7-48a4-86ce-7ecdf781f5f7.png. Retain existing Play and match pages; add player links, observed live set scores, match-specific held positions, and a live-only indicator in the existing player match strip. No additional player return CTA.

## Implemented
- Player portraits and names link to existing profiles, with initials retained for missing photos.
- Markets API carries current observed set games only for live/on-court matches; missing scores remain absent.
- Match details replace the generic Play link with a collapsible list of this user's held predictions for this match.
- Existing membership-enforced endpoints are retained. No production changes or data writes.
- Player strip uses translated live label and hides scheduled time while live.

## Evidence
- 42 targeted tests passed: market contract and access, identity/navigation, match-only positions and access denial.
- TypeScript check and git whitespace check passed.
- Local Play at localhost:3015 rendered actual positions and all four athlete links in browser inspection.
- The local preview initially restarted at its 1.5GiB heap threshold while compiling match details. Restarted with a 3GiB limit.
- Browser automation subsequently timed out on the match view and then reported the in-app browser unavailable. No valid screenshot comparison of the completed match/profile/live layouts was possible.

## Remaining verification
Capture Play, match panel (expanded/collapsed), and professional player strip at mobile width. Verify actual live state using fixture tests or local-only visual fixtures, without changing shared match data. Compare to selected reference and correct any layout issues. Verify back navigation and retained scroll/filter state. Do not treat this report as visual approval or deployment readiness.

## Follow-up verification
The browser recovered on October 4. The user reviewed and approved the running match page. The polished match panel was then captured at /tmp/match-plays-polished.png: Pending uses the same translation as My plays; borderless section aligns to page gutters; two held predictions show chunky side badges and right-aligned Guacas. User subsequently requested production deployment. Live-state layout and back-scroll restoration have not been visually verified; no claim of that verification is made.

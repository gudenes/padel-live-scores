# Settlement result panel — visual QA

final result: passed

## Target and evidence

- Selected direction: second displayed concept, `exec-012598c9-03b4-436e-a5e1-d5aa185b52b7.png` in the thread's generated_images folder.
- Local review: http://localhost:3016/result-review
- Desktop evidence: /tmp/result-panel-final.png
- Phone evidence: /tmp/result-panel-phone-final.png
- Compared the source and phone capture together; inspected the actual panel, amount, artwork, and button at readable resolution. Source is Spanish; captured app follows the browser's English locale. The review backdrop is sample data, not a reproduction of the production position list.

## Findings and repairs

- Fixed P2: shared result badge styles overrode absolute placement and font size. Added scoped placement and typography rules; final capture shows the large chunky check beside the avatar.
- Fixed P2: avatar initially appeared too small; increased the actual roster artwork to a torso crop, retaining room for the Guaca coins.
- Investigated mobile screenshot clipping: viewport-only capture was clipped by browser zoom/capture; full-page capture and DOM bounds show both close and primary controls inside the viewport. The final phone capture contains the whole panel.

## Fidelity surfaces

- Typography: uses the app's existing bold heading and sans-serif copy; amount is the main numerical emphasis.
- Spacing: preserves heading → avatar/result hero → match/question → payout → primary action hierarchy; adapts to short screens with a reduced hero and a scrollable dialog.
- Colors: existing charcoal, cream, lime and muted blue; approved Press button and result badge styles reused.
- Images: real Guaca artwork and court backdrop. Preview uses a roster avatar; live mode uses ShopProfileFigure, preserving the user's equipped items. The reference's fixed celebratory pose is deliberately replaced with the equipped avatar to support every player without generating incompatible wardrobe artwork.
- Copy: five locales; separate received amount and net gain; no second loss deduction; corrections show the actual signed adjustment.

## Interaction and access

- Verified preview CTA opens selected result, Close dismisses, Escape dismisses and restores focus. Inspected loss and refund states.
- Native modal dialog supplies focus containment; reduced-motion disables entrance motion.
- Whitelist checked on both result API methods; writes scoped to the signed-in user and settlement category, with origin check.
- Automated tests cover settlement amounts, correction handling, dual-sided positions, access, origin validation, deduplication, server errors and panel controls.
- Production settlement delivery has not been exercised end-to-end; no production deployment or data mutation was made.

## Remaining polish

- Optional P3: a dedicated celebration pose for every equipped avatar would require a separate asset workflow. Current artwork preserves appearance consistently.

## Grouped drawer follow-up

Multiple unread settlements now share one drawer. The condensed hero leaves space for individual match/question rows and chunky result badges. The received total includes payouts and refunds; corrections are separately labelled, never counted twice. CTA opens Results and dismissal submits only displayed notification IDs. Added mixed-outcome total and batch-scoping tests; 9 targeted tests pass. Single-result presentation is retained. Preview defaults to three results and has controls for each individual state.

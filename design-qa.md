# Scouting direct controls design QA

final result: passed

## Evidence

Source visual: `/Volumes/Crucial/Apps/codex/home/visualizations/2026/10/06/01a1102e-efe0-79f2-9415-f4298ad0ea0e/scouting-focus-preview.html`, rendered at http://127.0.0.1:8777/.
Implementation: http://127.0.0.1:8779/panel.html?demo&focus.
Source capture: `output/scouting-source.png`.
Implementation capture: `output/scouting-coral-lime.png`.
Combined, aligned comparison: `output/design-comparison.png`.
Both captures: 1265 × 712 pixels; default desktop browser, approximately 1280 × 720 CSS viewport. Same density, no rescaling. Comparison crops align the 415/435-pixel panel content at native resolution.
State: set 2, 5–4 games, 30–40 points, Coello serving; active rally; all four players; zero attempts/winners. Reference feedback says last action undone after resetting its demo counts; implementation says ready to record.

## Findings and comparison history

Earlier implementation inspection found persistent save status below the fold (P2). Removed duplicate timing/baseline text from the recording workspace, placed starting-score notes in setup, compacted player actions, and moved setup below the workspace after match selection. DOM reading order now follows the visible order. Latest combined comparison confirms all four players, Undo and server status are visible at the captured viewport.

No actionable P0/P1/P2 findings remain in the final combined comparison.

## Required fidelity surfaces

- Typography: matching system sans-serif, compact readable hierarchy and full player names; only the serving player is bold. Full names in scoreboard intentionally replace abbreviated mock labels.
- Layout: scoreboard, pressure footer, timing row, rally control, two player pairs separated by Switch ends, feedback and Undo retain the reference hierarchy. Setup and advanced tools remain collapsed below.
- Colors: user-approved coral #FF8A7A recording actions and lime #C7EF63 rally/selection actions replace reference green. Neutral surfaces preserve the reference contrast and hierarchy.
- Images/assets: reference is native text/forms without raster imagery or decorative assets; implementation retains native controls.
- Copy: live Match/Game/Video values replace illustrative times. Unknown partial-game duration is explicitly shown. Actual save acknowledgement replaces the mock’s always-saved text. Pressure uses canonical admin scoring, including Star Point.

## Interaction verification

Browser: Power attempt, winner, Q → Z → 4 → Enter, matching-attempt reuse, score update, and Undo restoring 30–40 without double-counting the attempt. Automated tests cover X3, Power, X4, keyboard saving, undo, starting scores and server validation. Browser warning/error log was empty.

## Follow-up polish / test gaps

A requested narrow viewport override did not change the native in-app browser dimensions; narrow-width behavior was not independently verified. Capture covers the actual compact desktop extension-width content. Physical Chrome keyboard assignments and the installed extension were not changed during this demo verification. Production server saves require deployment of the new server capability before extension activation.

## Implementation checklist

- [x] Approved direct controls and coral/lime palette
- [x] Serving bold, pressure below score
- [x] All four players and Undo visible
- [x] Typed smash tracking and matching-attempt reuse
- [x] Honest local/pending/server-confirmed save status
- [x] Final rendered comparison and core interactions checked

## VAR and diagonal-position follow-up

The user requested a current-point VAR flag and diagonal player movements on end changes. Latest follow-up capture: `output/var-diagonal.png`, same native desktop viewport, rendered at http://127.0.0.1:8780/panel.html?demo&focus. Browser verified initial order Stupaczuk/Sanz above Coello/Tapia becomes Tapia/Coello above Sanz/Stupaczuk, then a VAR-marked volley winner saves with the review label. All four cards, VAR, Undo and server status still fit. Automated checks cover manual, automatic odd-game and tie-break end changes, pair overrides, Undo, VAR persistence and server capability. No console warnings/errors. No new substantive visual issues in this follow-up inspection.

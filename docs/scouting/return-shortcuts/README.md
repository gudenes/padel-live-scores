# Scouting return picker: layout and keyboard shortcuts

## Purpose

Scouters can now classify a serve return using the keyboard, with the same
button layout and visible shortcut labels used by the smash subtype picker.
Previously, the return details were small mouse-operated buttons without
dedicated keyboard shortcuts.

The interface keeps its existing Spanish labels. This document includes their
English meanings for reviewers.

## User workflow

1. Open the finishing-shot dialog after choosing the player and point outcome.
2. Select **Resto** with `6` or click its shot button.
3. Choose **Globo** or **Bajo** using the buttons or their shortcuts.
4. For an unforced or forced error, optionally select a failure reason.
5. Press `Space` to save or continue the existing opponent-attribution flow.
   If that flow asks for the previous opponent or shot, complete it as usual.

Selecting a subtype or failure reason does not save the point automatically.
Both fields remain optional. Selecting an active option again clears it.

## Default shortcuts

| Context | UI label | Meaning | Key |
| --- | --- | --- | --- |
| Finishing shot | Resto | Serve return | `6` |
| Return type | Globo | Lob return | `F1` |
| Return type | Bajo | Low return | `F2` |
| Return error | A la red | Into the net | `F4` |
| Return error | Largo | Long | `F5` |
| Return error | Lateral | Wide | `F6` |
| Return error | Pared/reja | Wall/fence without bouncing in the opponent's court first | `F7` |
| Return error | Sin contacto | No contact | `F8` |
| Return error | No se aprecia | Cannot determine | `F9` |

Click a shortcut label to customize it in the existing scouting keyboard editor.
Custom assignments are stored on the device. Conflicts with other actions in the
same step are rejected. The video shortcut editor also reserves the new default
scouting keys, so video controls should use other available keys.

## Layout and behavior

- Return types use two equal-width buttons, with the same existing `ui-btn`
  styling and `smash-types` layout as the smash picker.
- The six failure reasons wrap into two rows of three at the reviewed width.
- Selected options retain the existing lime selection style and `aria-pressed`
  state. Shortcut labels are visible beside the option names.
- Failure reasons are available only for error outcomes, not winners.
- Switching to another finishing shot clears the return details.
- Busy/saving state blocks changes, and typing into form fields does not trigger
  these shortcuts.
- Return shortcuts have a separate context. Smash keeps `F1` for Power, `F2`
  for X3, and `F3` for Soft in its existing contexts.
- Saved data continues to use the existing `returnType` and `returnFailure`
  fields. No database migration or API payload change is required.

## Implementation scope

The source UI is in `extensions/scouting-video-overlay/`:

- `panel.html`: visible shortcut labels and return button layout.
- `panel.css`: compact return section and wrapping button sizing.
- `scouting-keys.mjs`: return-specific shortcut context and editable bindings.
- `scout-ui.mjs`: contextual key handling through the existing button actions.

The generated embedded live-video UI in
`apps/ops/public/scout-web/live-extension/` contains the same changes. Regenerate
it after source edits with:

```sh
node apps/ops/scripts/sync-live-scout.mjs
```

The separate standalone scouting UI is outside this change's scope.

## Validation performed

The following targeted suite passed **18 tests**:

```sh
node --test extensions/scouting-video-overlay/tests/return-details.test.mjs extensions/scouting-video-overlay/tests/return-shortcuts.test.mjs extensions/scouting-video-overlay/tests/shortcuts.test.mjs extensions/scouting-video-overlay/tests/quick-shots.test.mjs
```

Coverage includes both the extension and generated live panel; winner, unforced
error, and forced error outcomes; return data persistence; custom key bindings;
conflict detection; busy state; switching shots; smash selection; and existing
shot/video keyboard behavior. The video shortcut test now uses F10–F12 instead
of F7–F9 because the latter are assigned to return failure reasons.

The local harness used Node 20.20.2 and isolated jsdom 26.1.0. Syntax checks and
`git diff --check` passed. A headless Microsoft Edge session exercised the local
demo and captured the return dialog with Globo and A la red selected.

The full application build, authenticated admin flow, real match synchronization,
and production database integration were not tested. No merge or deployment was
performed.

## Local visual review

Serve the repository as static files, for example:

```sh
python -m http.server 8766 --bind 127.0.0.1
```

Open:

```text
http://127.0.0.1:8766/extensions/scouting-video-overlay/panel.html?demo&focus
```

This preview uses simulated match data. Start a rally and choose a player and
outcome to open the finishing-shot dialog. Select Resto and exercise its keys.
Verify that switching to Remate restores the existing smash shortcuts and that
the saved return summary matches the chosen options.

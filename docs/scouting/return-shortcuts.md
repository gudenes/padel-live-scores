# Return selection shortcuts

See the [full feature README](return-shortcuts/README.md) for the workflow,
shortcut reference, implementation scope, validation, and local review steps.

In the extension and embedded live-video scouting panel, select **Resto (6)**
to show return details in the same button layout as the smash subtype picker.

- F1: Globo; F2: Bajo.
- Error outcomes only: F4 A la red, F5 Largo, F6 Lateral, F7 Pared/reja,
  F8 Sin contacto, F9 No se aprecia.
- Space confirms the point or continues the existing opponent-attribution flow.
- Click the shortcut label to customize it in the scouting keyboard editor.

Type and failure details remain optional; clicking an active option clears it.
Changing the final shot clears return details. Winner outcomes never save a
failure reason. Smash F1/F2/F3 shortcuts keep their existing behavior.

The standalone scouting UI is unchanged. Regenerate the embedded live panel
after extension edits with `node apps/ops/scripts/sync-live-scout.mjs`.

Local checks:

```sh
node --test extensions/scouting-video-overlay/tests/return-details.test.mjs extensions/scouting-video-overlay/tests/return-shortcuts.test.mjs extensions/scouting-video-overlay/tests/shortcuts.test.mjs extensions/scouting-video-overlay/tests/quick-shots.test.mjs
```

The local test harness used Node 20.20.2 and jsdom 26.1.0. Browser preview was
checked with headless Microsoft Edge using the isolated demo data. No production
database or authenticated admin session was used.

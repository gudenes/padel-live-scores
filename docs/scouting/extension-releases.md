# Scout extension releases

The source is `extensions/scouting-video-overlay/`. There are three delivery surfaces:

- Admin live-video panel: `npm run build` in `apps/ops` regenerates it through `sync-web-scout.mjs` and `sync-live-scout.mjs`. Railway deploys admin from `main` automatically.
- Unpacked Chrome extension: the admin header downloads a versioned ZIP from `apps/ops/public/downloads`. It must be regenerated separately; an admin build does not repackage it.
- Chrome Web Store: a separate uploaded/reviewed release, not updated by GitHub or Railway.

## Prepare an unpacked release

1. Start from current `origin/main` in a clean worktree. Verify admin API compatibility before distributing new record fields.
2. Install root and admin dependencies. Run `node extensions/scouting-video-overlay/sync-scoring.cjs` followed by `node apps/ops/scripts/sync-web-scout.mjs`. Review and commit any generated changes.
3. Increment `extensions/scouting-video-overlay/manifest.json` and update the versioned download link/title in `apps/ops/src/components/shell/GlobalHeader.tsx`.
4. Run the extension tests. The Scout release CI checks return shortcuts, sync compatibility/recovery, embedded generation, and download consistency. It does not replace the full regression suite.
5. Run `python3 scripts/package-scout.py`, then `python3 scripts/package-scout.py --check`. The deterministic ZIP includes tracked runtime source, assets, generated scoring, and installation helpers. Stage new runtime files before packaging. Do not overwrite an already-distributed version.
6. Commit the ZIP and checksum with the version/link change. Merge the reviewed release and verify the admin Railway deployment, `/api/version`, download SHA-256, and ZIP contents. No public-app deployment is needed for extension-only changes.
7. Existing unpacked users export a backup, replace files in the same permanent extension folder, Reload in `chrome://extensions`, refresh the video, and reconnect. Do not uninstall or clear storage.

## 0.2.11 — 2026-10-29

Packages current merged source including PR #758: Resto (6), Globo (F1), Bajo (F2), error reasons (F4–F9), editable shortcuts, and the existing Space confirmation flow. Includes current sync-recovery and generated scoring modules absent from the old download. No database migration or permission expansion.

Validation: 53 targeted return/keyboard/server-sync/recovery tests pass. The full local suite has 5 existing failures in `direct-entry.test.mjs` and `player-profile.test.mjs`; these tests include outdated UI/default expectations. This release changes packaging and versioning, not the existing runtime source. These broader failures need separate follow-up; the release is not described as a full regression pass.

## Chrome Web Store status checked 2026-10-29

Item ID: `najiogbfjnejaomcidknjnfbjconalok`.
Dashboard: published **unlisted**, version **0.2.0**, last updated October 10. The draft status is unpublished, not pending review. Existing listing: https://chromewebstore.google.com/detail/najiogbfjnejaomcidknjnfbjconalok

The newer unpacked release has not been submitted to Google. Public/searchable visibility is a separate distribution setting. Before a store update, preserve the existing item ID, inspect the existing store manifest/assets/privacy disclosures, build a store package with manifest at the archive root, and submit that version for review. Do not upload the installer ZIP (which wraps runtime files in a folder). Keep unpacked local storage backups when moving to a store installation; do not assume the two extension IDs share storage.

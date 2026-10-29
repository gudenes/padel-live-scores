# Scout extension releases

The source is `extensions/scouting-video-overlay/`. There are three delivery surfaces:

- Admin live-video panel: `npm run build` in `apps/ops` regenerates it through `sync-web-scout.mjs` and `sync-live-scout.mjs`. Railway deploys admin from `main` automatically.
- Unpacked Chrome extension: the admin header downloads a versioned ZIP from `apps/ops/public/downloads`. It must be regenerated separately; an admin build does not repackage it.
- Chrome Web Store: a separate uploaded/reviewed release, not updated by GitHub or Railway.

## Prepare an unpacked release

1. Start from current `origin/main` in a clean worktree. Compare every known installed/unpacked build and its manifest with the release source before choosing a version. Local folder names are not version evidence: read the manifest. Preserve local-only changes and choose a version higher than every distributed build. Verify admin API compatibility before distributing new record fields.
2. Install root and admin dependencies. Run `node extensions/scouting-video-overlay/sync-scoring.cjs` followed by `node apps/ops/scripts/sync-web-scout.mjs`. Review and commit any generated changes.
3. Increment `extensions/scouting-video-overlay/manifest.json` and update the versioned download link/title in `apps/ops/src/components/shell/GlobalHeader.tsx`.
4. Run the extension tests. The Scout release CI checks return shortcuts, sync compatibility/recovery, embedded generation, and download consistency. It does not replace the full regression suite.
5. Run `python3 scripts/package-scout.py`, then `python3 scripts/package-scout.py --check`. The deterministic ZIP includes tracked runtime source, assets, generated scoring, and installation helpers. Stage new runtime files before packaging. Do not overwrite an already-distributed version.
6. Commit the ZIP and checksum with the version/link change. Merge the reviewed release and verify the admin Railway deployment, `/api/version`, download SHA-256, and ZIP contents. No public-app deployment is needed for extension-only changes.
7. Existing unpacked users export a backup, replace files in the same permanent extension folder, Reload in `chrome://extensions`, refresh the video, and reconnect. Do not uninstall or clear storage.

## 0.2.11 — 2026-10-29

Packages current merged source including PR #758: Resto (6), Globo (F1), Bajo (F2), error reasons (F4–F9), editable shortcuts, and the existing Space confirmation flow. Includes current sync-recovery and generated scoring modules absent from the old download. No database migration or permission expansion.

Validation: 53 targeted return/keyboard/server-sync/recovery tests pass. The full local suite has 5 existing failures in `direct-entry.test.mjs` and `player-profile.test.mjs`; these tests include outdated UI/default expectations. This release changes packaging and versioning, not the existing runtime source. These broader failures need separate follow-up; the release is not described as a full regression pass.

## 0.2.16 — 2026-10-29

Reconciles the manually updated local 0.2.15 build with main after PR #759. The local copy lived under a folder still named `padel-nachos-scout-0.2.8`, so its newer manifest and runtime changes were missed when packaging 0.2.11. Never use the parent folder name or GitHub version alone to identify the installed build.

Imported local improvements:
- Smaller normal worker replies, without trimming full exports or persisted history; session summaries retain saved-video URLs.
- Cached media-key bindings, invalidated on storage changes and updated immediately when the user changes shortcuts.
- Reuse of the connected video element to avoid full DOM scans on every sample; disconnected/replaced elements still trigger discovery.
- Batched panel redraws, current video samples returned on rally start, and start/save feedback.
- Local-only save timings (no match contents, names, URLs or account details).
- Explicit smash-recovery selection reuses the latest opposing attempt, avoiding an unnecessary additional attempt.

Retained newer main behavior: return types/failure shortcuts, 90-second skip, keyboard selection retention, queued previous-player inference, current scoring/statistics, responsive charts, browser host shortcuts, and approved store branding/permissions. Generated scoring is rebuilt from admin source; old generated files are not copied back. The local `practice-mode.mjs` was unreferenced by every runtime file, so it is preserved in the original snapshot rather than enabled as an untested new feature.

The original local files were snapshotted separately before reconciliation. The installed folder and browser storage are not modified by this release. Existing local users must export their records and update in place; do not uninstall.

Validation: release CI includes compact-response/full-backup preservation, save failure propagation, shortcut changes, recovery, return shortcuts, existing server compatibility and package consistency. The previously recorded direct-entry/player-profile test failures remain separate from this release.

## Chrome Web Store delivery

Item ID: `najiogbfjnejaomcidknjnfbjconalok`.
Listing: https://chromewebstore.google.com/detail/najiogbfjnejaomcidknjnfbjconalok

0.2.11 was submitted and approved on October 29; the dashboard confirmed it published/unlisted while preparing this release. It was submitted before discovering local 0.2.15. 0.2.16 supersedes it after reconciliation. Keep unlisted visibility and automatic publication after review. GitHub/Railway do not submit Chrome Web Store updates.

Before submitting, inspect the existing store manifest/assets/privacy disclosures, build a store package with manifest at the archive root, and submit to the same item ID. Permissions and host access match approved 0.2.0. Public/searchable visibility is a separate distribution setting. Do not upload the installer ZIP (which wraps runtime files in a folder). Keep unpacked local storage backups when moving to a store installation; do not assume the two extension IDs share storage.

Create the store upload from the same release with `python3 scripts/package-scout.py --store-output /absolute/path/padel-nachos-scout-0.2.16-store.zip`. This removes the installer wrapper and includes only the extension runtime at the archive root.

## 0.2.17 — Red Bull TV connection for admin

In Scout live, paste an official Red Bull TV video page in **Video link**. Open that page, start playback, click the Scout toolbar icon, return to admin and press **Connect video**. Keep the Red Bull tab open. Admin needs a reload after installing/updating Scout so the connection relay is available. The Web Store version and the unpacked version both work; no fixed extension ID is required.

The extension relays media controls and fresh player timestamps only. Scouting records remain in the authenticated admin session with its existing background saves. It requests no additional host permissions: the toolbar gesture grants `activeTab` access to the Red Bull page. The relay runs only on `admin.padelnachos.com`, and connections are bound to the admin document, an opaque token, the selected video document and media identity. Another admin tab cannot take over an active connection.

Saved links restore without automatically connecting Red Bull TV. Reconnecting the same unchanged player preserves its identity; reloading/changing the video requires a new connection. Interrupted rallies retain their original identity and must be cancelled before reconnection. Red Bull replay is limited to the same player session and its reported seekable window. Native timestamps are retained (some live streams use epoch-like seconds); they are never converted to YouTube offsets. The UI displays those large timestamps as UTC clock times. Live-to-replay offsets are not promised.

No database migration or public-app deployment is required. Deploy the merged admin change on Railway and publish/upload the matching 0.2.17 extension package separately. The older installed extension cannot provide this bridge. Do not uninstall it or erase its local records when updating.

Validation: 81 focused extension checks and 18 admin video tests pass; the webpack production build and TypeScript check pass. The full extension suite reports 224 passing / 5 previously documented failures in direct-entry and player-profile. Browser UI verification covers the Red Bull connection instructions and missing-extension state. The live Red Bull page exposes a playable HTML video; actual cross-tab operation still requires loading 0.2.17 in Chrome and a toolbar gesture. The existing local extension and saved records have not been changed.

### Red Bull TV in report Video review

The report's **Video review** tab also accepts official Red Bull TV pages and restores the page saved with the scouting session. Open the video in another Chrome tab, start playback, click the Scout toolbar icon there, then press **Connect Scout** in Video review. This uses Scout 0.2.17; no extension update beyond that version is required.

Select a known point and pause the video at its first serve. **Align current frame to point … start** maps the saved scouting clock to the player's current clock, including live epoch timestamps and relative replay clocks. Point jumps, ±10 seconds, saved moments and rally loops then use that alignment. Alignment lasts for the current connection only and never changes the saved scouting timestamps. Expired replay-window targets are rejected; disconnected or changed videos require reconnecting and aligning again. Shared reports offer the original link but do not expose the authenticated admin extension connection.

Validation: focused review/source/report tests cover canonical Red Bull links, restoration, explicit alignment, epoch-to-relative mapping, seekable bounds, point jumps, looping, disconnection, shared-report restrictions and the existing YouTube player. This change deploys admin only and does not require a Chrome Web Store submission or public-app rebuild.

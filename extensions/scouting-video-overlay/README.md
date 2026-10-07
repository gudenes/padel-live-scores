# Padel Nachos · Video scouting (Corner overlay extension)

Scout players and save points in the side panel. The on-video overlay is now a compact, draggable playback remote. This uses the existing Corner overlay extension and its saved sessions; it does not migrate or overwrite the separate Video companion extension’s sessions.

Reload Corner overlay at chrome://extensions, refresh the video page, reopen its side panel and Connect video. Show video remote displays playback controls without the four player overlays. Keyboard shortcuts work while the video page or side panel has focus: J back 10 seconds, K play/pause, L forward 30 seconds, left arrow back 5 seconds and right arrow forward 5 seconds. The remote shows ±5-second controls directly. Extra controls provide +10 and −30 seconds. Skips are disabled during an open rally; pausing does not end or score it. Close hides the remote; show it again from the side panel.

## Fast shot entry

After starting a rally, click the player’s Winner / Unforced / Forced outcome in the side panel. The end time is captured immediately. The common shot picker uses a stable 3×3 keyboard layout:

| Q · Smash | W · Volley | E · Víbora |
| --- | --- | --- |
| A · Bandeja | S · Groundstroke | D · Lob |
| 1 · Chiquita | 2 · Block | 3 · Bajada de pared |

Press a stroke key to select the shot, then Space to save it. Keyboard selection always waits for Space or Enter. With Quick save enabled, clicking a non-smash shot saves immediately; smashes still wait for a type selection and Space. Turn it off to select by click and save later. Opening Add details turns Quick save off so you can record side, assist, recovery, net cord or already-counted smash details. The preference persists on this device. More shots contains all remaining canonical shots. Ctrl/Cmd Enter also saves after a shot is selected. Shot shortcuts only apply while the picker is open and are ignored in input fields. Undo last action is available in the side panel.

## Catalogue and video connection

Use Sign in to Padel Nachos in the extension account row. Choose Recent & upcoming or a calendar year (2020 onward), then Load tournaments. Search by name, city, country, level or date; disable Premier Padel only for FIP events. Select a tournament to load matches; search player names in any order, with or without accents, and narrow by draw and round. Select a match card, then Scout selected match. Only canonical linked matches with all four player names are available. Search filters do not switch the active session.

Open the replay tab, click the extension icon and Connect video. If the page reloads or replaces its player, Reconnect video rediscovers the player in the same tab. Finish or cancel an open rally first. Saved scores and rallies remain intact. Earlier bookmarks require their original playback session; their timestamps remain in exports.

Points, corrections and timestamps stay in this Chrome profile. Selecting another match restores its saved local session and requires connecting its video. New sessions start at 0–0 rather than the official score. Export JSON before uninstalling.

The remote uses an isolated script and Shadow DOM. Use theatre mode if native video-only fullscreen hides it. Scoring setup, server corrections, court-end changes, faults, undo and exports remain in the side panel. Server saves upload video-scouting sessions and calculated scores directly using the browser-managed operator session. No admin tab needs to stay open. The side panel only shows Saved to server after the API confirms the save. Offline changes stay in a durable outbox and retry when the connection is available. Sync now also queues previously saved local matches. Conflicting server revisions are never overwritten automatically. Load server copy restores a selected match, retains an exportable local backup and requires reconnecting its video; any unfinished remote rally is retained as cancelled. Official live scores remain separate.

Server rollout requires the operator_video_scouting_sessions migration and the admin video-scouting API release before the extension can save remotely.

Local simulated previews: serve this directory and open panel.html?demo for scouting or preview.html for the remote. These use in-memory sample data. Tests: node --test extensions/scouting-video-overlay/tests/*.test.mjs (UI tests use the repository’s jsdom dependency).

Open Video keyboard shortcuts in the side panel to assign each action: click its field, then press your key or key combination. Home (Inicio), Insert (Ins), Page Up and Page Down are supported. The field releases focus after a successful save so the next key press controls the video. Duplicate shortcuts are rejected. Backspace clears a binding; Reset shortcuts restores the defaults. Changes are saved on this device and update the video remote automatically. Typing in input fields does not trigger media shortcuts; the shot picker retains its letter and number keys.

Use Switch match to archive the current local session and choose another match. Selecting the same match later restores its records. Clear search cache removes only tournament/match lists. Reload matches fetches a fresh list for the chosen tournament. If your login expired, use Sign in to Padel Nachos. Closing admin or restarting Chrome does not require loading tournaments again. Catalogue errors appear beside the search controls.

Start partway through the match: select the match, open the starting-score card, enter completed sets, current games/points and the server/near pair at the first rally you will scout, then Apply starting score. Earlier sets contribute to the scoreboard but never to shot statistics. The baseline is locked after the first recorded point, persists per session, and remains when undoing a scouting point.

Scoreboard now labels individual sets and includes the starting baseline. Match/game time follows video timestamps; seeded sessions show observation time unless earlier elapsed minutes are entered. Serve/pressure statistics reuse generated admin model/tracking code, including breaks, chances saved, holds, Star/set/match points and serve faults. Court controls flip near/far or swap each pair left/right. Undo last action restores up to 50 recent scouting edits per match, including baseline, side controls, faults and rally actions; legacy sessions can still undo a scored point.

The scoreboard marks the serving player and the pair with a break, set or match point. Star Point, tie-break and pressure moments appear below its rows. The serving player’s name is bold. These flags use the same admin pressure calculation as the statistics.

## Compact Direct controls

Coral buttons record points; lime starts rallies and marks active selections. Match/video setup, playback and detailed statistics stay in collapsible sections. The four player cards, timing, last saved event, Undo and server acknowledgement stay in the working area. Power and X3 attempts are separate: Q selects Smash, Z selects Power, X selects X3, 4 flags an X4 winner, and Enter saves. Clicking a stroke waits for Save by default. A finishing smash can reuse the last matching attempt in that rally, avoiding a second count; clear the reuse checkbox for a distinct attempt. Legacy untyped smashes remain unclassified.

The admin release must support `smash-types-v1` before typed records upload. Until then the durable local outbox retains all details and reports the pending server update. Deploy admin and web together when rolling out the new typed statistics. Review the isolated demo at panel.html?demo&focus.

VAR review flags the current rally without awarding a point or changing the video. You can toggle it in the workspace or finishing-shot dialog; it is saved with the rally, shown in bookmarks, and included in the completed public report. Undo restores the flag. Server uploads require `var-review-v1`.

Switch ends rotates the camera-facing player order diagonally. A player keeps their left/right playing role. Automatic game and tie-break changeovers use the same mapping; pair position overrides and Undo are preserved.

First fault, Double fault and VAR review are always visible directly beneath the rally button. Start a rally to enable First fault/VAR; Double fault enables after First fault.


## One-hand shot tracking
In the side panel, tap Q/W for far-left/far-right or A/S for near-left/near-right on each observed shot. Labels stay attached to court quadrants as players change ends. A short key press records on release; held-key repeats do not add shots. Hold a player key for 1.3 seconds, release it, then press W for winner, A for unforced error, or D for forced error. While holding a player key, press Z to count a Power smash attempt or X for an X3 attempt; this does not add a tap or award a point. Full-card feedback confirms local recording separately from server sync. The live summary includes current-rally taps, outcomes, typed attempts and inferred directions, and updates after Undo. Select the finishing stroke and press Space (Enter still works). These shortcuts apply in the side panel, not on the YouTube page.

Each tap stores the hitter, video timestamp and four-player court order. Consecutive opposite-pair hitters with unchanged court order infer cross-court or down-the-line. Same-pair sequences, position changes and the last tap remain unknown. Taps never award points; one scored point is one rally. Undo removes the last tap or restores the last scored point and its shot sequence. Finished reports show shot counts and inferred directions only for tracked, non-undone rallies. Old points retain their existing records and do not gain fabricated taps.

The admin API must advertise `rally-touches-v1` before tapped records upload; older servers are blocked with a visible pending-update message. Deploy admin and web from the merged release before updating the installed extension. No database migration is required: sequences live in the existing session document.

## Finish and verify
1. Save the last finishing stroke. Confirm the scoreboard says **Match finished** and the sets are correct.
2. Check the account row. If asked, use **Sign in to Padel Nachos**. Waiting saves retry automatically.
3. Open **Server saves**, press **Sync now**, and wait for **Saved to server** with a recent save time. Retry or conflict means the save is incomplete; keep the local copy.
4. Choose **Export local backup**.
5. Open the related match on Padel Nachos and check the scouting report. A mid-match starting score contributes to the score; statistics cover only observed points. Direction counts are inferred estimates.

The panel includes this checklist and opens it automatically when the scouting score finishes. Its completion message requires both a finished score and acknowledgement of the current session save.

During an active rally, press **1** for the first serve fault, then **2** for a double fault. Double fault records the point for the receiving pair. These keys ignore typing and held-key repeats, and retain their shot choices inside the finishing-stroke dialog.

## Point tags V2
Winner quick tags stay visible: **F** credits the teammate assist, **R** flags smash recovery, and **4** flags an X4 winner. X4 selects Power smash automatically; choose Space to save. A matching Power attempt can be reused, so it is not counted twice.

For a forced error, first choose the opponent with the **Q/W/A/S key shown for their current court position**, or select Not recorded to continue without credit. After attribution, letter keys select the finishing stroke as usual. Clicking an opponent lets you correct the credit. End changes update these player keys. No opponent credit is inferred automatically from taps.

**Ball touched the net** is a single toggle available for winners and errors. New points save the observed net touch without calling it lucky or unlucky. Historical lucky/unlucky records keep their original labels and also contribute to the net-touch total.

The live summary and admin insights show assists, forced errors created, smash-recovery winners and net touches. Point details, server documents and JSON/CSV exports preserve the attribution. Undo removes their counts with the point. These fields do not change V1 impact weights. Server uploads containing manual credits or net touches require **point-tags-v2** support; the local outbox retains them until that admin release is available. No database migration is required.

## Scouting progress
The slim top bar shows finishing-stroke coverage. Click it to expand recording details, forced-error attribution, rallies with shot taps and the current server acknowledgement. Double faults need no finishing stroke. Imported scores, unfinished rallies and undone points do not inflate observed coverage. Missing opponent attribution remains valid and does not lower the stroke-coverage bar. Milestones acknowledge 20, 50 or 100 observed points, the first observed set ending, and match completion; only a server-confirmed finished match says completed and synced. These are completeness indicators, not an accuracy rating, and Undo recalculates them.

## Court check-in and serving
Tick **On court** on each player card once. After all four confirmations, the check-in section and card checkboxes disappear. Completion survives reopening the panel, stays per match and follows each player through end changes. **Undo check-in** in Video, serving & scouting tools restores the last confirmation without undoing any scored point. The checklist stays on this device and does not affect statistics or block scouting. **Change** beside the serving name, below the timer, opens server selection between rallies. It uses the existing server correction, score replay, cloud save and score Undo. The serving player's name remains bold. Long instructional paragraphs have been removed from the active workspace; button shortcuts remain visible.

Each smash button displays that player's current court key: hold **player key + X** for X3, or **player key + Z** for Power. Count these during an open rally. Labels update when ends change.

For a smash-recovery winner, press **R**, then **Space**. No finishing stroke is required, and no smash attempt is added unless explicitly tagged X4. Recovery winners are excluded from the finishing-stroke coverage denominator. Untick recovery to choose a regular stroke.

## Recovery after moving the video
If an open rally becomes invalid after a seek, the workspace shows **Restart rally here**. Position the same video at the first serve, then restart, even while paused. It archives the unfinished attempt and opens a fresh rally at the new video position without changing recorded points or the score. Taps, faults and smash attempts from the discarded attempt are kept in the backup, not carried into the new observation. Undo restores the prior pending rally and removes the archive entry. Video replacement or an ended video still requires cancelling and reconnecting.

### Soft smash and sequential attempt keys
Tap Q/W/A/S to record a shot, then Z (Power), X (X3) or C (Soft) to classify that same latest shot. Repeating or correcting its type updates the one linked attempt and never adds another touch. Hold-player + Z/X/C and the card buttons still record standalone attempts when you are not tracking every shot. Hold 1.3 seconds → W/A/D still selects outcomes; in the finishing smash picker, Z/X/C selects the type and Space saves. Soft attempts and soft smash winners appear separately in live details and the saved admin report. Undo restores the prior classification. Server sync of Soft or linked attempts requires `soft-smash-v1`; older servers retain the local outbox until updated. No database migration is needed.

### Complete finishing-stroke keyboard
Every finishing stroke has a key in the shot dialog. Existing Q/W/E, A/S/D and 1/2/3 stay unchanged. Additional strokes: T Rulo, G Gancho, V Drop shot, B Half-volley, Shift+A Wall return, Shift+S Return, Shift+D Contrapared, 5 Serve, 6 Other. All keys stay on the left side of the keyboard. Small shortcut hints sit beside labels; all strokes remain visible. These keys apply only after an outcome is selected; player taps and winner/assist/recovery/fault keys retain their existing contexts. Space saves.

Player cards and the Live stats player column show country flags and rankings from the admin catalogue. The scoreboard stays unchanged. Missing country/ranking values are omitted. Reload a tournament’s matches to refresh profile data for an existing session; scoring and recorded points are retained. Demo rankings are illustrative.

### Compact playback controls
The main scouting workspace exposes −5s, play/pause, +5s, +10s and +30s in one row with visible shortcut badges and a 1× / 2× / 4× selector. Insert rewinds 5s, Home (Inicio) toggles playback, and Page Up advances 5s. Shift+L advances 10s, L advances 30s, and Shift+K cycles speed. Existing shortcut settings remain editable; a one-time update applies the three requested navigation keys and clears conflicting older assignments. Other custom bindings are retained.

Skipping and speed changes work between rallies; pause remains available during a rally. Starting or restarting a rally restores 1× and confirms that the player applied it before recording. Timing uses video timestamps: skipped waiting time remains in match/game duration, while each rally keeps its own start/end duration. Replays and live buffers remain limited to the broadcaster’s available seek window.


## Extension account and direct sync

Use **Sign in to Padel Nachos** in the account row. Login opens the existing secure admin login in Chrome; Google, email link and password remain handled by admin. The extension reuses the HttpOnly operator session through host-permitted requests, never copies passwords or session cookies into its storage, and does not need an admin tab for catalogue reads or saves. Closing admin, browser restart and extension reload reconnect from that session; expiration requires signing in again. Account connectivity is separate from the server acknowledgement shown in Server saves.

Deploy admin with `/api/internal/scouting-extension/session` before installing this extension build. It issues a short-lived CSRF proof bound to the session user and requesting extension origin; saves still check a live operator session, server feature support and revision conflicts. Same-origin admin writes keep their existing protections. `AUTH_SECRET` is required (already used by admin Auth.js). No database migration or new credentials are needed. The extension requests host access only to `https://admin.padelnachos.com/*`. The durable local scouting records and outbox are preserved and retry after reconnecting; server conflicts still require review. Test real Chrome login, saving with all admin tabs closed, reload/restart, sign-out and offline recovery before rollout.

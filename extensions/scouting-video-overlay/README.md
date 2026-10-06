# Padel Nachos · Video scouting (Corner overlay extension)

Scout players and save points in the side panel. The on-video overlay is now a compact, draggable playback remote. This uses the existing Corner overlay extension and its saved sessions; it does not migrate or overwrite the separate Video companion extension’s sessions.

Reload Corner overlay at chrome://extensions, refresh the video page, reopen its side panel and Connect video. Show video remote displays playback controls without the four player overlays. Keyboard shortcuts work while the video page or side panel has focus: J back 10 seconds, K play/pause, L forward 30 seconds, left arrow back 5 seconds and right arrow forward 5 seconds. The remote shows ±5-second controls directly. Extra controls provide +10 and −30 seconds. Skips are disabled during an open rally; pausing does not end or score it. Close hides the remote; show it again from the side panel.

## Fast shot entry

After starting a rally, click the player’s Winner / Unforced / Forced outcome in the side panel. The end time is captured immediately. The common shot picker uses a stable 3×3 keyboard layout:

| Q · Smash | W · Volley | E · Víbora |
| --- | --- | --- |
| A · Bandeja | S · Groundstroke | D · Lob |
| 1 · Chiquita | 2 · Wall return | 3 · Return |

Press a stroke key to select the shot, then Enter to save it. Keyboard selection always waits for Enter. With Quick save enabled, clicking a non-smash shot saves immediately; smashes still wait for a type selection and Enter. Turn it off to select by click and save later. Opening Add details turns Quick save off so you can record side, assist, recovery, net cord or already-counted smash details. The preference persists on this device. More shots contains all remaining canonical shots. Ctrl/Cmd Enter also saves after a shot is selected. Shot shortcuts only apply while the picker is open and are ignored in input fields. Undo last action is available in the side panel.

## Catalogue and video connection

On signed-in admin, click this extension’s toolbar icon. Choose Recent & upcoming or a calendar year (2020 onward), then Load tournaments. Search by name, city, country, level or date; disable Premier Padel only for FIP events. Select a tournament to load matches; search player names in any order, with or without accents, and narrow by draw and round. Select a match card, then Scout selected match. Only canonical linked matches with all four player names are available. Search filters do not switch the active session.

Open the replay tab, click the extension icon and Connect video. If the page reloads or replaces its player, Reconnect video rediscovers the player in the same tab. Finish or cancel an open rally first. Saved scores and rallies remain intact. Earlier bookmarks require their original playback session; their timestamps remain in exports.

Points, corrections and timestamps stay in this Chrome profile. Selecting another match restores its saved local session and requires connecting its video. New sessions start at 0–0 rather than the official score. Export JSON before uninstalling.

The remote uses an isolated script and Shadow DOM. Use theatre mode if native video-only fullscreen hides it. Scoring setup, server corrections, court-end changes, faults, undo and exports remain in the side panel. Server saves upload video-scouting sessions and calculated scores through the signed-in admin tab. Keep admin open and signed in after loading tournaments. The side panel only shows Saved to server after the API confirms the save. Offline changes stay in a durable outbox and retry when admin is available. Sync now also queues previously saved local matches. Conflicting server revisions are never overwritten automatically. Load server copy restores a selected match, retains an exportable local backup and requires reconnecting its video; any unfinished remote rally is retained as cancelled. Official live scores remain separate.

Server rollout requires the operator_video_scouting_sessions migration and the admin video-scouting API release before the extension can save remotely.

Local simulated previews: serve this directory and open panel.html?demo for scouting or preview.html for the remote. These use in-memory sample data. Tests: node --test extensions/scouting-video-overlay/tests/*.test.mjs (UI tests use the repository’s jsdom dependency).

Open Video keyboard shortcuts in the side panel to assign each action: click its field, then press your key or key combination. Home (Inicio), Insert (Ins), Page Up and Page Down are supported. The field releases focus after a successful save so the next key press controls the video. Duplicate shortcuts are rejected. Backspace clears a binding; Reset shortcuts restores the defaults. Changes are saved on this device and update the video remote automatically. Typing in input fields does not trigger media shortcuts; the shot picker retains its letter and number keys.

Use Switch match to archive the current local session and choose another match. Selecting the same match later restores its records. Clear search cache removes only tournament/match lists. Reload matches fetches a fresh list for the chosen tournament. If admin access has expired or Chrome restarted, open admin.padelnachos.com, click the Corner overlay icon there, then Load tournaments again. Catalogue errors appear beside the search controls.

Start partway through the match: select the match, open the starting-score card, enter completed sets, current games/points and the server/near pair at the first rally you will scout, then Apply starting score. Earlier sets contribute to the scoreboard but never to shot statistics. The baseline is locked after the first recorded point, persists per session, and remains when undoing a scouting point.

Scoreboard now labels individual sets and includes the starting baseline. Match/game time follows video timestamps; seeded sessions show observation time unless earlier elapsed minutes are entered. Serve/pressure statistics reuse generated admin model/tracking code, including breaks, chances saved, holds, Star/set/match points and serve faults. Court controls flip near/far or swap each pair left/right. Undo last action restores up to 50 recent scouting edits per match, including baseline, side controls, faults and rally actions; legacy sessions can still undo a scored point.

The scoreboard marks the serving player and the pair with a break, set or match point. Star Point, tie-break and pressure moments appear below its rows. The serving player’s name is bold. These flags use the same admin pressure calculation as the statistics.

## Compact Direct controls

Coral buttons record points; lime starts rallies and marks active selections. Match/video setup, playback and detailed statistics stay in collapsible sections. The four player cards, timing, last saved event, Undo and server acknowledgement stay in the working area. Power and X3 attempts are separate: Q selects Smash, Z selects Power, X selects X3, 4 flags an X4 winner, and Enter saves. Clicking a stroke waits for Save by default. A finishing smash can reuse the last matching attempt in that rally, avoiding a second count; clear the reuse checkbox for a distinct attempt. Legacy untyped smashes remain unclassified.

The admin release must support `smash-types-v1` before typed records upload. Until then the durable local outbox retains all details and reports the pending server update. Deploy admin and web together when rolling out the new typed statistics. Review the isolated demo at panel.html?demo&focus.

# Lab Vision admin workspace

Open `/lab-vision` in the admin app. The page and every workspace API request require the existing administrator role (`isOperator`, including staff admins). Scouters, viewers, and anonymous users cannot access it.

Workflow polls owned jobs and connected workers every five seconds through the existing database. It reuses stage progress and measured benchmark estimates, displays stale heartbeats, and does not invent overall percentages or installed versions. Links return to the match report for run/stop controls. Measurements describe capabilities and caveats, not per-frame quality scores.

The annotation pilot loads the private uploaded video from the selected owned job. Mark a moment, choose a player, shot/side/direction or tracking-quality issue, adjust clip bounds, and save a review status. Unknown labels remain explicit. Verification requires confirmation of timing. Click saved examples to revisit/edit; edits append revisions and export retains both latest labels and history.

Annotations, revision chains, scouting projects, alignment anchors, and cached proposals live in PostgreSQL tables protected by RLS and server-side admin authorization. Videos and tracking assets remain private in Cloudflare R2. Admins share the library; each annotation retains its reviewer and source provenance. Exports contain labels and clip boundaries, not trained checkpoints. Rejected examples are excluded from positive training eligibility.

Training still needs label QA, clip extraction, train/validation/test splits by match, dataset versioning and an explicit training/evaluation run. No GPU training or worker restart is triggered here.

Player boxes: pause on the desired frame and choose Draw / adjust player box. Drag the background to draw, the box interior to move, or any of eight handles to resize. The box is stored in normalized video-frame coordinates at the annotation timestamp with human provenance, and shown only on that frame. It is not an automatic tracking sequence. Serve examples can separately record First/Second attempt and Front/Back/Side viewpoint; these do not change the Serve class. Existing records without boxes remain supported.

Automatic box proposals reuse the published pose chunks for the owned analysis. Select a player and mark a frame: the UI uses the nearest pose within 50 ms inside the same coverage segment, requires confident head/shoulder/ankle joints, pads the joint envelope, and normalizes by source dimensions. This is a pose-derived proposal, not the original detector box. Missing/partial poses fall back to manual drawing. Changes never replace an existing box automatically. Use tracking proposal explicitly to reset edits; changing player clears the old box. Exports distinguish human boxes, pose proposals and adjusted proposals. Identity remains subject to human review. No inference or worker restart is needed.

## Serve review queue

Review serves generates possible contact candidates from saved tracking assets in private R2, with cached proposals in PostgreSQL. The endpoint verifies admin access first. It reuses saved poses, no model inference. Four-frame wrist displacement relative to torso, normalized by torso length, is thresholded at 4.5–35 torso lengths/s; per-player peaks within 0.8 seconds are suppressed. Missing observed positions and camera-cut bridges are excluded. Deep-court position plus a low hand provides an optional serve-position hint, not serve classification. Front/back views use the same class. Gesture, replay and timing errors remain; no recall/precision is claimed.

All candidate contacts remain accessible, with likely-serve and pending/uncertain filters and 40-item pages. Play proposal shows 1.5 seconds before and 1 second after, then pauses. Frame controls adjust timing, and Confirm contact here records the chosen time. Server, box, viewpoint and attempt can be corrected. Approve / Not a serve / Uncertain save to the shared admin library and advance. Rejection is a negative serve label, not a no-contact label; uncertain examples are not training eligible. Candidate IDs and human decisions are retained in annotation exports, including revisions. Missed serves can be added manually in Annotate & improve. The current heuristic is a pilot for annotation, not a production event detector.

### Four-player serve review
Review serves now proposes normalized boxes for all four players at the marked source-video contact time, using published pose samples (no new inference job). Select Server, click the player on the video, then click the opposing Receiver. Partners come from the analysis roster's two teams (players 0/1 and 2/3). These roles are independent of front/back camera view. Use Adjust box to move, resize or redraw any player; absent reliable poses require a manual box or explicit Not visible label.

Confirm contact here / Propose all boxes on current frame preserves the displayed video time. Changing the contact frame replaces stale boxes with proposals at that frame. Approval requires the final review checkbox, an opposing receiver and all four boxes or visibility decisions. Corrections invalidate confirmation. Approved annotations with participants use schemaVersion 2 and retain each player's role, normalized box and visibility alongside the original server field and clip interval; previous annotations remain readable. Nothing is automatically trained or deployed.

Contact inspection supports Fit, 2×, 3× and 4× zoom, with scroll navigation. Video and overlays share the same enlarged coordinate container; stored boxes remain normalized to the original frame. Adjust box focuses the player at 2× and hides other overlays. Larger handles, redraw, restore-to-edit-start and done controls support correction without seeking the video. Zoom enlarges the existing source; it does not add image detail.

Serve review keyboard controls (focus within the review area): Z/C step ±1 frame; Shift+Z/C ±10; J/L ±30 (1s at 30fps); X play/pause; R replay; V mark contact; 1/2/3 server/receiver/edit; +/- zoom; 0 fit; Enter approve only after confirmation and valid roles; Shift+N reject; Shift+U uncertain. Inputs and dropdowns retain normal keyboard behavior. Repeated decision keys are ignored. A visible shortcut guide and ±1/10/30 frame buttons accompany these controls.

### Scouting-seeded all-shot project
Open /lab-vision?review=shots. The uploaded Alfonso/Libaak–Coello/Nieto
export is retained privately in `lab_vision_annotation_projects`.
The authenticated, owned-job endpoint imports 114 point starts and 1,030 operator
taps into a separate queue. This is not a new model prediction pass.

Point starts propose serves but are not contact frames. Only the first server is
seeded from setup; later servers remain unassigned. Explicit smash attempts use
touchIndex, and ending-shot labels are seeded only when the last tapped hitter
matches the scouted ending hitter. Return-of-serve is a role separate from stroke.
All seed labels still require human review.

The export's YouTube clock differs from the uploaded clip. Before approvals,
the reviewer seeks the corresponding first point start and confirms an offset.
The alignment is private per user/job in shot-alignment.json, excluded from
annotation reads. Check later points for edits/clock discontinuities. Changing the
anchor never rewrites saved contacts. Corrected contacts preserve source time,
offset, point and stable candidate ID. Existing serve annotations are unchanged.
Unknown strokes are not eligible for verified approval in this queue.
Reject duplicates, keep uncertain proposals pending, and add missed contacts via
Annotate & improve. Project export includes proposals and latest scout-linked labels;
the general annotation export retains full history and manually added contacts.

Keyboard: Z/C one 30-fps step, Shift Z/C ten steps, X play/pause, R replay context,
V mark contact, Enter approve, N reject, Page Up/Down navigate proposals.
Nearby saved poses can propose a hitter box, explicitly labelled when borrowed;
the reviewer adjusts it at the marked contact. No metrics or tracking are changed.

All-shot contact marking (button or V) now automatically loads the selected hitter's
box at that exact time; choosing a hitter after marking also triggers the proposal.
Pending requests cannot replace a later contact or manual adjustment, or rewind
playback when they finish. Missing tracking falls back to manual drawing. Approval
waits until box lookup finishes. Marking still does not save/approve a label.

All-shot keyboard controls: 1–4 hitters; Q/W/E/A/S/D/F/G/H/T/Y/U/O strokes;
5 serve (also sets cross-court), 6 return role, 7 rally role; left/right side outside
box editing; 8/9/0 direction; B create/edit box, arrows move and Shift+arrows resize,
Escape exit; +/- zoom; J/L 30-frame jumps; P first pending; Shift+N uncertain.
Shift+A explicitly anchors the first point start at the current video time.
Saving without alignment explains the blocker next to an alignment button instead
of silently doing nothing. Alignment preserves the current contact draft. No
alignment is inferred automatically from a racket-contact annotation.

Two-step all-shot review now follows the extension's visible keycap style:
Contact & hitter, then Shot details. Selecting a hitter (I/O/K/L in displayed roster
order) or marking contact opens step 2. Roster order is not inferred court location.
The second step uses stroke/role/side/direction button grids instead of dropdowns.
More shots and box controls expand on demand. Proposed boxes display without
entering edit mode; B explicitly enters editing. This keeps arrow side shortcuts
available during normal classification.
Updated conflicts: O selects a hitter, Other uses 4; L selects a hitter, J/Shift+J
step ±30 frames; Home plays/pauses, Insert/Page Up seek ±5 seconds as in the
extension. [ / ] navigate proposals. The expanded text shortcut guide is now
collapsed by default. Existing annotations are unchanged.

### Quick review (default all-shot view)
QuickShotReview shows a paused proposed frame plus a bounded ±1.5-second clip,
with a proposed hitter box from existing tracking. Enter approves event+hitter,
N marks not-contact/duplicate, U leaves uncertain, Space replays, E opens the
existing detailed editor at that proposal, and arrow keys navigate. Decisions
advance only after successful persistence; failed saves remain on the proposal.
Previously verified annotations require detailed revision rather than quick overwrite.
`quickDecision: shot|not_contact|uncertain` is validated server-side. Quick approvals
remain needs_review, confirmed=false, timingVerified=false, trainingEligible=false.
They count as reviewed in the quick queue but are not precise shot-type labels.
No new video processing is launched: both panes seek the authenticated hosted video.

Quick review playback now starts a muted three-second preview when a proposal loads,
then seeks back to the proposed contact and pauses. Space replays the preview.
Z/C adjusts the paused frame by 1/30 second; Shift Z/C adjusts ten frames.
These quick adjustments are saved as unverified timing; E opens the detailed
editor for explicit exact-contact verification. Browser autoplay denial shows a
Space-to-start message. Existing verified annotations remain protected.

Quick review now supports inline shot classification below the videos. Player
identity is optional and is not verified by a quick decision. Existing suggested
identity is retained as context only. Q/W/E selects Smash/Volley/Vibora;
A/S/D Bandeja/Groundstroke/Lob; F/G/H Chiquita/Block/Bajada;
T/Y/U Gancho/Rulo/Contrapared; 5 Serve; 4 Other; 0 Unknown.
Left/right selects backhand/forehand. Enter approves, N rejects, ? marks uncertain,
V opens corrections, and [ / ] navigates proposals (replacing arrow navigation).
Space replays; Z/C and Shift Z/C retain frame stepping. Classification reviewed
is stored separately from precise timing and identity verification; these labels
are not automatically promoted to exact-contact training eligibility.

## Production migration and verification

Apply `20261111100000_lab_vision_annotation_library.sql`. From `apps/ops`, run `node scripts/import-lab-vision-annotations.cjs /path/to/previous/apps/ops` with DATABASE_URL loaded securely. The import preserves IDs, reviewers, decisions, times and supersedes links; it is idempotent and leaves local files intact. It caches the original local pose proposals without rerunning inference. Run it again before switching reviewers to production to capture any final local saves.

A unique supersedes index rejects concurrent revisions with HTTP 409. Mutation requests require the app origin. Anonymous/scouter/viewer read and write denial is covered by API tests. Shared report access to existing tracking assets is unchanged.

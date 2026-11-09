# Local Video review / Lab Vision pilot

Branch: codex/lab-vision-video-review. No deployment or remote upload.

Run the admin Next dev server on localhost. Open `/local-video-review` (development only).
The page uses the existing VideoReview component with an empty scouting report, not live database data.
Select the processed match MP4 from disk, then explicitly link Rally 35.
Choose full-match mapping (video 1057..1086.9 seconds) or an exact rally clip (video zero = match 1057).
Other videos must not be linked to this sample. Outside this interval the overlay reports no tracking.

Files selected with the browser file picker use object URLs and stay on the Mac; reselect after reload.
This is not shared storage, transcoding, or an automatic analysis job.
Local controls are hidden on non-local hosts. Existing HTTPS/YouTube/Red Bull connections remain unchanged.

The iframe uses copied Blender GLB assets and saved tracking/poses/ball samples from the Rally 35 prototype.
Parent and iframe exchange same-origin, source-checked messages for video time and camera presets.
Ball positions are ground projections; skeleton depth is illustrative. No shot classifications are generated.

Next integration steps: match-owned video uploads, storage permissions, job/asset manifests, validated time alignment,
and a general processed-match endpoint replacing this explicit sample bundle. Keep inference/coverage metadata.

Actual report: `/scouting/53969a2c-431f-4ccc-a0e0-fc4cc84bcdfa/report`.
Uses the normal app authentication, saved scouting and match context; no auth bypass.
On local video selection for this report, scouting times subtract 18881 seconds (05:14:41),
the known start of the downloaded match excerpt. The editable offset must be changed for
other edits of the footage. The processed candidate number 35 is not scouting point 35;
the miniature remains linked by video time and explicit selection, never by point number.

## Coaching annotation pilot
The miniature can be hidden and restored without unlinking tracking. A vertical video toolbar provides player highlights, arrows, freehand drawing, undo, clear-current-frame and visibility controls. Selecting a drawing tool pauses the local video. Marks use normalized video-content coordinates (excluding letterboxing), are tied to the paused timestamp, and disappear when playback moves away. These are manual, session-only annotations, not automatic player-following highlights or saved match data.

Verified in the real match report: hide/restore, player selection and highlight placement, arrow drawing. Existing video-review tests: 6 passed. Full typecheck remains blocked by pre-existing missing dependencies; no diagnostics for the modified components.

## Simplified coach UI
Annotation tools removed from the report. Video setup collapses away; the header owns the persistent 3D visibility toggle. Compact court has expand/close only; expansion pauses the local footage and shows camera presets beside it. Outside tracked coverage only a small availability notice is displayed. Verified expand/pause and return in the actual report; existing video-review suite passes all 6 tests.

## Floating court interaction
Expanded 3D now overlays the existing video, preserving video dimensions. Compact mode can be dragged by its header (or moved with arrow keys while header is focused), with bounds clamped to the video container and native controls left accessible. Orbit gestures remain inside the 3D canvas. Returning from expanded mode restores the compact position. Verified drag from bottom-right to top-left and overlay expansion in the actual match report.

## Page-level floating court
Court now renders in a body portal with fixed positioning, so video containers do not clip or constrain it. Small/Medium/Large presets plus a keyboard-accessible resize corner adjust its dimensions. Header drag and arrow keys move it across the viewport; resize/window bounds keep it reachable. The compact custom size is retained when returning from expanded view. Verified large preset, header drag above the video, and custom corner resizing in the real report. Position and size are session-only.

## Presented-frame synchronization
The miniature subscribes directly to the local video's requestVideoFrameCallback and sends metadata.mediaTime plus the source offset to the viewer. React's slower clock remains for report selection/coverage only and no longer overwrites the 3D timestamp. Pause, seeking, seek completion, rate changes and source readiness immediately resync; browsers without the frame API use requestAnimationFrame while playing. Hidden/unmounted viewers cancel callbacks and detach event listeners. No tracking data or metrics are recalculated. Nine tests passed (three synchronization tests plus six existing review tests); playback and pause checked in the actual report with no browser errors logged.

## Match video timeline
Added below the player: a set overview, full-match/5-minute/1-minute zoom, follow-video mode, manual window navigation, click/keyboard seeking and separate point/winner/error/saved-moment lanes. Uses the existing offset-adjusted scouting times and shared seek function; no new detections or timestamp writes. Filtered-out events are faded for context. Untagged gaps do not imply verified dead time. Inspired by Sportscode's event-row workflow: https://support.hudl.com/s/topic/0TOVY0000000Agv4AE/hudl-sportscode?language=en_US . Verified point click, full-match and one-minute zoom in real report; existing 9 playback tests pass; no typecheck diagnostics for modified timeline files (unrelated dependency diagnostics remain).

### Timeline styling and scrubbing
The timeline uses lime/coral team colors and rounded markers consistent with Match momentum & replay. Colors identify the attributed player’s team, not necessarily the point winner. Click or drag the time ruler or empty lanes to seek precisely in either direction; scrubbing pauses the video for inspection. The full-match slider supports longer jumps. Clicking a point still starts its replay. The zoom window remains fixed during dragging.

### Match overview and zoom
Full match is the initial timeline view. Plus/minus controls move through full match, 15 minutes, 5 minutes and 1 minute; Fit match restores the complete view. The overview retains every timed point while zoomed. Desktop video height and timeline rows are compacted to keep both visible; the playback panel scrolls independently if necessary. Verified full-match and 5-minute views with all 175 overview markers retained.

### Timeline point details
Hover or keyboard-focus a point marker for its player portrait/name, outcome, score before the point, recorded shot/hits, and video range. Cards use scouting data, do not seek playback, and indicate points outside the current filters. Escape dismisses them; clicking still replays the point.

### Saved-moment coaching labels
Moments now support multiple optional labels and custom labels, alongside notes. Existing bookmarks without labels remain valid. Labels are normalized, deduplicated case-insensitively and bounded to 12 labels / 48 characters each. Presets are coach-selected topics, never model predictions. Public references: https://thebandejalab.com/playbook/ (book outline), https://thepadelschool.com/players/competitive-player and https://thepadelschool.com/resources/padel-tips/how-to-deal-with-lobs. These are our adapted review categories, not an official taxonomy or an endorsement. Labels remain in browser-local storage, as do existing saved moments.

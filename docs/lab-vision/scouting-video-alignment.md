# Align scouting to an uploaded video

Tracking and activity use uploaded-video seconds. Scouting may use a different replay clock. Do not change tracking timestamps or rerun inference to correct that clock.

The published viewer manifest can carry `scoutingAlignment` with a default `offsetSeconds` and optional ordered `segments: [{sourceFrom, offsetSeconds}]`. Source time minus the applicable offset gives uploaded-video time. A segment applies from `sourceFrom` (inclusive). This supports extra footage in the uploaded replay, with independent offsets before and after a changeover. Values must be finite, source boundaries strictly increase, and offsets must not increase (reverse/removed-footage mappings need an explicit interval design).

The report maps point starts and ends, timeline markers and playback selection with this mapping. Switching to the original replay inverts it; during inserted footage the source clock clamps at the segment boundary. Broadcast playback and unmatched local videos retain their own clocks. 3D tracking, activity windows, metrics, source annotations, and scoring remain unchanged.

Before publication: back up the existing job result; compare scoreboard states and live play at the opening, either side of every boundary, middle, and end. Preserve Star Point scoring. Update the job manifest with compare-and-swap so concurrent publication cannot be overwritten. Record evidence separately from source annotations. This alignment is for rally navigation, not human verification of exact racket contact.

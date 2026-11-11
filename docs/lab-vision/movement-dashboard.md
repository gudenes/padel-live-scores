# Movement dashboard and video review

Player performance uses the current published analysis result and its linked player IDs. Headline distance (observed / inferred), peak sustained one-second speed and average speed retain the worker's definitions. Totals cover the whole analysed interval, not the selected scouting set. Partial results are labelled as samples.

Charts load the authenticated minute chunks on demand, with progress and error feedback. Three files load concurrently. Derived series are cached in browser memory (three result revisions maximum), not published or uploaded. This does not run models or modify results.

One-second displacement windows require observed positions, visible tracking, the same camera segment, and consecutive frames no more than 0.15 seconds apart. A window ends between 0.999 and 1.21 seconds; displacements over 30 km/h are excluded. Inferred positions reset the window. Charts therefore differ from worker accumulated path distance and peak calculations; they must not replace those totals.

Intensity bars show displacement metres per valid minute in 30-second bins; bins with fewer than five valid seconds remain absent. Speed distribution is duration-weighted over valid windows (<3, 3–6, 6–12, >=12 km/h). Zone bars use published zone times, including brief holds. Neither low movement nor gaps imply fatigue or injury.

Click or keyboard-scrub the performance graph to open Video review at source-video time. Uploaded/linked local playback shows a collapsible Movement panel with per-player one-second speed, shared seek controls and a 60-second moving window. Missing tracking stays blank. Broadcast playback does not apply uploaded-video tracking coordinates.

Validation: TypeScript; movement-series unit tests (known velocity, missing frames, cuts, inference, unavailable bins); full existing Alfonso/Libaak vs Coello/Nieto chunks; local authenticated report and graph-to-video seek. No processing jobs started and no production deployment.

## Court zones and interval review
Court schematic normalizes the player's half across end changes: attack 0–5 m from net, transition 5–7 m, defence 7–10 m. Full analysis uses published zone totals including brief holds. Selected intervals use complete observed one-second windows only; camera cuts and inference are excluded.

Point clocks use published segmented scouting alignment. Invalid, out-of-range and edit-crossing points are excluded; overlapping windows merged. Sets/games contain point intervals only. Breakdown displacement sums one-second displacements, not worker path distance. Headline metrics remain full-analysis totals. Review buttons seek aligned video.

## Performance navigation and break points
Player performance has Performance & shots and Movement load sections. Movement intensity charts mark aligned break-point rally starts: hollow markers for opportunities not converted and filled markers for converted breaks. Outcomes come from scouting, never inferred from movement. The comparison aggregates observed one-second displacement/time in break-point versus other rallies within the selected interval, across either team's opportunities. It displays observed seconds and tracked/total rally counts. This is descriptive, not a causal or statistical correlation claim. Event buttons seek the corresponding rally in Video review.

### Serving versus returning context
Break-point comparisons now separate saving a break (opponent has the break opportunity), trying to win a break (selected player's team has the opportunity), and other rallies. This is team context, including the partner's service games. Team mapping uses the report's player ordering (0–1 team A, 2–3 team B), not court end or appearance. Success counts show saved or converted break points. No movement-performance chart, interval or event navigates to Video review; the separate Video review speed control continues to scrub its own video.

### Heatmap and player switching
Position heatmap accumulates observed frame-to-frame dwell time into 1 m cells, retained only within accepted one-second windows. It shares the interval filter with movement charts, excludes off-court coordinates, and shows both physical halves in broadcast orientation rather than inventing end-change normalization. Cell opacity is relative to the busiest cell in the current selection; hover titles show absolute seconds and share. Missing tracking is not filled. Movement player can be selected with either avatar buttons or a native dropdown. Break markers use the existing momentum palette (#c9f43b lime and #ff8a7a coral).

### Sprint / acceleration pilot (local)
- Uses existing tracking chunks only, no worker or video reprocessing. Same player and set/game/point filters as movement charts.
- Derives velocity using linear regression of court positions within ±0.25 s (at least 0.4 s support and 5 observations). Signed acceleration is change in smoothed speed over approximately 0.5 s, not vector turning acceleration.
- Segments reset on missing/inferred positions, hidden overlays, camera cuts, time gaps over 0.15 s, and raw jumps above 10 m/s. Speeds above 30 km/h and acceleration magnitudes above 12 m/s² are excluded as exploratory sanity limits, not validated physiological thresholds.
- Sprint = continuous estimated speed ≥12 km/h for ≥0.5 s. No gap fills or effort merging. Missing tracking can split efforts; count is not a complete-match ground truth. Full-analysis estimates include between-point movement.
- Court arrows show start/end displacement. Direction uses initial half relative to the net: longitudinal (<22.5°), diagonal, lateral (>67.5°). Physical ends are not merged.
- Interval filters require the full supporting velocity/acceleration window inside the selected point interval. Peaks and counts are exploratory, not biomechanical validation.

### Combined-end court views
Heatmap cells now rotate the far half 180° and merge it into the near/player half (including left/right reversal). Sprint arrows use the same rotation for both endpoints, chosen from the starting half. This replaces the physical-end display described above. Observed time totals, sprint counts and measured distances remain unchanged; the opponent half is context only.

Heatmap and sprint visuals now display only the enlarged 10 × 10 m player half. Heat colors run green → yellow → red relative to the selected player's maximum cell time, with clipped SVG blur for visual transitions. Hover/tap details retain original 1 m cell times (smoothing is presentation only). Unobserved cells remain pale; no observations or metrics are synthesized.

## Overview movement widget
Overview aggregates the existing observed one-second windows into match intensity (sum displacement / sum observed player time), sprint effort counts, fastest observed one-second effort, and total displacement. Rankings sort by peak, sprint count or displacement, with tracked time visible. Team intensity uses 30-second bins weighted by observed player time. Set filters include aligned point intervals only; full analysis also includes between-point movement. Displacement is explicitly distinct from published worker path distance. Missing observations are excluded, not interpolated. View movement details opens the Movement load subtab. No analysis job or result mutation is required.

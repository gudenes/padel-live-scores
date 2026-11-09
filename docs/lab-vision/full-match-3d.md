# Full-match 3D review — local pilot

The match report 53969a2c-431f-4ccc-a0e0-fc4cc84bcdfa now uses the existing court assets with full-match tracking. No models were rerun. The user explicitly links their local full-match video; video time zero is original broadcast time 18881 seconds (05:14:41).

## Rebuild

From this worktree:

```sh
python3 scripts/lab-vision/build_full_match_viewer.py --source /Volumes/Crucial/dev/padel-match-analysis/world-cup-finals-20261107/match-1-analysis --output apps/ops/public/lab-vision/match1
```

Inputs: stabilized movement data.json, pose-30fps chunks, summary homography, WASB refined trajectory, and existing ball gap/continuity estimates. The export contains a coverage manifest and 125 one-minute JSON chunks. The viewer loads the current chunk and its neighbors; court geometry is reused from rally35. This packaging convention is reusable, but the app's match identity and source binding are still specific to this local pilot.

## Coverage and limitations

- Recording: 7480 seconds (2:04:40).
- 188 court-view sections, totaling 2243.9 seconds (37:23.9). Coverage is not a verified count or duration of live points; replay/court-view classification still requires review.
- 74800 movement rows; 66945 frames with matched pose data; 48742 valid ball projection frames.
- Players disappear outside reliable tracking sections. Interpolation does not cross segment changes. Existing brief inferred positions remain labeled in source data.
- Skeletons lift image-space pose into an illustrative court view; they are not measured 3D biomechanics.
- Ball is a floor projection, including existing labeled inference, not measured 3D flight. Airborne ball projection can be inaccurate or absent.
- Identity assignments after cuts are provisional. Player names require review across side changes before using identity-specific conclusions.
- Shot classification/direction is not added.

## Verification

All 125 JSON chunks parsed; visible movement rows checked against matching coverage segment. Browser reviewed near opening, middle, and final-set sections: skeleton/ball rendering and seeking work; close-up footage hides the miniature and exposes Next tracked section. JavaScript syntax and diff whitespace checks pass. Repo-wide TypeScript checking has pre-existing unrelated errors; no errors were reported for LabVisionMiniature, VideoReview or ReplayPlayer.

## Skip dead time playback

The video controls now offer Full video, Skip dead time and Rally loop. Skip dead time uses all valid scouting point intervals, adjusted by the selected video's broadcast offset; it does not use tracking coverage as a proxy for live play and does not restrict playback to the sidebar filters. Each interval includes 1 second before and 1.5 seconds after the point. Overlapping intervals merge, gaps seek forward while playing, and playback pauses after the final interval. Paused scrubbing stays under the coach's control. Original video, timestamps and audio within retained intervals are unchanged; no new file is rendered. Boundary accuracy depends on scouting timestamps. Local/direct media and YouTube support this mode; the Red Bull embed does not. Playback speed remains selectable, including 2×.

Validation: three unit tests cover invalid/offset/out-of-range times, overlapping intervals, gaps and final stop. Browser verified opening gap skip with the linked local video. No new TypeScript errors in the changed playback components.

## Experimental vision-driven skipping

`build_activity_windows.py --viewer apps/ops/public/lab-vision/match1 --ball /Volumes/Crucial/dev/padel-match-analysis/world-cup-finals-20261107/match-1-analysis/wasb-refined-trajectory.json` reproduces the candidate windows without scouting labels or rerunning models. It uses half-second bins, observed player displacement, confidence-gated wrist motion normalized by torso length, and detected (not inferred) WASB ball motion. Activity gaps up to four seconds stay together; candidate windows have a two-second lead-in and three-second tail, bounded by the same tracking/camera segment. Parameters and per-bin diagnostics are saved alongside the export.

Result: 183 windows, 2184.7 seconds (36m25s). Only ~59 seconds are removed from the existing reliable court-view coverage: this is a conservative activity proposal, NOT evidence that 36m25s is true playing time. It does not classify serve/contact/end events; replays or walking may remain and quiet rallies may be missed. Tracking missing the start of a point cannot be repaired by this step. Human boundary review is needed before claiming improved accuracy or using these windows as training labels.

On the local pilot report, Skip dead time exposes Lab Vision · experimental and Scouting timestamps. Vision source times are converted using broadcast offset 18881 and the current video offset. UI defaults to Vision once that match's export loads. Other matches keep scouting mode. Verified opening seek to 20.6s, valid ordered/nonoverlapping windows contained within camera segments, and no relevant TypeScript diagnostics.

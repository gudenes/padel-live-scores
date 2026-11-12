# Upload alignment and review preparation

The upload wizard marks the first timed **scouted point**, not an assumed first serve of the entire match. Its rally ID, original scouting seconds and selected video seconds are saved as `scoutingAnchor`. `offset = sourceTime - videoTime`. Court calibration has a separate timestamp and can be retained when changing only the anchor.

The server validates the anchor against the saved scout before accepting setup or starting a job. A legacy setup without an anchor remains unaligned; no guessed offset is promoted to confirmation.

On worker completion, `prepareReview` imports the saved scout into the annotation project if absent, initializes alignment if absent, and records a movement-coverage review summary. It never changes annotation rows or existing imported projects. Tracking is still published if review preparation fails; the admin can retry **Prepare review · no reprocessing**. No new pose/WASB execution is needed for that retry.

The shot-review reader can also read the saved scout directly for older jobs. Scouting starts and taps remain unverified contact proposals. Existing track chunks provide pose-based boxes through the established review UI. Approved/excluded annotations retain their provenance and are not automatically used for training.

The report resolves the saved video anchor at read time. Explicit shot-review corrections are shared with the report; existing segmented report alignments are preserved. Upload setup anchors take precedence over old automatically initialized annotation anchors. Calibration updates do not change the original job's tracking identities.

Movement review displays observed and inferred time, distance and peak speed. Review tracking opens the existing player-tracking annotation flow. These summaries are not automatic certification of identities, calibration, outside-court recovery, or biomechanical correctness. Camera-cut and identity QA still need visual review. Movement corrections do not silently change the published totals.

No-scouter matches can process movement but require manual contact annotations or the existing pose candidate flow. One anchor does not prove an edited recording is aligned throughout; check the beginning, middle and end before trusting point-level aggregates.

Local validation: TypeScript, preparation/anchor unit tests, job setup and calibration API tests, workspace access tests, scouting proposal tests. Kuwait match `64fc85ca-6e7b-4773-9608-bf7562e89e07` yielded 895 proposals from 94 saved rallies via the read-only fallback; the initial read-only audit left alignment unchanged.

## Completed local walkthrough — 12 November 2026

For Kuwait match `64fc85ca-6e7b-4773-9608-bf7562e89e07`, reviewed the downloaded original video and existing normalized recording. First-point preparation is at 52.99616 s (serve follows), matching scouting 11812.99616 s: broadcast offset 11760 s (03:16:00). Checked middle point 48 around 31:29.506 (second set, games 1–0, points 15–0) and final point 94 around 56:58.082 (second set, games 5–1, advantage Coello/Tapia). These are point-level alignment checks, not frame-verified shot labels.

Completed the actual local report wizard: selected the existing video, restored identities/calibration, marked the first scouted point, retained court frame 51 s, and saved. The shared match setup now persists this anchor. Ran “Prepare review · no reprocessing”; original job remains complete/review. Review is ready with 94 points and 895 pending proposals; no labels approved or overwritten. Report timeline now displays 45 winners, 24 unforced errors and 25 other errors. Movement load resolves all 94 rallies (8 returning break points, 86 other points for Coello) using existing tracking.

Local code remains on `codex/aligned-review-pipeline`; no deployment performed. Match alignment and review metadata were saved through the authorized app flow to the shared database. Pose and WASB were not rerun.

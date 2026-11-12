# Upload alignment and review preparation

The upload wizard marks the first timed **scouted point**, not an assumed first serve of the entire match. Its rally ID, original scouting seconds and selected video seconds are saved as `scoutingAnchor`. `offset = sourceTime - videoTime`. Court calibration has a separate timestamp and can be retained when changing only the anchor.

The server validates the anchor against the saved scout before accepting setup or starting a job. A legacy setup without an anchor remains unaligned; no guessed offset is promoted to confirmation.

On worker completion, `prepareReview` imports the saved scout into the annotation project if absent, initializes alignment if absent, and records a movement-coverage review summary. It never changes annotation rows or existing imported projects. Tracking is still published if review preparation fails; the admin can retry **Prepare review · no reprocessing**. No new pose/WASB execution is needed for that retry.

The shot-review reader can also read the saved scout directly for older jobs. Scouting starts and taps remain unverified contact proposals. Existing track chunks provide pose-based boxes through the established review UI. Approved/excluded annotations retain their provenance and are not automatically used for training.

The report resolves the saved video anchor at read time. Explicit shot-review corrections are shared with the report; existing segmented report alignments are preserved. Upload setup anchors take precedence over old automatically initialized annotation anchors. Calibration updates do not change the original job's tracking identities.

Movement review displays observed and inferred time, distance and peak speed. Review tracking opens the existing player-tracking annotation flow. These summaries are not automatic certification of identities, calibration, outside-court recovery, or biomechanical correctness. Camera-cut and identity QA still need visual review. Movement corrections do not silently change the published totals.

No-scouter matches can process movement but require manual contact annotations or the existing pose candidate flow. One anchor does not prove an edited recording is aligned throughout; check the beginning, middle and end before trusting point-level aggregates.

Local validation: TypeScript, preparation/anchor unit tests, job setup and calibration API tests, workspace access tests, scouting proposal tests. Kuwait match `64fc85ca-6e7b-4773-9608-bf7562e89e07` yielded 895 proposals from 94 saved rallies via the read-only fallback; no production alignment was guessed or written during verification.

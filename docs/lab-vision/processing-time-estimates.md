# Processing time estimates (local preview, November 10 2026)

The jobs GET endpoint calculates remaining analysis time from the real worker stage and progress. No worker restart, new processing or job mutation is required. The local report uses the estimate through AnalysisActivity; the authenticated development-only `/dev/analysis-progress/live?video=<video-id>` page reads the same endpoint.

## Baseline

`analysis-benchmark.json` contains 19 completed blocks from World Cup finals matches 1 and 2 on the current Mac, at 30 fps with MPS pose and WASB. Six-second smoke tests and incomplete jobs are excluded. The importer requires a completed pose block and matching ball duration. Files used:

- `world-cup-finals-20261107/match-1-analysis/blocks/*/progress.json` and `wasb-candidates-summary.json`
- `lab-vision-jobs/0161c4f3-02ba-4776-a8b2-37eec3d6d34e/block-*/progress.json` and `wasb-candidates-summary.json`

Pose median is 0.652 wall seconds / video second; WASB median is 1.208. The initial range uses observed minimum/maximum block rates. This is an empirical planning range, not a statistical confidence interval or a guaranteed completion time. It applies only to the associated worker ID; other devices receive no estimate until calibrated.

Use `scripts/lab-vision/build_timing_benchmark.py --worker-id ID --output PATH MATCH_BLOCK_PARENT...` to refresh from comparable completed runs. Verify device/model/fps compatibility before import; do not mix different hardware or pipelines. This version does not automatically learn from new completed jobs.

## Updating the prediction

Remaining player work + remaining ball work + allowances gives the range. The endpoint observes actual worker timestamps and cumulative progress. After at least 30 seconds with measurable progress, the active stage uses observed throughput with a -15%/+20% range. Browser polling alone never counts as throughput. Stage changes and progress rollback reset observations. Refinement subtracts the block that just finished; ball inference is interleaved with refinement.

Old runs did not measure setup, normalization, movement, refinement and publishing separately. These remain explicit allowances: 2–10 minutes of overhead, plus 4–30% of video duration during preparation (minimum 1–5 minutes), plus 1–15 minutes during download until its measured transfer rate is available. Publishing alone uses 0.5–10 minutes. The estimate is withheld when the heartbeat is more than 45 seconds old or the job is not running.

No fabricated normalization progress or countdown is shown. The preparation range may stay unchanged until the next measured stage. Future improvement: persist per-stage elapsed timings in worker telemetry, including encoding and upload bytes, replacing these allowances.

## Validation

Tests cover future-stage inclusion, progress advancement, measured throughput, stale and other-device suppression, refinement boundaries, and repeated browser polling. Production has not been deployed as part of this local iteration.

## Personal analysis tasks

The app header polls the authenticated user's existing analysis jobs every 10 seconds. Queued/running jobs remain visible; completed and failed jobs are retained in this view for seven days. Task links open the existing match report's Video review tab and analysis drawer. Completion/failure toasts appear while the app is open; this is not email or operating-system push notification delivery. Seen status is stored per user in this browser. The API scopes every query to the authenticated initiating user. No duplicate task records or processing jobs are created.

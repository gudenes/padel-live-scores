# Lab Vision: laptop-processing release

The production admin supports local video selection, on-device frame extraction, authenticated Astra setup estimation, editable court/net markers, in-frame player confirmation, and calibration JSON export. Video playback uses a browser object URL: no video is uploaded, and the user must reselect it after reload. Browser bookmarks/setup remain local to that origin.

For the processed World Cup match 53969a2c-431f-4ccc-a0e0-fc4cc84bcdfa, the existing tracking bundle enables full-match 3D review, activity-based skip-dead-time Beta and movement metrics. These datasets are match-specific; they must not be reused for another video/match.

## Processing boundary

The Mac runs the existing local Python/WASB pipeline separately. The wizard exports the confirmed setup, including source dimensions, normalized points, identities, match ID and timing. It does not start a remote job, upload source video, or automatically publish new results. The current runner still requires its existing per-match config/calibration format; the exported setup is a handoff, not a directly executable job.

Automatic sample/full-match submission, worker pairing, durable queues and results ingestion are not shipped in this release. No laptop ports or tunnels are exposed. Cloudflare storage is not configured or required for local-file playback.

## Release validation

Targeted tests: video review, dead-time windows, moment labels, frame synchronization, authenticated setup API (22 tests). Production Astra key/model access checked without logging secrets. Build and deployment follow scripts/deploy.sh after merge to main.

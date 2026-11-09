# Lab Vision on the Mac

The admin app queues analysis against a private uploaded video. An authenticated Mac worker polls outbound HTTPS, downloads only that owner's queued video, runs the existing pose/player, movement and WASB stages, and uploads a result archive to private R2. There is no inbound laptop port, browser-to-localhost dependency, or cloud inference charge for these stages.

## Operator flow

1. Add video in the report. Select first serve and a clear setup frame; confirm court, net and four player names.
2. Upload the same file to Cloudflare. The confirmed setup is associated by filename and exact byte size; a different file is rejected.
3. Connect the Mac once. Download the private connection file from **Connect or manage my Mac**. Store it at `~/Library/Application Support/Padel Labs/lab-vision-worker.json` with mode 0600.
4. Start `apps/lab-vision-worker/start.command`. It uses the existing `/Volumes/Crucial/dev/padelgod/video/.venv/bin/python` environment and prevents idle sleep only during an active job. Config may override `work_dir`, `pose_weights`, and `ball_root`; `LAB_VISION_PYTHON` overrides Python.
5. Click **Run analysis on my Mac**. Start with 60 seconds to review setup, then choose full match. The app shows connection, stage, stage progress, stop, metrics and the downloadable result bundle.
6. Keep the Mac awake and the external drive mounted. Closing the browser does not stop processing. Disconnecting the worker revokes its credential and stops new job access; an active worker stops at its next heartbeat.

The wrapper can be installed as a login LaunchAgent on this Mac. Credentials remain outside Git; the server stores only SHA-256 token hashes. Rotate by connecting a new worker and disconnecting the old one.

## Queue and recovery

Migration `20261109210000_lab_vision_workers.sql` enables RLS and removes direct client roles. Only authenticated operators can create jobs for their own ready uploads. Workers can claim only jobs belonging to the credential owner. A partial unique index prevents simultaneous active jobs for one video. Advisory locks serialize claims per worker, row locks protect claims across workers, and attempt IDs fence stale heartbeats/results. A two-minute lease is renewed every ten seconds. Network loss exceeding 65 seconds stops child processes; a later worker can reclaim the job and reuse completed blocks. A local filesystem lock prevents two copies using one work directory. Cancellation is checked at heartbeat and subprocess/download boundaries.

## Pipeline provenance and output

`apps/lab-vision-worker/engine` preserves the latest World Cup tracker and WASB/refinement scripts plus the established stabilization/gap/zone algorithms. The adapter removes match-specific file paths and calibrates team colour prototypes from the user-confirmed reference frame. Player names are seeded from foot marks, team order from the report. Similar kits or hidden setup players fail explicitly rather than guessing identities.

The input video is retained unchanged. A separate analysis-only native-resolution CFR30 copy supplies the tracker and WASB, preserving original file seconds. Audio remains in the hosted original. Pose is sampled at 30 Hz; movement metrics use the established 10 Hz stabilized observations. Completed blocks are reused on interrupted-job recovery.

Results include raw 30 Hz poses, calibrated tracking, observed and separately labelled inferred distance, one-second observed peak speed, zone occupancy, refined image-space WASB trajectory, segment snapshots, calibration, source time mapping and a manifest. The app shows summary metrics and offers the full private archive. On completion, the worker also uploads a private viewer manifest and minute-sized tracking chunks. After the server validates all files, the report automatically connects the 3D court and Player performance. No manual linking or copying is required. Output remains model estimates, not verified scouting.

The viewer follows original file time and uses the uploaded video ID. Player performance maps stable report player IDs captured during setup (older setups use exact names only). Samples show the processed window and sample distance; a later short sample cannot replace a longer completed analysis of the same upload. Average speed uses valid observed movement time, including stationary observations, excluding gaps and camera cuts. The 3D ball is a court-plane projection, not reconstructed flight height.

Update an existing installation by running `python3 apps/lab-vision-worker/install.py`; it retains the private connection config. Older completed jobs without viewer files remain downloadable; run the updated worker to produce connected results. A newer uploaded video never inherits results from a previous upload.

Camera cuts and rejected views are not bridged. Gaps are bounded; inferred movement does not inflate peak speed. Generic jobs do not yet configure scoreboard replay rejection, so same-angle replays and dead time need review. Contact, direction and shot classification are excluded. WASB coordinates are image-space detections, not measured 3D ball flight.

## Dependencies

The current machine already has PyTorch MPS, Ultralytics, OpenCV, NumPy, PyYAML, requests, ffmpeg/ffprobe, the existing pose weights, and WASB-SBDT checkout/weights. No model weights are committed. GPU processing is deliberately single-job sequential to avoid competing MPS memory use. Run a setup sample before scaling to another camera or kit combination.

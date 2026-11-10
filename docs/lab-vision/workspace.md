# Local Lab Vision workspace

Open `/lab-vision` on the local admin development server. Requires the existing administrator login. The page and API are development-only; nothing is deployed or written to production.

Workflow polls owned jobs and connected workers every five seconds through the existing database. It reuses stage progress and measured benchmark estimates, displays stale heartbeats, and does not invent overall percentages or installed versions. Links return to the match report for run/stop controls. Measurements describe capabilities and caveats, not per-frame quality scores.

The annotation pilot loads the private uploaded video from the selected owned job. Mark a moment, choose a player, shot/side/direction or tracking-quality issue, adjust clip bounds, and save a review status. Unknown labels remain explicit. Verification requires confirmation of timing. Click saved examples to revisit/edit; edits append revisions and export retains both latest labels and history.

JSON files are stored under `apps/ops/.local/lab-vision-annotations/<hashed-user>/<job>/` (or LAB_VISION_ANNOTATIONS_DIR). This directory is ignored by Git. Exports retain source video/job/match, reviewer, source-video times, revision chain and human provenance. These are annotations and clip boundaries, not rendered clips or trained checkpoints. Model outputs are never rewritten. The current pilot only exposes an operator's own jobs; inviting annotators/shared review queues requires a later permissions and database design.

Training still needs label QA, clip extraction, train/validation/test splits by match, dataset versioning and an explicit training/evaluation run. No GPU training or worker restart is triggered here.

Player boxes: pause on the desired frame and choose Draw / adjust player box. Drag the background to draw, the box interior to move, or any of eight handles to resize. The box is stored in normalized video-frame coordinates at the annotation timestamp with human provenance, and shown only on that frame. It is not an automatic tracking sequence. Serve examples can separately record First/Second attempt and Front/Back/Side viewpoint; these do not change the Serve class. Existing records without boxes remain supported.

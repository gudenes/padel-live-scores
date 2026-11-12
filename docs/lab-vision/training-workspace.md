# Local training workspace

Open `/lab-vision?tab=training` on the local admin server using normal administrator authentication. This prototype is development-only; it does not start GPU jobs or change the active analysis worker.

## Dataset

Reads existing shot annotations across analysis runs and keeps the latest revision. Quick shot approval now explicitly confirms the displayed contact timestamp. Historical approvals remain unverified unless reconciled following reviewer attestation; reconciliation appends audited revisions and preserves adjusted timestamps, labels and boxes. Eligible examples require a reviewed starter-class label, confirmed contact time, hitter, valid normalized box and clip bounds within the source video. Rejections and uncertain labels are not training examples.

Starter classes are Serve, Groundstroke, Volley, Lob and Overhead. Smash, Bandeja, Vibora, Gancho and Rulo map to Overhead for this experiment; original labels remain in snapshots. Match-level train/validation/test assignment prevents clips from the same match leaking across splits. Three distinct splits are necessary, not sufficient evidence of dataset quality.

Snapshots are immutable local JSON files with annotation IDs, source job/video/match references, source-video timestamps, eligibility policy, creator, creation time and content hash. Existing database annotations are read-only.

## Training

Prepared plans reference a saved snapshot, epoch count and budget. They can be exported, but no runner or billing limit enforcement is connected yet. Clip extraction, pose-window extraction, model fitting and compute execution remain a separate implementation milestone. WASB remains unchanged.

## Evaluation

Import predictions for held-out test annotation IDs using the downloadable JSON template. Unknown IDs, train/validation IDs, duplicates, invalid classes and invalid confidence values are rejected. Accuracy, class F1 and coverage are computed from supplied predictions. Partial coverage is explicitly marked. Mistakes can be replayed using the authenticated source video and inspected at the contact frame.

## Storage and privacy

Artifacts live in `apps/ops/.local/lab-vision-training` (ignored by Git), shared by authorized administrators of this local workspace. They are not uploaded or published to production. The route uses the existing administrator session and same-origin checks. Private video URLs use the existing authenticated playback route.

## Validation

Unit coverage includes annotation revision handling, rejection exclusion, quick-review versus timing verification, clip/box bounds, original label preservation, split isolation and evaluation validation/F1/coverage. Visual QA additionally requires an authenticated local browser session and independent milestone review.

## Library corrections and Smash
The library uses dataset eligibility checks, not the stored trainingEligible flag. Not eligible excludes rejections and non-shot annotations. Filter by reason, then Review / correct shot reuses QuickShotReview with a fixed filtered queue and saved timestamps; no new scouting alignment is needed. Changes append revisions. Z/C steps frames, Space replays, B edits the box, Q selects Smash, Enter confirms and R rejects.

New snapshots use starter-eight-v3 with Smash, Bajada and Contrapared separate from Overhead. Original labels remain intact. Existing starter-five-v1 and starter-six-v2 snapshots retain their original evaluation classes. The training tab and artifact API remain development-only. Production annotation libraries display per-analysis approved/eligible class counts and use the eight-class policy.

# Local pose baseline

Uses existing verified-contact annotations and cached viewer poses; no videos, pretrained models or cloud GPU are downloaded. The model is an 816 → 128 → 8 MLP. This is an experimental shot classifier, not a ball tracker or a video model.

Run `runner.py --config <existing-worker-config> --snapshot <snapshot-id> --cache <job-cache> --output <external-training-directory>` with a Python environment containing numpy and PyTorch. Existing worker credentials are validated on every request; plans are scoped to their owner and worker. Do not log or copy credentials into the repository.

Connecting prepares features and saves a plan awaiting approval. **It does not train.** Lab Vision → Training → Runs displays the cost and an explicit Start button. The runner polls outbound HTTPS every 15 seconds and claims only approved plans. A claim is atomic, with no automatic retries. Keep the computer awake and the external drive attached. Cancellation is checked after each epoch; a parent process kills training at 30 minutes. After a process crash, reconnecting marks the old run failed rather than repeating it. There is no cloud fallback or paid-compute API.

Sixteen frames are sampled within saved clip bounds, at most one second either side of contact. Only the annotated player's tracked ID is used. Confident shoulder/hip joints anchor translation and scale; at least 12/16 frames need a reliable pose within 120 ms. Skipped IDs and reasons are in `preflight.json`. The immutable snapshot is not changed.

Training uses only training matches, class weights from training labels, seed 42 and AdamW. Validation loss selects the best epoch. Held-out predictions are produced once after training and sent to Lab Vision for server-calculated metrics. Partial pose coverage remains explicitly partial evaluation. Candidate weights, history, and predictions stay on the selected drive. Production models are never replaced. Local electricity costs depend on actual power, runtime and tariff; cloud compute costs are zero. The epoch cap is 20 and wall-time cap 30 minutes, not a runtime estimate.

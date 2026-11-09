# Video setup wizard

Local match report → Video review → Add video.

1. Select MP4/WebM/MOV. Browser validates metadata and playback; source audio/file remain intact.
2. Generate eight coarse or nearby frame previews locally. Choose first serve as matchStart (seconds into file). Original broadcast offset is a separate field; no trim or timestamp rewrite occurs.
3. Freeze a clear wide frame (may differ from first serve). Use frame & detect automatically sends this one JPEG to the authenticated /api/internal/lab-vision/setup endpoint. It calls gpt-6-astra via Responses, store:false, structured normalized coordinates. OPENAI_API_KEY must be configured on the server. Never place the key in browser code. Coordinates are editable estimates. Ten points: four floor corners in perimeter order; two net floor endpoints; four player foot midpoints. User assigns names on the frame beside each detected player, then confirms. Re-detection clears previous identity assignments. Missing detections can be marked manually through the adjustment controls. Loading is indeterminate; it represents setup estimation, not full-match processing. Reflections and uncertain coordinates should be rejected/null.
4. Save local setup and open video at matchStart. Setup is stored in localStorage keyed by match pathname, file name and size; file signature also includes lastModified. Includes source, selected frame time, normalized points, roster mapping and confirmation. This is not a tracking result and does not replace existing processed tracking.

Current limitations: cloud upload, a short tracking validation job, downstream consumption of this setup, and whole-match job submission are not connected. A single frame cannot establish identity continuity, camera-cut calibration, pose tracks or changes of ends. No automatic job is launched. The local video-review dev server now reuses the match-assistant OpenAI key through its ignored .env.local. A read-only model-access check confirmed gpt-6-astra is available. Production credentials have not been changed. Live Astra estimation accuracy remains unvalidated.

Validation: browser frame previews and manual marker editing reviewed; six tests cover authentication, origin, missing provider configuration, malformed input, bounds and crossed corners. TypeScript check has existing repository errors; none reference changed implementation files.

Player confirmation uses red pending markers at detected foot positions. Clicking a marker opens an in-frame name picker; selecting a name confirms it immediately and turns the marker green. Assigned names are disabled for other markers. Confirmed markers can be reopened to correct an identity; position adjustment remains available.

Selecting a calibration number enters clear placement mode: competing labels are hidden, court guides are dimmed, and the next frame click relocates that marker and exits placement mode. Cancel or Escape exits without changing its position. Player identities are preserved.

Court and net markers support pointer dragging with a magnified crosshair preview on the opposite side of the image. Positions clamp to frame bounds; release commits, pointer cancellation discards the drag. A short click still enters click-to-place mode.

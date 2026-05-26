# OCR Worker

Python service that reads padel scores from the on-screen scoreboard of
YouTube live broadcasts and writes immutable snapshots to
`padelgod.ocr_snapshots`. Shadow-only — does not touch `public.*`.

See [design spec](../../docs/superpowers/specs/2026-05-24-ocr-worker-design.md).

## Local development

```bash
cd apps/ocr-worker
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest
```

## Environment variables

| Var | Description |
|---|---|
| `SUPABASE_URL` | Padel Nachos Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Service-role key (bypasses RLS) |
| `OCR_STREAM_LABEL` | Calibration JSON key (must match a file in `calibrations/`) |
| `OCR_YOUTUBE_URL` | Full YouTube live URL |
| `OCR_TOURNAMENT_ID` | UUID of currently-running tournament |
| `OCR_COURT_LABEL` | Matches `public.matches.court` (e.g. 'Pista Central') |
| `OCR_FRAME_INTERVAL_SECONDS` | Optional, default 3 |
| `OCR_CONFIDENCE_THRESHOLD` | Optional, default 0.7 |
| `OCR_WORKER_VERSION` | Optional. Falls back to `RAILWAY_GIT_COMMIT_SHA` (auto-injected by Railway) then to `"unknown"`. Set explicitly only when pinning a release tag (e.g. `v1.1.0`). |
| `OCR_FRAME_RETENTION_RATE` | Optional, default `0.01`. Probability of retaining a frame to the `ocr-frames` Supabase Storage bucket for a normal-confidence snapshot. Low-confidence frames are always retained regardless of this rate. Bump to `1.0` during smoke tests so every snapshot becomes clickable in the admin **OCR Health → snapshot drawer**. Roll back to `0.01` (or unset) once verified to keep the bucket bounded. |

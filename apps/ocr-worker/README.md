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
| `OCR_WORKER_VERSION` | Injected at build from `git rev-parse --short HEAD` |

-- Create padelgod.ocr_snapshots: append-only log of OCR'd scoreboard reads
-- from broadcast video. See docs/superpowers/specs/2026-05-24-ocr-worker-design.md
-- §5.1 for the full design rationale.
--
-- Schema isolation: lives in padelgod schema (not public). Same pattern as
-- padelgod.oop_snapshots / padelgod.results_snapshots — service-role-only
-- via schema scope, not via RLS.

BEGIN;

CREATE SCHEMA IF NOT EXISTS padelgod;

CREATE TABLE IF NOT EXISTS padelgod.ocr_snapshots (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  captured_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  frame_at         TIMESTAMPTZ NOT NULL,

  youtube_video_id TEXT NOT NULL,
  stream_label     TEXT NOT NULL,

  tournament_id    UUID REFERENCES public.tournaments(id),
  match_id         UUID REFERENCES public.matches(id),
  court_label      TEXT,

  parsed_score     JSONB NOT NULL,
  raw_text         TEXT,
  ocr_confidence   NUMERIC(4,3) CHECK (ocr_confidence BETWEEN 0 AND 1),

  frame_storage_path TEXT,
  worker_version   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ocr_match_time
  ON padelgod.ocr_snapshots (match_id, frame_at DESC)
  WHERE match_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ocr_stream_time
  ON padelgod.ocr_snapshots (stream_label, frame_at DESC);

CREATE INDEX IF NOT EXISTS idx_ocr_unresolved
  ON padelgod.ocr_snapshots (captured_at DESC)
  WHERE match_id IS NULL;

COMMENT ON TABLE padelgod.ocr_snapshots IS
  'OCR-derived scoreboard reads from broadcast video. Append-only, immutable. One row per frame sampled (~1 every 3s while a stream is being captured).';

COMMIT;

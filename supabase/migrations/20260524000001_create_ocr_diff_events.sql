-- Create padelgod.ocr_diff_events: agreement / disagreement records between
-- OCR snapshots and Crionet-fed public.sets/games values. Produced by the
-- shadow-diff-ocr worker on a 5-minute cadence.
-- See docs/superpowers/specs/2026-05-24-ocr-worker-design.md §5.2.

BEGIN;

CREATE TABLE IF NOT EXISTS padelgod.ocr_diff_events (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id        UUID NOT NULL REFERENCES public.matches(id),
  ocr_snapshot_id BIGINT NOT NULL REFERENCES padelgod.ocr_snapshots(id),
  checked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  agreement       TEXT NOT NULL CHECK (agreement IN (
                    'match', 'sets_disagree', 'game_disagree',
                    'both_disagree', 'no_crionet_baseline', 'pair_label_mismatch'
                  )),
  ocr_score       JSONB NOT NULL,
  crionet_score   JSONB,
  lag_seconds     INT,
  notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_diff_match
  ON padelgod.ocr_diff_events (match_id, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_diff_disagreements
  ON padelgod.ocr_diff_events (checked_at DESC)
  WHERE agreement != 'match';

COMMENT ON TABLE padelgod.ocr_diff_events IS
  'Per-snapshot agreement classification: ocr_snapshots compared against current public.sets/games. Operator labels (correct/incorrect) written to notes.';

COMMIT;

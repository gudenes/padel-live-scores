-- Add court_position to padelgod.oop_snapshots so the reconciler can
-- propagate a stable per-court ordering to public.matches.court_order.
-- Nullable: existing rows don't have a trustworthy order value and we'd
-- rather leave them NULL than invent one. All new rows from the patched
-- oop-fetcher set it.

ALTER TABLE padelgod.oop_snapshots
  ADD COLUMN IF NOT EXISTS court_position integer;

COMMENT ON COLUMN padelgod.oop_snapshots.court_position IS
  '0-based position of this match within its court''s play order, from '
  'the Crionet OOP widget column. Used by the static-reconciler to write '
  'public.matches.court_order (1-based).';

CREATE INDEX IF NOT EXISTS oop_snapshots_tournament_day_court_idx
  ON padelgod.oop_snapshots (tournament_id, day_number, court, court_position);

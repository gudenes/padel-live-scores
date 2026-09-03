-- Tournament Explorer list only needs max(captured_at) per tournament_id.
-- Existing indexes lead with extra columns (category / day_number), so
-- GROUP BY tournament_id seq-scans millions of append-only snapshot rows
-- and PostgREST statement-timeouts. These covering indexes make the
-- freshness aggregate an index-only lookup.

CREATE INDEX IF NOT EXISTS idx_entry_list_snap_tournament_captured
  ON padelgod.entry_list_snapshots (tournament_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_oop_snap_tournament_captured
  ON padelgod.oop_snapshots (tournament_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_results_snap_tournament_captured
  ON padelgod.results_snapshots (tournament_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_draw_snap_tournament_captured
  ON padelgod.draw_snapshots (tournament_id, captured_at DESC);

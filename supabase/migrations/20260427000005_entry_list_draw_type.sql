-- Add draw_type to padelgod.entry_list_snapshots so we can tell Main Draw
-- entrants apart from Qualifier entrants. Same column name + value enum
-- as padelgod.draw_snapshots ('main_draw' | 'qualifying') so the schema
-- stays consistent across snapshot tables.
--
-- Default 'main_draw' keeps existing 393 rows valid — they were written
-- before this column existed, when our PDF upload route silently dropped
-- the draw-type info the parser already extracted. The next padelgod
-- entry-list-fetcher run will overwrite with authoritative values for
-- active tournaments; historical rows stay tagged as main draw, which
-- is the correct default (qualifier rows are by definition only present
-- when explicitly parsed as such — there's no risk of misclassification
-- the other way).

ALTER TABLE padelgod.entry_list_snapshots
  ADD COLUMN IF NOT EXISTS draw_type TEXT NOT NULL DEFAULT 'main_draw'
    CHECK (draw_type IN ('main_draw', 'qualifying'));

CREATE INDEX IF NOT EXISTS idx_entry_list_snap_draw_type
  ON padelgod.entry_list_snapshots(tournament_id, category, draw_type, captured_at DESC);

COMMENT ON COLUMN padelgod.entry_list_snapshots.draw_type IS
  'Whether this entrant is in the main draw or qualifying. Sourced from
   FIP PDF section headers (QUALIFICATIONS / QUALIFYING) by
   src/lib/entry-list-parser.ts.';

-- Verification
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'padelgod'
      AND table_name = 'entry_list_snapshots'
      AND column_name = 'draw_type'
  ), 'draw_type column missing on padelgod.entry_list_snapshots';
END $$;

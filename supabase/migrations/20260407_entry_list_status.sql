-- Entry list status for tournament readiness gating
-- FIP tournaments require entry lists before matches are fully visible to users.

-- Add column with default 'not_applicable' (safe for existing padelapi tournaments)
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS entry_list_status TEXT NOT NULL DEFAULT 'not_applicable'
  CHECK (entry_list_status IN ('not_applicable', 'pending', 'partial', 'ready'));

-- Set all FIP-sourced tournaments to 'pending' by default
UPDATE tournaments
  SET entry_list_status = 'pending'
  WHERE source = 'fip'
    AND entry_list_status = 'not_applicable';

-- Backfill: set status based on existing ops_events (entry-list-seed records)
-- Tournaments with both men's and women's entry lists → 'ready'
-- Tournaments with one category → 'partial'
WITH seeded AS (
  SELECT
    meta->>'tournament_id' AS tournament_id,
    COUNT(DISTINCT meta->>'category') AS category_count
  FROM ops_events
  WHERE source = 'entry-list-seed'
    AND status = 'ok'
    AND meta->>'tournament_id' IS NOT NULL
  GROUP BY meta->>'tournament_id'
)
UPDATE tournaments t
  SET entry_list_status = CASE
    WHEN s.category_count >= 2 THEN 'ready'
    WHEN s.category_count = 1 THEN 'partial'
    ELSE 'pending'
  END
FROM seeded s
WHERE t.id::text = s.tournament_id
  AND t.source = 'fip';

-- Index for efficient filtering on user-facing pages
CREATE INDEX IF NOT EXISTS idx_tournaments_entry_list_status
  ON tournaments (entry_list_status)
  WHERE source = 'fip';

-- Track per-player FIP profile enrichment state so the player-profile worker
-- can pick its next batch self-healingly and skip permanent failures.

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS profile_fetched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS profile_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS profile_status     TEXT;

-- Allowed statuses: 'ok' | 'missing_page' | 'parse_error' | 'http_error' | 'permanent_failure'
ALTER TABLE players
  DROP CONSTRAINT IF EXISTS players_profile_status_check;
ALTER TABLE players
  ADD CONSTRAINT players_profile_status_check
  CHECK (profile_status IS NULL OR profile_status IN (
    'ok', 'missing_page', 'parse_error', 'http_error', 'permanent_failure'
  ));

-- Hot path: queue picks oldest-attempted players that aren't permanently failing.
CREATE INDEX IF NOT EXISTS idx_players_profile_queue
  ON players (profile_attempt_at NULLS FIRST)
  WHERE fip_id IS NOT NULL
    AND (profile_status IS DISTINCT FROM 'permanent_failure');

COMMENT ON COLUMN players.profile_fetched_at IS 'When the FIP profile was last successfully scraped.';
COMMENT ON COLUMN players.profile_attempt_at IS 'When the FIP profile was last attempted (success OR failure). Drives queue ordering.';
COMMENT ON COLUMN players.profile_status     IS 'Outcome of the last attempt. ''permanent_failure'' parks the row.';

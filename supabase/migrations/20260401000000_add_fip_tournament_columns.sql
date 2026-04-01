-- Add FIP standalone pipeline columns to tournaments table
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'padelapi';
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS fip_slug TEXT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS matchscorer_url TEXT;

-- Index on source column for efficient filtering
CREATE INDEX IF NOT EXISTS idx_tournaments_source ON tournaments (source);

COMMENT ON COLUMN tournaments.source IS 'Data pipeline source: padelapi or fip';
COMMENT ON COLUMN tournaments.fip_slug IS 'padelfip.com event slug for URL construction';
COMMENT ON COLUMN tournaments.matchscorer_url IS 'widget.matchscorerlive.com tournament code (e.g. FIP-2025-3301)';

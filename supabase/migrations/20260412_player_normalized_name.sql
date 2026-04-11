-- Enable unaccent extension for accent-stripping
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Add normalized_name column for fast name lookups
-- Stores the lowercased, accent-stripped version of the player name
ALTER TABLE players ADD COLUMN IF NOT EXISTS normalized_name TEXT;

-- Populate from existing names
UPDATE players SET normalized_name = lower(
  regexp_replace(
    regexp_replace(
      unaccent(name),
      '[^a-zA-Z0-9 ]', ' ', 'g'
    ),
    '\s+', ' ', 'g'
  )
) WHERE normalized_name IS NULL;

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_players_normalized_name ON players (normalized_name);

-- Trigger to auto-update normalized_name on insert/update
CREATE OR REPLACE FUNCTION set_player_normalized_name()
RETURNS TRIGGER AS $$
BEGIN
  NEW.normalized_name := lower(
    regexp_replace(
      regexp_replace(
        unaccent(NEW.name),
        '[^a-zA-Z0-9 ]', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_player_normalized_name ON players;
CREATE TRIGGER trg_player_normalized_name
  BEFORE INSERT OR UPDATE OF name ON players
  FOR EACH ROW
  EXECUTE FUNCTION set_player_normalized_name();

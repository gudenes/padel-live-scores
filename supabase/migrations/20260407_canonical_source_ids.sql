-- Canonical source IDs — Phase 1 of data-model cleanup.
--
-- GOAL
-- Rename the ambiguous `external_id` concept into explicit per-source columns
-- (`padelapi_id`, `fip_id`) across players, tournaments, and matches. The
-- UUID `id` column is already the canonical PadelNachos ID — no new column
-- needed for that.
--
-- ZERO-BREAKAGE STRATEGY
-- We add new columns and keep old columns (external_id, fip_slug) alive.
-- Triggers sync the pair in both directions so existing code keeps working
-- untouched. A follow-up migration will drop the old columns once all call
-- sites have been migrated to use the new names.
--
-- Behaviour:
--   - Write to only one column  → the other is auto-populated
--   - Write to both columns     → they are trusted as-is (caller is explicit)
--   - Update one column         → the paired column is kept in sync
--   - tournaments: padelapi_id ↔ external_id is gated on source='padelapi'
--     so fip-sourced rows (whose external_id is a slug like
--     "fip-fip-gold-...") do NOT populate padelapi_id
--   - tournaments: fip_id ↔ fip_slug is unconditional — the clean slug lives
--     in both columns
--
-- This migration is idempotent (uses IF NOT EXISTS everywhere).

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════
-- PLAYERS
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE players ADD COLUMN IF NOT EXISTS padelapi_id TEXT;

-- Backfill padelapi_id from existing external_id (100% of players have it).
UPDATE players
   SET padelapi_id = external_id
 WHERE padelapi_id IS NULL
   AND external_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS players_padelapi_id_key
  ON players(padelapi_id)
  WHERE padelapi_id IS NOT NULL;

CREATE OR REPLACE FUNCTION sync_players_id_columns() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Fill the missing side from whichever column the caller provided.
    IF NEW.padelapi_id IS NULL THEN NEW.padelapi_id := NEW.external_id; END IF;
    IF NEW.external_id IS NULL THEN NEW.external_id := NEW.padelapi_id; END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- If one side changed and the other didn't, propagate the change.
    IF NEW.padelapi_id IS DISTINCT FROM OLD.padelapi_id
       AND NEW.external_id IS NOT DISTINCT FROM OLD.external_id THEN
      NEW.external_id := NEW.padelapi_id;
    ELSIF NEW.external_id IS DISTINCT FROM OLD.external_id
       AND NEW.padelapi_id IS NOT DISTINCT FROM OLD.padelapi_id THEN
      NEW.padelapi_id := NEW.external_id;
    END IF;
    -- If both changed (unusual), trust the caller and do nothing.
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS players_sync_ids ON players;
CREATE TRIGGER players_sync_ids
  BEFORE INSERT OR UPDATE ON players
  FOR EACH ROW
  EXECUTE FUNCTION sync_players_id_columns();

COMMENT ON COLUMN players.padelapi_id IS 'padelapi.org player ID (primary identity source)';
COMMENT ON COLUMN players.fip_id      IS 'FIP official player ID (format: fip-PNNNNNN)';

-- ═══════════════════════════════════════════════════════════════════════
-- TOURNAMENTS
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS padelapi_id TEXT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS fip_id      TEXT;

-- Backfill padelapi_id from external_id, but ONLY for padelapi-sourced rows.
-- (FIP-sourced rows have external_id like "fip-fip-gold-..." which is not a
--  valid padelapi identifier — their canonical FIP id is the fip_slug.)
UPDATE tournaments
   SET padelapi_id = external_id
 WHERE padelapi_id IS NULL
   AND external_id IS NOT NULL
   AND (source = 'padelapi' OR source IS NULL);

-- Backfill fip_id from fip_slug (the clean slug, not the double-prefixed
-- external_id on fip-sourced rows).
UPDATE tournaments
   SET fip_id = fip_slug
 WHERE fip_id IS NULL
   AND fip_slug IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tournaments_padelapi_id_key
  ON tournaments(padelapi_id)
  WHERE padelapi_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tournaments_fip_id_key
  ON tournaments(fip_id)
  WHERE fip_id IS NOT NULL;

CREATE OR REPLACE FUNCTION sync_tournaments_id_columns() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- padelapi_id ↔ external_id (only for padelapi-sourced rows, so FIP slugs
    -- don't leak into the padelapi_id column)
    IF NEW.source = 'padelapi' OR NEW.source IS NULL THEN
      IF NEW.padelapi_id IS NULL THEN NEW.padelapi_id := NEW.external_id; END IF;
      IF NEW.external_id IS NULL THEN NEW.external_id := NEW.padelapi_id; END IF;
    END IF;
    -- fip_id ↔ fip_slug (unconditional — same concept, new name)
    IF NEW.fip_id IS NULL   THEN NEW.fip_id   := NEW.fip_slug; END IF;
    IF NEW.fip_slug IS NULL THEN NEW.fip_slug := NEW.fip_id;   END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- padelapi_id ↔ external_id propagation
    IF NEW.source = 'padelapi' OR NEW.source IS NULL THEN
      IF NEW.padelapi_id IS DISTINCT FROM OLD.padelapi_id
         AND NEW.external_id IS NOT DISTINCT FROM OLD.external_id THEN
        NEW.external_id := NEW.padelapi_id;
      ELSIF NEW.external_id IS DISTINCT FROM OLD.external_id
         AND NEW.padelapi_id IS NOT DISTINCT FROM OLD.padelapi_id THEN
        NEW.padelapi_id := NEW.external_id;
      END IF;
    END IF;
    -- fip_id ↔ fip_slug propagation
    IF NEW.fip_id IS DISTINCT FROM OLD.fip_id
       AND NEW.fip_slug IS NOT DISTINCT FROM OLD.fip_slug THEN
      NEW.fip_slug := NEW.fip_id;
    ELSIF NEW.fip_slug IS DISTINCT FROM OLD.fip_slug
       AND NEW.fip_id IS NOT DISTINCT FROM OLD.fip_id THEN
      NEW.fip_id := NEW.fip_slug;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tournaments_sync_ids ON tournaments;
CREATE TRIGGER tournaments_sync_ids
  BEFORE INSERT OR UPDATE ON tournaments
  FOR EACH ROW
  EXECUTE FUNCTION sync_tournaments_id_columns();

COMMENT ON COLUMN tournaments.padelapi_id IS 'padelapi.org tournament ID (primary source for schedule, matches, live scores)';
COMMENT ON COLUMN tournaments.fip_id      IS 'FIP tournament slug (primary source for logo, metadata, draw PDFs)';

-- ═══════════════════════════════════════════════════════════════════════
-- MATCHES
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE matches ADD COLUMN IF NOT EXISTS padelapi_id TEXT;

UPDATE matches
   SET padelapi_id = external_id
 WHERE padelapi_id IS NULL
   AND external_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS matches_padelapi_id_key
  ON matches(padelapi_id)
  WHERE padelapi_id IS NOT NULL;

CREATE OR REPLACE FUNCTION sync_matches_id_columns() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.padelapi_id IS NULL THEN NEW.padelapi_id := NEW.external_id; END IF;
    IF NEW.external_id IS NULL THEN NEW.external_id := NEW.padelapi_id; END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.padelapi_id IS DISTINCT FROM OLD.padelapi_id
       AND NEW.external_id IS NOT DISTINCT FROM OLD.external_id THEN
      NEW.external_id := NEW.padelapi_id;
    ELSIF NEW.external_id IS DISTINCT FROM OLD.external_id
       AND NEW.padelapi_id IS NOT DISTINCT FROM OLD.padelapi_id THEN
      NEW.padelapi_id := NEW.external_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS matches_sync_ids ON matches;
CREATE TRIGGER matches_sync_ids
  BEFORE INSERT OR UPDATE ON matches
  FOR EACH ROW
  EXECUTE FUNCTION sync_matches_id_columns();

COMMENT ON COLUMN matches.padelapi_id IS 'padelapi.org match ID';

COMMIT;

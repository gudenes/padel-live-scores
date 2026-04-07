-- Where-to-watch: broadcaster data + user country override
--
-- Sourced from premierpadel.com's two public endpoints:
--   /premierpadel/api/beforeauth/getwheretowatchinfo
--     → 2 editorial cards explaining global coverage tiers
--       (YouTube for R1-R3, Red Bull TV for QF→F)
--   /premierpadel/api/beforeauth/getwheretowatch
--     → ~770 (broadcaster × country) pairs for regional listings
--       (Sky Sport IT, Movistar+ ES, Canal+ FR, ESPN US, etc.)
--
-- Synced weekly via /api/cron/sync-broadcasters. The data is global
-- to all Premier Padel events (the Premier API doesn't break it down
-- per tournament), so the same lists apply to every Premier-tier
-- tournament in our DB.
--
-- profiles.preferred_country lets users override the geo-IP detection
-- for region-specific content. NULL = use geo cookie.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════
-- broadcast_info — global editorial cards
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS broadcast_info (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source          TEXT NOT NULL DEFAULT 'premier_padel_api',
  external_id     INT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  url             TEXT NOT NULL,
  logo_url        TEXT,
  display_order   INT NOT NULL DEFAULT 100,
  active          BOOLEAN NOT NULL DEFAULT true,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT broadcast_info_source_external_uk UNIQUE (source, external_id)
);

CREATE INDEX IF NOT EXISTS broadcast_info_active_idx
  ON broadcast_info (display_order)
  WHERE active;

COMMENT ON TABLE broadcast_info IS 'Editorial cards explaining global Premier Padel coverage tiers (e.g. YouTube for early rounds, Red Bull TV for finals)';

-- ═══════════════════════════════════════════════════════════════════════
-- broadcasters — country-specific broadcaster listings
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS broadcasters (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source          TEXT NOT NULL DEFAULT 'premier_padel_api',
  external_id     INT NOT NULL,
  country_iso2    TEXT NOT NULL,
  country_name    TEXT,
  name            TEXT NOT NULL,
  url             TEXT NOT NULL,
  logo_url        TEXT,
  is_free         BOOLEAN NOT NULL DEFAULT false,
  display_order   INT NOT NULL DEFAULT 100,
  active          BOOLEAN NOT NULL DEFAULT true,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT broadcasters_source_external_country_uk
    UNIQUE (source, external_id, country_iso2)
);

CREATE INDEX IF NOT EXISTS broadcasters_country_idx
  ON broadcasters (country_iso2)
  WHERE active;

CREATE INDEX IF NOT EXISTS broadcasters_active_idx
  ON broadcasters (active);

COMMENT ON TABLE broadcasters IS 'Per-country broadcaster listings for Premier Padel events. Synced weekly from premierpadel.com API. ~770 rows total.';
COMMENT ON COLUMN broadcasters.country_iso2 IS '2-letter ISO country code (lowercase). Extracted from the API flag URL.';
COMMENT ON COLUMN broadcasters.is_free IS 'true for Red Bull TV / YouTube, false for paid broadcasters';

-- ═══════════════════════════════════════════════════════════════════════
-- profiles.preferred_country — user override for region-specific content
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS preferred_country TEXT;

COMMENT ON COLUMN profiles.preferred_country IS '2-letter ISO country code, manually set by user. Overrides geo-IP detection for region-specific content like broadcaster lists. NULL = use auto-detection.';

COMMIT;

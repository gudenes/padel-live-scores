-- supabase/migrations/20260508_road_to_olympics_soft_launch.sql
-- Soft Launch tables for /road-to-olympics:
--   road_to_olympics_pledges     — one row per fan signing the open letter
--   road_to_olympics_subscribers — IOC-alert newsletter list (separate so non-pledgers can subscribe)
--
-- The full tracker-state table and AI patch-proposals table land in the
-- Hardening Wave migration. Counters live in src/data/road-to-olympics/state.json
-- during Soft Launch.

CREATE TABLE IF NOT EXISTS road_to_olympics_pledges (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  email         TEXT,                          -- nullable for anon pledges
  display_name  TEXT,                          -- optional public-display name
  country       TEXT,                          -- ISO-2, optional
  subscribed    BOOLEAN NOT NULL DEFAULT false,-- newsletter opt-in at pledge time
  source        TEXT,                          -- 'hub' | 'social' | 'share-kit'
  ip_hash       TEXT,                          -- abuse mitigation (sha256 of ip+secret)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rto_pledges_email
  ON road_to_olympics_pledges (email)
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rto_pledges_created_at
  ON road_to_olympics_pledges (created_at DESC);

CREATE TABLE IF NOT EXISTS road_to_olympics_subscribers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL UNIQUE,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  locale          TEXT NOT NULL DEFAULT 'en'
                  CHECK (locale IN ('en','es','pt','it','fr')),
  confirm_token   TEXT,                        -- opaque token, valid until confirmed_at
  confirmed_at    TIMESTAMPTZ,                 -- NULL until double-opt-in completes
  unsubscribed_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rto_subs_confirmed
  ON road_to_olympics_subscribers (confirmed_at)
  WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL;

COMMENT ON TABLE road_to_olympics_pledges IS
  'Fans signing the open-letter pledge for padel''s Olympic inclusion. One row per pledge.';
COMMENT ON TABLE road_to_olympics_subscribers IS
  'Newsletter list for IOC-alert blasts. Double-opt-in via confirm_token.';

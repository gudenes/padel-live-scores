-- feature_flags — generic on/off switches the ops dashboard can flip
-- without a deploy. Read by client code through Supabase's anon-key
-- SELECT (public RLS); writes are restricted to the service role
-- (ops API routes use the service role).
--
-- First user: home_live_tournaments_carousel. Future flags (alpha
-- features, killswitches for new surfaces) add rows here.

BEGIN;

CREATE TABLE IF NOT EXISTS feature_flags (
  key         TEXT PRIMARY KEY,
  enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  label       TEXT NOT NULL,
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT
);

COMMENT ON TABLE feature_flags IS 'Ops-controlled feature toggles. Public-read RLS, service-role writes.';
COMMENT ON COLUMN feature_flags.key IS 'Stable lower-snake-case identifier referenced in code (e.g. home_live_tournaments_carousel).';
COMMENT ON COLUMN feature_flags.label IS 'Human-readable name shown in the ops Feature Flags tab.';
COMMENT ON COLUMN feature_flags.description IS 'Optional one-liner explaining what the flag controls.';

-- Auto-bump updated_at on every UPDATE so the ops UI can show recency.
CREATE OR REPLACE FUNCTION feature_flags_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS feature_flags_updated_at_trigger ON feature_flags;
CREATE TRIGGER feature_flags_updated_at_trigger
  BEFORE UPDATE ON feature_flags
  FOR EACH ROW EXECUTE FUNCTION feature_flags_set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

-- Anyone (including anon) can read flag state. Necessary so the
-- public home page can decide whether to render the carousel without
-- an API round-trip.
CREATE POLICY feature_flags_public_read ON feature_flags
  FOR SELECT
  USING (true);

-- Writes are intentionally NOT allowed via RLS. The ops API routes
-- use the service-role key (which bypasses RLS) — keeping the policy
-- surface narrow.

-- ── Seed: carousel flag, default OFF ─────────────────────────
INSERT INTO feature_flags (key, enabled, label, description)
VALUES (
  'home_live_tournaments_carousel',
  FALSE,
  'Live Tournaments Carousel (Home)',
  'Top-of-page horizontal carousel showing live and upcoming tournaments with chunky cover-image cards. Section is hidden entirely when off.'
)
ON CONFLICT (key) DO NOTHING;

COMMIT;

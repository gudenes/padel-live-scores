-- tier_visibility — operator-controlled visibility of tournament tiers.
-- One row per tournaments.level. v1 has a single switch,
-- show_on_matches, which governs ONLY the public /matches day page
-- (list, day-pill dots, LIVE-pill gate). Every other surface ignores it.
-- A level with no row is shown. Public-read RLS, service-role writes —
-- same shape as feature_flags (20260520_feature_flags.sql).
-- Spec: docs/superpowers/specs/2026-09-27-tier-visibility-design.md

BEGIN;

CREATE TABLE IF NOT EXISTS tier_visibility (
  level            TEXT PRIMARY KEY,
  label            TEXT NOT NULL,
  show_on_matches  BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order       INT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       TEXT
);

COMMENT ON TABLE tier_visibility IS 'Ops-controlled per-tier visibility. Public-read RLS, service-role writes.';
COMMENT ON COLUMN tier_visibility.show_on_matches IS 'When false, matches of this tier are excluded from the public /matches page only.';

CREATE OR REPLACE FUNCTION tier_visibility_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tier_visibility_updated_at_trigger ON tier_visibility;
CREATE TRIGGER tier_visibility_updated_at_trigger
  BEFORE UPDATE ON tier_visibility
  FOR EACH ROW EXECUTE FUNCTION tier_visibility_set_updated_at();

ALTER TABLE tier_visibility ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tier_visibility_public_read ON tier_visibility;
CREATE POLICY tier_visibility_public_read ON tier_visibility
  FOR SELECT
  USING (true);

-- Seed: every level present in tournaments on 2026-10-03. Labels mirror
-- levelLabel(), sort_order mirrors levelTierWeight() (50 = unmapped).
-- Promises + Beyond start hidden, matching HIDDEN_TOURNAMENT_LEVELS.
INSERT INTO tier_visibility (level, label, show_on_matches, sort_order) VALUES
  ('finals',           'Finals',           TRUE,  0),
  ('major',            'Major',            TRUE,  1),
  ('p1',               'P1',               TRUE,  2),
  ('p2',               'P2',               TRUE,  3),
  ('fip_platinum',     'FIP Platinum',     TRUE,  4),
  ('fip_gold',         'FIP Gold',         TRUE,  5),
  ('fip_championship', 'FIP Championship', TRUE,  7),
  ('fip_finals',       'FIP Finals',       TRUE,  8),
  ('fip_silver',       'FIP Silver',       TRUE,  10),
  ('fip_bronze',       'FIP Bronze',       TRUE,  12),
  ('fip_promises',     'FIP Promises',     FALSE, 20),
  ('fip_beyond',       'FIP Beyond',       FALSE, 22),
  ('fip_other',        'FIP Tour',         TRUE,  25),
  ('ppl',              'PPL',              TRUE,  50),
  ('ppl_ii',           'PPL II',           TRUE,  50),
  ('wpt_final',        'WPT Final',        TRUE,  50),
  ('wpt_master',       'WPT Master',       TRUE,  50),
  ('wpt_1000',         'WPT 1000',         TRUE,  50),
  ('wpt_500',          'WPT 500',          TRUE,  50)
ON CONFLICT (level) DO NOTHING;

-- Per-level counts for the admin page. Service role only.
CREATE OR REPLACE FUNCTION tier_visibility_stats()
RETURNS TABLE (level TEXT, tournaments BIGINT, matches_90d BIGINT, live_now BIGINT)
LANGUAGE sql STABLE AS $$
  SELECT
    t.level,
    COUNT(DISTINCT t.id)                                                        AS tournaments,
    COUNT(m.id) FILTER (WHERE m.scheduled_at > now() - interval '90 days')      AS matches_90d,
    COUNT(m.id) FILTER (WHERE m.status IN ('live', 'on_court'))                 AS live_now
  FROM tournaments t
  LEFT JOIN matches m ON m.tournament_id = t.id
  WHERE t.level IS NOT NULL
  GROUP BY t.level
$$;

REVOKE ALL ON FUNCTION tier_visibility_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION tier_visibility_stats() TO service_role;

COMMIT;

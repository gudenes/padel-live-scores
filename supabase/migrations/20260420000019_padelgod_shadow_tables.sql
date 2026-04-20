-- Padelgod Shadow Mode: shadow tables + comparison results.
-- Writes come from Padelgod's LivePollerLoop when mode='shadow'.
-- shadow_diff is written by the shadow-diff-* workers.

CREATE TABLE IF NOT EXISTS padelgod.shadow_sets (
  match_id     UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  set_number   INT NOT NULL,
  set_score    TEXT,
  pair1_games  INT,
  pair2_games  INT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (match_id, set_number)
);

CREATE INDEX IF NOT EXISTS idx_shadow_sets_match
  ON padelgod.shadow_sets (match_id);

CREATE TABLE IF NOT EXISTS padelgod.shadow_match_points (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id         UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  set_number       INT NOT NULL,
  game_number      INT NOT NULL,
  point_number     INT NOT NULL,
  winner_pair      INT NOT NULL CHECK (winner_pair IN (1, 2)),
  score_after      TEXT NOT NULL,
  server_team      INT CHECK (server_team IN (1, 2)),
  is_golden_point  BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (match_id, set_number, game_number, point_number)
);

CREATE INDEX IF NOT EXISTS idx_shadow_match_points_match
  ON padelgod.shadow_match_points (match_id);

CREATE TABLE IF NOT EXISTS padelgod.shadow_diff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id),
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  comparison_type TEXT NOT NULL CHECK (
    comparison_type IN ('final_state', 'live_latency', 'per_point_sequence')
  ),
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- final_state fields (NULL for other types)
  padelapi_winner_pair INT,
  padelgod_winner_pair INT,
  winner_match BOOLEAN,
  padelapi_final_score TEXT,
  padelgod_final_score TEXT,
  score_match BOOLEAN,

  -- live_latency fields (NULL for other types)
  padelapi_updated_at TIMESTAMPTZ,
  padelgod_updated_at TIMESTAMPTZ,
  latency_delta_ms INT,

  -- per_point_sequence fields (NULL for other types)
  padelapi_point_count INT,
  padelgod_point_count INT,
  point_sequence_match BOOLEAN,
  first_divergence_index INT,
  first_divergence_detail TEXT,

  -- shared
  divergence_reason TEXT
);

-- Enforce at-most-one final_state / per_point_sequence row per match.
-- live_latency rows accumulate; no uniqueness constraint.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_shadow_diff_final
  ON padelgod.shadow_diff (match_id)
  WHERE comparison_type = 'final_state';

CREATE UNIQUE INDEX IF NOT EXISTS uniq_shadow_diff_per_point
  ON padelgod.shadow_diff (match_id)
  WHERE comparison_type = 'per_point_sequence';

CREATE INDEX IF NOT EXISTS idx_shadow_diff_recent
  ON padelgod.shadow_diff (computed_at DESC);

CREATE INDEX IF NOT EXISTS idx_shadow_diff_by_tournament
  ON padelgod.shadow_diff (tournament_id, comparison_type, computed_at DESC);

-- Service role needs write access to padelgod schema tables.
-- (Mirrors migration 015 pattern for the padelgod schema GRANTs.)
GRANT ALL ON padelgod.shadow_sets TO service_role;
GRANT ALL ON padelgod.shadow_match_points TO service_role;
GRANT ALL ON padelgod.shadow_diff TO service_role;

DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='padelgod' AND table_name='shadow_sets'), 'shadow_sets missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='padelgod' AND table_name='shadow_match_points'), 'shadow_match_points missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='padelgod' AND table_name='shadow_diff'), 'shadow_diff missing';
END $$;

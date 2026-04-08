-- 20260409_match_stats.sql
-- Sidecar: per-match and per-set aggregate statistics, sourced from premierpadel.com.
-- Composite PK: (match_id, set_number) where set_number = 0 is the full-match
-- aggregate and 1..5 are individual sets.

CREATE TABLE IF NOT EXISTS public.match_stats (
  match_id    UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  set_number  SMALLINT NOT NULL CHECK (set_number BETWEEN 0 AND 5),
  PRIMARY KEY (match_id, set_number),

  -- Service stats (per team)
  team1_first_serve_won       INT,
  team1_first_serve_played    INT,
  team1_second_serve_won      INT,
  team1_second_serve_played   INT,
  team1_service_games         INT,
  team2_first_serve_won       INT,
  team2_first_serve_played    INT,
  team2_second_serve_won      INT,
  team2_second_serve_played   INT,
  team2_service_games         INT,

  -- Return stats (per team)
  team1_first_return_won      INT,
  team1_first_return_played   INT,
  team1_second_return_won     INT,
  team1_second_return_played  INT,
  team1_return_games          INT,
  team2_first_return_won      INT,
  team2_first_return_played   INT,
  team2_second_return_won     INT,
  team2_second_return_played  INT,
  team2_return_games          INT,

  -- Total points (ONLY populated on set_number = 0)
  team1_total_points_won      INT,
  team1_total_points_played   INT,
  team1_serve_points_won      INT,
  team1_serve_points_played   INT,
  team1_return_points_won     INT,
  team1_return_points_played  INT,
  team1_longest_streak        INT,
  team2_total_points_won      INT,
  team2_total_points_played   INT,
  team2_serve_points_won      INT,
  team2_serve_points_played   INT,
  team2_return_points_won     INT,
  team2_return_points_played  INT,
  team2_longest_streak        INT,

  -- Provenance
  source            TEXT NOT NULL DEFAULT 'premierpadel',
  source_match_id   TEXT NOT NULL,
  raw_payload       JSONB,
  computed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_match_stats_computed_at
  ON public.match_stats (computed_at DESC);

CREATE INDEX IF NOT EXISTS idx_match_stats_source_match_id
  ON public.match_stats (source, source_match_id);

ALTER TABLE public.match_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read match_stats"
  ON public.match_stats FOR SELECT
  USING (true);

CREATE POLICY "Service role full access to match_stats"
  ON public.match_stats FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

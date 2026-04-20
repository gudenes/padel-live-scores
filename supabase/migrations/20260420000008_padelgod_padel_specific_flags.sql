-- Padelgod foundation: padel-specific game/point flags.

ALTER TABLE public.games
  ADD COLUMN is_tiebreak BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN public.games.is_tiebreak IS
  'True when this game is a tiebreak (e.g., the 13th game at 6-6).';

ALTER TABLE public.tournaments
  ADD COLUMN uses_golden_point BOOLEAN;
COMMENT ON COLUMN public.tournaments.uses_golden_point IS
  'NULL=unknown, true=tournament replaces deuce with sudden-death point, false=traditional deuce.';

ALTER TABLE public.match_points
  ADD COLUMN is_golden_point BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN public.match_points.is_golden_point IS
  'True when this point was a sudden-death decider; only meaningful when tournament.uses_golden_point=true.';

-- Verification
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='games' AND column_name='is_tiebreak'),
    'games.is_tiebreak missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='tournaments' AND column_name='uses_golden_point'),
    'tournaments.uses_golden_point missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='match_points' AND column_name='is_golden_point'),
    'match_points.is_golden_point missing';
END $$;

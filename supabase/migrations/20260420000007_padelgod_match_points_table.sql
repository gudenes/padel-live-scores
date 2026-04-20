-- Padelgod foundation: per-point structured data table (the table we never had).
-- Padelgod live-poller writes one row per detected point during live polling.
-- For matches scraped retroactively, server_player_id is NULL.

CREATE TABLE public.match_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id TEXT UNIQUE NOT NULL DEFAULT public.public_id('pnt'),
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  set_id   UUID NOT NULL REFERENCES public.sets(id)    ON DELETE CASCADE,
  game_id  UUID NOT NULL REFERENCES public.games(id)   ON DELETE CASCADE,
  point_number INT NOT NULL,
  server_player_id UUID REFERENCES public.players(id),
  winner_pair INT NOT NULL CHECK (winner_pair IN (1, 2)),
  score_after TEXT NOT NULL,
  is_break_point BOOLEAN NOT NULL DEFAULT false,
  is_set_point   BOOLEAN NOT NULL DEFAULT false,
  is_match_point  BOOLEAN NOT NULL DEFAULT false,
  source TEXT NOT NULL DEFAULT 'padelgod' CHECK (source IN ('padelgod', 'padelapi', 'inferred')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (game_id, point_number)
);

CREATE INDEX idx_match_points_match  ON public.match_points(match_id);
CREATE INDEX idx_match_points_server ON public.match_points(server_player_id);
CREATE INDEX idx_match_points_recent ON public.match_points(created_at DESC);

CREATE TRIGGER trg_match_points_updated_at
  BEFORE UPDATE ON public.match_points
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.match_points IS
  'Per-point structured data, populated by Padelgod live-poller. server_player_id NULL for retroactive imports.';

-- Verification
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='match_points'),
    'match_points table missing';
  ASSERT EXISTS (SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='match_points' AND indexname='idx_match_points_match'),
    'idx_match_points_match index missing';
END $$;

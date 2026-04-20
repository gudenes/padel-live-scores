-- Padelgod foundation: sets + games get public_id + timestamps; games gets server_player_id.

-- sets
ALTER TABLE public.sets
  ADD COLUMN public_id TEXT DEFAULT public.public_id('set');

ALTER TABLE public.sets
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.sets
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DROP TRIGGER IF EXISTS trg_sets_updated_at ON public.sets;
CREATE TRIGGER trg_sets_updated_at
  BEFORE UPDATE ON public.sets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- games
ALTER TABLE public.games
  ADD COLUMN public_id TEXT DEFAULT public.public_id('gam');

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DROP TRIGGER IF EXISTS trg_games_updated_at ON public.games;
CREATE TRIGGER trg_games_updated_at
  BEFORE UPDATE ON public.games
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Per-game server (rotates each game in padel)
ALTER TABLE public.games
  ADD COLUMN server_player_id UUID REFERENCES public.players(id);
COMMENT ON COLUMN public.games.server_player_id IS
  'Player who served this entire game (server alternates each game in padel).';

-- Verification
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='sets' AND column_name='public_id'),
    'sets.public_id missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='games' AND column_name='public_id'),
    'games.public_id missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='games' AND column_name='server_player_id'),
    'games.server_player_id missing';
END $$;

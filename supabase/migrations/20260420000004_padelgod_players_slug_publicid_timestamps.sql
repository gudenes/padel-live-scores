-- Padelgod foundation: players gets public_id, slug, updated_at.

ALTER TABLE public.players
  ADD COLUMN public_id TEXT DEFAULT public.public_id('plr');

ALTER TABLE public.players
  ADD COLUMN slug TEXT;
-- (slug computed from name in backfill, Task 18; UNIQUE applied there)

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DROP TRIGGER IF EXISTS trg_players_updated_at ON public.players;
CREATE TRIGGER trg_players_updated_at
  BEFORE UPDATE ON public.players
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Verification
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='players' AND column_name='public_id'),
    'players.public_id missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='players' AND column_name='slug'),
    'players.slug missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='players' AND column_name='created_at'),
    'players.created_at missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='players' AND column_name='updated_at'),
    'players.updated_at missing';
END $$;

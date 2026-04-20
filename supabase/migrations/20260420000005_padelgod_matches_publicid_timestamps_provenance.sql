-- Padelgod foundation: matches gets public_id, timestamps, provenance + migration feature flag fields.

ALTER TABLE public.matches
  ADD COLUMN public_id TEXT DEFAULT public.public_id('mat');

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Coarse provenance (which writer last touched the row)
ALTER TABLE public.matches
  ADD COLUMN last_updated_by TEXT;
COMMENT ON COLUMN public.matches.last_updated_by IS
  'Source of the most recent UPDATE: padelapi | padelgod | manual';

DROP TRIGGER IF EXISTS trg_matches_updated_at ON public.matches;
CREATE TRIGGER trg_matches_updated_at
  BEFORE UPDATE ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Per-tournament migration cutover flag — added on tournaments here for locality
ALTER TABLE public.tournaments
  ADD COLUMN live_source TEXT NOT NULL DEFAULT 'padelapi'
  CHECK (live_source IN ('padelapi', 'padelgod'));
COMMENT ON COLUMN public.tournaments.live_source IS
  'Migration feature flag: which source owns live data for this tournament.';

-- Verification
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='matches' AND column_name='public_id'),
    'matches.public_id missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='matches' AND column_name='last_updated_by'),
    'matches.last_updated_by missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='tournaments' AND column_name='live_source'),
    'tournaments.live_source missing';
END $$;

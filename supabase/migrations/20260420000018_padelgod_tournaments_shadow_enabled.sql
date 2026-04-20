-- Padelgod Shadow Mode: enrollment flag on tournaments.
-- Orthogonal to live_source. true = Padelgod runs a shadow LivePollerLoop in parallel
-- with the padelapi relay, writing to padelgod.shadow_* tables.
-- Set by the ops dashboard "Enroll in shadow" button.

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS shadow_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_tournaments_shadow_enabled
  ON public.tournaments(shadow_enabled) WHERE shadow_enabled = true;

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='tournaments' AND column_name='shadow_enabled'
  ), 'shadow_enabled column missing';
END $$;

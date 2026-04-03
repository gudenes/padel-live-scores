-- supabase/migrations/20260403_tournament_source.sql
-- Tournament source tracking: 'api' (real) vs 'simulated' (test data)
-- Simulated tournaments + all cascading data can be purged with:
--   DELETE FROM tournaments WHERE source = 'simulated'

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'api'
  CHECK (source IN ('api', 'simulated'));

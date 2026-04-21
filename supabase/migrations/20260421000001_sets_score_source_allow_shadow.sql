-- Allow 'shadow' on public.sets.score_source, used by /api/cron/shadow-sync
-- to mark sets bridged from padelgod when the padelapi /live feed is dark.
-- Priority (top wins): api > live > shadow > inferred.

ALTER TABLE public.sets DROP CONSTRAINT IF EXISTS sets_score_source_check;

ALTER TABLE public.sets
  ADD CONSTRAINT sets_score_source_check
  CHECK (score_source IS NULL OR score_source IN ('api','inferred','live','fip','shadow'));

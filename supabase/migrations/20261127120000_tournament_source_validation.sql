-- Reversible public quarantine, independent of destructive orphan cleanup.
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS source_suppressed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_validation jsonb;

CREATE TABLE IF NOT EXISTS public.tournament_source_audits (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id uuid NOT NULL,
  tournament_id uuid REFERENCES public.tournaments(id) ON DELETE SET NULL,
  checked_at timestamptz NOT NULL,
  evidence jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS tournament_source_audits_run_idx
  ON public.tournament_source_audits(run_id);
ALTER TABLE public.tournament_source_audits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tournament_source_audits FROM anon, authenticated;
GRANT ALL ON public.tournament_source_audits TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.tournament_source_audits_id_seq TO service_role;

-- Restrictive policy composes with existing permissive public read policies.
ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Hide source-suppressed tournaments" ON public.tournaments;
CREATE POLICY "Hide source-suppressed tournaments" ON public.tournaments
  AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (NOT source_suppressed);

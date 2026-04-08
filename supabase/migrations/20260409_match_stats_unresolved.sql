-- 20260409_match_stats_unresolved.sql
-- Queue for tournaments/matches that the auto-resolver couldn't link.
-- Resolved manually via Supabase SQL editor (see spec for exact queries).

CREATE TABLE IF NOT EXISTS public.match_stats_unresolved (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source                 TEXT NOT NULL,
  source_kind            TEXT NOT NULL CHECK (source_kind IN ('tournament', 'match')),
  source_id              TEXT NOT NULL,
  source_payload         JSONB,
  candidate_count        INT NOT NULL DEFAULT 0,
  reason                 TEXT,
  resolved_at            TIMESTAMPTZ,
  resolved_match_id      UUID REFERENCES public.matches(id) ON DELETE SET NULL,
  resolved_tournament_id UUID REFERENCES public.tournaments(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, source_kind, source_id)
);

CREATE INDEX IF NOT EXISTS idx_match_stats_unresolved_pending
  ON public.match_stats_unresolved (source, source_kind)
  WHERE resolved_at IS NULL;

ALTER TABLE public.match_stats_unresolved ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to match_stats_unresolved"
  ON public.match_stats_unresolved FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Padelgod Plan 4: RPC that returns tournaments eligible for live polling.
-- Used by live-poller-manager to decide which tournaments need LivePollerLoop instances.
-- Gate: tournaments.live_source='padelgod' (per-tournament cutover flag, default 'padelapi').

CREATE OR REPLACE FUNCTION public.padelgod_tournaments_for_live_polling()
RETURNS TABLE (
  tournament_id UUID,
  tournament_name TEXT,
  widget_id TEXT,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ
) AS $$
  SELECT t.id, t.name, c.widget_id, t.starts_at, t.ends_at
  FROM public.tournaments t
  INNER JOIN padelgod.widget_id_cache c
    ON c.tournament_id = t.id AND c.is_active = true
  WHERE t.live_source = 'padelgod'
    AND COALESCE(t.ends_at, t.starts_at + INTERVAL '14 days') >= NOW() - INTERVAL '1 day'
    AND COALESCE(t.starts_at, NOW() - INTERVAL '7 days') <= NOW() + INTERVAL '1 day'
  ORDER BY t.starts_at ASC NULLS LAST;
$$ LANGUAGE sql STABLE;

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='padelgod_tournaments_for_live_polling'
  ), 'function missing';
END $$;

-- Padelgod Plan 3: helper functions for selecting tournaments to scrape per worker.

-- Tournaments with an active widget code AND in their date window (or close to it).
-- Used by entry-list / draw / oop / results workers.
CREATE OR REPLACE FUNCTION public.padelgod_active_tournaments_for_static_workers()
RETURNS TABLE (
  tournament_id UUID,
  tournament_name TEXT,
  widget_id TEXT,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  expected_days INT
) AS $$
  SELECT
    t.id AS tournament_id,
    t.name AS tournament_name,
    c.widget_id,
    t.starts_at,
    t.ends_at,
    GREATEST(
      1,
      CASE
        WHEN t.starts_at IS NOT NULL AND t.ends_at IS NOT NULL
          THEN EXTRACT(DAY FROM (t.ends_at - t.starts_at))::INT + 1
        ELSE 7
      END
    ) AS expected_days
  FROM public.tournaments t
  INNER JOIN padelgod.widget_id_cache c
    ON c.tournament_id = t.id AND c.is_active = true
  WHERE
    -- tournament is currently happening OR within ±7 days of its window
    (
      t.starts_at IS NULL  -- no dates: assume active, fetch defensively
      OR (t.starts_at <= NOW() + INTERVAL '7 days' AND COALESCE(t.ends_at, t.starts_at + INTERVAL '14 days') >= NOW() - INTERVAL '7 days')
    )
  ORDER BY t.starts_at ASC NULLS LAST
  LIMIT 50;
$$ LANGUAGE sql STABLE;

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'padelgod_active_tournaments_for_static_workers'
  ), 'function missing';
END $$;

-- supabase/migrations/20260603000004_padelgod_active_tournaments_id_override.sql
--
-- Add an optional p_only_ids override to the two active-tournament RPCs so a
-- targeted on-demand refresh can fetch a tournament OUTSIDE the ±7-day window.
-- When p_only_ids is NULL (scheduled runs, no-arg calls) the original window
-- applies unchanged. Entity requirements are kept: _for_static_workers still
-- requires an active Crionet widget; _with_slug still requires a slug.
--
-- The old 0-arg signatures are dropped first so the new DEFAULT-NULL single-arg
-- versions fully replace them (no overload ambiguity).

DROP FUNCTION IF EXISTS public.padelgod_active_tournaments_for_static_workers();
DROP FUNCTION IF EXISTS public.padelgod_active_tournaments_with_slug();

CREATE OR REPLACE FUNCTION public.padelgod_active_tournaments_for_static_workers(
  p_only_ids uuid[] DEFAULT NULL
)
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
  WHERE (
    (p_only_ids IS NOT NULL AND t.id = ANY(p_only_ids))
    OR (p_only_ids IS NULL AND (
      t.starts_at IS NULL
      OR (t.starts_at <= NOW() + INTERVAL '7 days'
          AND COALESCE(t.ends_at, t.starts_at + INTERVAL '14 days') >= NOW() - INTERVAL '7 days')
    ))
  )
  ORDER BY t.starts_at ASC NULLS LAST
  LIMIT 50;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION public.padelgod_active_tournaments_with_slug(
  p_only_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  tournament_id UUID,
  tournament_name TEXT,
  slug TEXT,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ
) AS $$
  SELECT
    t.id AS tournament_id,
    t.name AS tournament_name,
    t.slug,
    t.starts_at,
    t.ends_at
  FROM public.tournaments t
  WHERE t.slug IS NOT NULL
    AND (
      (p_only_ids IS NOT NULL AND t.id = ANY(p_only_ids))
      OR (p_only_ids IS NULL AND (
        t.starts_at IS NULL
        OR (t.starts_at <= NOW() + INTERVAL '7 days'
            AND COALESCE(t.ends_at, t.starts_at + INTERVAL '14 days') >= NOW() - INTERVAL '7 days')
      ))
    )
  ORDER BY t.starts_at ASC NULLS LAST
  LIMIT 50;
$$ LANGUAGE sql STABLE;

DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='padelgod_active_tournaments_for_static_workers'), 'static fn missing';
  ASSERT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='padelgod_active_tournaments_with_slug'), 'slug fn missing';
END $$;

NOTIFY pgrst, 'reload schema';

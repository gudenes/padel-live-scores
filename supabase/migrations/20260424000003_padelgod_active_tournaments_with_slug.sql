-- Helper for the FIP draw fetcher: same active-window logic as
-- `padelgod_active_tournaments_for_static_workers`, but returns
-- `tournaments.slug` instead of the Crionet `widget_id`.
--
-- The FIP draw fetcher doesn't need Crionet widget codes — it builds
-- URLs like https://www.padelfip.com/es/events/{slug}/?tab=Cuadros
-- and reads them via the padelfip.com WordPress AJAX endpoint.
--
-- NOTE: this does NOT require a widget_id_cache row, because a tournament
-- can have a FIP event page without a Crionet widget code (and we may
-- want the draw even before the widget code is discovered). The only
-- requirement is that `slug` is set.

CREATE OR REPLACE FUNCTION public.padelgod_active_tournaments_with_slug()
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
  WHERE
    t.slug IS NOT NULL
    AND (
      t.starts_at IS NULL  -- no dates: assume active, fetch defensively
      OR (
        t.starts_at <= NOW() + INTERVAL '7 days'
        AND COALESCE(t.ends_at, t.starts_at + INTERVAL '14 days') >= NOW() - INTERVAL '7 days'
      )
    )
  ORDER BY t.starts_at ASC NULLS LAST
  LIMIT 50;
$$ LANGUAGE sql STABLE;

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'padelgod_active_tournaments_with_slug'
  ), 'function padelgod_active_tournaments_with_slug missing';
END $$;

-- Helper function: list FIP-sourced tournaments that don't have a widget code yet.
CREATE OR REPLACE FUNCTION public.padelgod_tournaments_needing_widget_code()
RETURNS TABLE (
  tournament_id UUID,
  tournament_name TEXT,
  year INT
) AS $$
  SELECT
    t.id AS tournament_id,
    t.name AS tournament_name,
    EXTRACT(YEAR FROM COALESCE(t.starts_at, NOW()))::INT AS year
  FROM public.tournaments t
  LEFT JOIN padelgod.widget_id_cache c ON c.tournament_id = t.id
  WHERE c.tournament_id IS NULL
    AND t.slug IS NOT NULL
    AND t.source = 'fip'
  ORDER BY t.starts_at DESC NULLS LAST
  LIMIT 200;
$$ LANGUAGE sql STABLE;

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'padelgod_tournaments_needing_widget_code'
  ), 'function missing';
END $$;

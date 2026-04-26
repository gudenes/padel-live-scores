-- Stops widget-code-lookup from spinning forever on FIP tournaments
-- that aren't on Crionet (mostly fip_other / Bronze / Silver tier).
--
-- Audit on 2026-04-27 found ~100 tournaments with 150+ "successful"
-- widget-lookup attempts each — search runs cleanly, parser returns
-- zero candidates, no row ever lands in widget_id_cache, and the
-- worker retries every hour forever. Pure waste: ~15K Crionet hits
-- spent re-confirming "not on Crionet."
--
-- Two gates added to padelgod_tournaments_needing_widget_code():
--
--   1. Time gate — skip tournaments that ended more than 14 days
--      ago. By that point Crionet has either indexed it or never
--      will; revisiting after the event is over costs an HTTP request
--      and resolves nothing operators care about.
--
--   2. Attempt circuit breaker — skip tournaments with ≥12 attempts
--      in the last 7 days. Hourly cron × ~half-day of trying is plenty
--      to confirm a tournament is unfindable. The 7-day rolling window
--      means any tournament that *does* eventually get indexed by
--      Crionet (e.g., late entry-list publish) becomes eligible again
--      naturally, no manual intervention required.
--
-- Threshold picked by the data: the unresolved set runs ~10 attempts/day
-- (matches hourly cron). 12 attempts ≈ 12 hours of futile retries before
-- backing off. Generous enough to absorb operator-day publishing, tight
-- enough to stop the bleed within a day.

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
  LEFT JOIN padelgod.widget_id_cache c
    ON c.tournament_id = t.id
  WHERE c.tournament_id IS NULL
    AND t.slug IS NOT NULL
    AND t.source = 'fip'
    -- Time gate: don't bother with tournaments that ended >14 days ago
    AND COALESCE(
          t.ends_at,
          t.starts_at + INTERVAL '7 days',
          NOW()
        ) >= NOW() - INTERVAL '14 days'
    -- Circuit breaker: skip if 12+ attempts already in last 7 days
    AND (
      SELECT COUNT(*)
      FROM padelgod.scrape_jobs s
      WHERE s.tournament_id = t.id
        AND s.job_type = 'widget_id'
        AND s.started_at >= NOW() - INTERVAL '7 days'
    ) < 12
  ORDER BY t.starts_at DESC NULLS LAST
  LIMIT 200;
$$ LANGUAGE sql STABLE;

-- Verification: function still exists and signature unchanged.
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'padelgod_tournaments_needing_widget_code'
  ), 'function padelgod_tournaments_needing_widget_code missing';
END $$;

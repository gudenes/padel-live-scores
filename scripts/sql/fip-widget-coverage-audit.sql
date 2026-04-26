-- FIP widget-id coverage audit.
--
-- Goal: find out whether widget-code-lookup is keeping up with FIP
-- tournaments by their start date. Run all three queries against
-- the production DB. Paste results to decide whether the existing
-- automation chain is enough or if we need an ops dashboard.

------------------------------------------------------------------
-- Q1. Imminent FIP tournaments WITHOUT widget_id
--     (fip_id set, starts within next 7 days, no active widget cache row)
------------------------------------------------------------------
SELECT
  t.id,
  t.name,
  t.level,
  t.fip_id,
  t.slug,
  t.starts_at::date AS starts_on,
  t.ends_at::date   AS ends_on,
  (t.starts_at::date - CURRENT_DATE)::int AS days_until_start
FROM public.tournaments t
LEFT JOIN padelgod.widget_id_cache w
  ON w.tournament_id = t.id AND w.is_active = true
WHERE t.fip_id IS NOT NULL
  AND t.starts_at IS NOT NULL
  AND t.starts_at::date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
  AND w.tournament_id IS NULL
ORDER BY t.starts_at ASC;

------------------------------------------------------------------
-- Q2. LIVE FIP tournaments WITHOUT widget_id
--     (today is between starts_at and ends_at, no active widget cache)
--     These are the urgent ones — already running with no automation
------------------------------------------------------------------
SELECT
  t.id,
  t.name,
  t.level,
  t.fip_id,
  t.slug,
  t.starts_at::date AS starts_on,
  t.ends_at::date   AS ends_on
FROM public.tournaments t
LEFT JOIN padelgod.widget_id_cache w
  ON w.tournament_id = t.id AND w.is_active = true
WHERE t.fip_id IS NOT NULL
  AND t.starts_at IS NOT NULL
  AND t.starts_at::date <= CURRENT_DATE
  AND COALESCE(t.ends_at::date, t.starts_at::date + 7) >= CURRENT_DATE
  AND w.tournament_id IS NULL
ORDER BY t.starts_at ASC;

------------------------------------------------------------------
-- Q3. widget-code-lookup attempt history (last 14 days)
--     Are searches happening and finding nothing? Or not happening?
--     Look for: status='success' but matched_widget_id null, or
--     repeated failures on the same tournament_id.
------------------------------------------------------------------
SELECT
  s.tournament_id,
  t.name AS tournament_name,
  t.starts_at::date AS starts_on,
  COUNT(*) FILTER (WHERE s.status = 'success') AS success_count,
  COUNT(*) FILTER (WHERE s.status = 'failed')  AS failure_count,
  MAX(s.started_at) AS last_attempt_at,
  -- whether widget got resolved eventually
  (w.tournament_id IS NOT NULL) AS resolved
FROM padelgod.scrape_jobs s
JOIN public.tournaments t ON t.id = s.tournament_id
LEFT JOIN padelgod.widget_id_cache w
  ON w.tournament_id = t.id AND w.is_active = true
WHERE s.job_type = 'widget_id'
  AND s.started_at >= NOW() - INTERVAL '14 days'
  AND t.fip_id IS NOT NULL
GROUP BY s.tournament_id, t.name, t.starts_at, w.tournament_id
ORDER BY resolved ASC, last_attempt_at DESC
LIMIT 100;

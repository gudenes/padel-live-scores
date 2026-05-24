-- supabase/migrations/20260524_refresh_source_quality_rpc.sql

CREATE OR REPLACE FUNCTION public.refresh_source_quality_pct() RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
  updated INT;
BEGIN
  WITH quality_30d AS (
    SELECT
      (metadata->>'source_key') AS source_key,
      100.0 * count(*) FILTER (WHERE metadata->>'last_fetch_status' = 'success') / count(*) AS pct,
      count(*) AS attempts
    FROM ops_events
    WHERE kind = 'news_source.fetch.health'
      AND created_at > now() - interval '30 days'
      AND metadata->>'source_key' IS NOT NULL
    GROUP BY metadata->>'source_key'
  )
  UPDATE news_sources s
  SET extraction_quality_pct = q.pct
  FROM quality_30d q
  WHERE s.key = q.source_key
    AND q.attempts >= 5;

  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated;
END $$;

REVOKE ALL ON FUNCTION public.refresh_source_quality_pct FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_source_quality_pct TO service_role;

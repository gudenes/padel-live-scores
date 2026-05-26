-- News pipeline: SQL function to refresh news_sources.articles_last_7d
-- Called by the daily /api/cron/refresh-source-volume route.
--
-- Aggregates articles inserted in the last 7 days by source_name and writes
-- the count back to news_sources.articles_last_7d. For dynamic sources where
-- the source_name pattern is "Google News · ..." per-entity, those will not
-- aggregate cleanly today — V2 should refactor articles to carry a source_key
-- FK for exact attribution.

BEGIN;

CREATE OR REPLACE FUNCTION refresh_news_sources_volume_7d(cutoff_ts TIMESTAMPTZ)
RETURNS void LANGUAGE sql AS $$
  UPDATE news_sources s
  SET articles_last_7d = COALESCE(c.cnt, 0)
  FROM (
    SELECT source_name AS name, COUNT(*) AS cnt
    FROM articles
    WHERE created_at >= cutoff_ts
    GROUP BY source_name
  ) c
  WHERE s.name = c.name;
$$;

COMMIT;

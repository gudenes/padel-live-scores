-- Rollout: apply this migration, configure PTPADEL_API_KEY on the Railway
-- padelnachos service, deploy the adapter, then enable the source in Ops or:
-- UPDATE news_sources SET enabled = true WHERE key = 'ptpadelportugal';
-- The existing Railway cron calls sync-articles at minute 40 of every hour.
BEGIN;

ALTER TABLE news_sources DROP CONSTRAINT IF EXISTS news_sources_source_type_check;
ALTER TABLE news_sources ADD CONSTRAINT news_sources_source_type_check
  CHECK (source_type IN ('rss', 'wp-api', 'google-news-search', 'ptpadel-api'));

ALTER TABLE articles ADD COLUMN IF NOT EXISTS source_body TEXT;

-- Enable only after deploying the adapter and setting PTPADEL_API_KEY.
-- Older deployments otherwise try to parse this JSON endpoint as RSS.
INSERT INTO news_sources (
  key, name, url, source_type, language, weight, lookback_days,
  cadence, query_kind, enabled, created_by, notes
) VALUES (
  'ptpadelportugal', 'PTPadel Portugal', 'https://ptpadelportugal.com/api/noticias.php',
  'ptpadel-api', 'pt', 1.2, 14, 'hourly', 'static', false, 'system',
  'Publisher API. Set PTPADEL_API_KEY on the server before enabling. Latest 10 articles, hourly.'
) ON CONFLICT (key) DO NOTHING;

COMMIT;

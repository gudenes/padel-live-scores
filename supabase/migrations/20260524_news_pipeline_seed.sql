BEGIN;

-- Feature flags
INSERT INTO feature_flags (key, enabled, enabled_local, label, description)
VALUES
  ('news_pipeline_enrichment', false, true,
    'News pipeline · Enrichment',
    'When ON: enrich-articles cron runs (Sonnet summary + entity tagging + Haiku translation). When OFF: ingest continues unenriched.'),
  ('foryou_enabled', false, true,
    'News · For You tab',
    'When ON: the "For You" immersive tab appears in /feed and becomes the default. Requires news_pipeline_enrichment=true to have content.')
ON CONFLICT (key) DO NOTHING;

-- Seed the 9 existing static sources from src/app/api/cron/sync-articles/route.ts
INSERT INTO news_sources (
  key, name, url, source_type, language, weight, lookback_days, cadence,
  query_kind, enabled, created_by, notes
) VALUES
  ('google-news-en',          'Google News',    'https://news.google.com/rss/search?q=padel+premier+padel&hl=en&gl=US&ceid=US:en',          'rss',    'en', 1.0, 14, 'hourly', 'static', true, 'system', 'Migrated from hard-coded SOURCES array'),
  ('google-news-es',          'Google News',    'https://news.google.com/rss/search?q=padel+premier+padel&hl=es&gl=ES&ceid=ES:es',          'rss',    'es', 1.0, 14, 'hourly', 'static', true, 'system', 'Migrated from hard-coded SOURCES array'),
  ('google-news-pt',          'Google News',    'https://news.google.com/rss/search?q=padel+premier+padel&hl=pt-PT&gl=PT&ceid=PT:pt-150',   'rss',    'pt', 1.0, 14, 'hourly', 'static', true, 'system', 'Migrated from hard-coded SOURCES array'),
  ('google-news-br',          'Google News',    'https://news.google.com/rss/search?q=padel+premier+padel&hl=pt-BR&gl=BR&ceid=BR:pt-419',   'rss',    'pt', 1.0, 14, 'hourly', 'static', true, 'system', 'Migrated from hard-coded SOURCES array'),
  ('google-news-olympics-en', 'Google News',    'https://news.google.com/rss/search?q=padel+olympic&hl=en-US&gl=US&ceid=US:en',             'rss',    'en', 1.0, 90, 'hourly', 'static', true, 'system', 'Migrated from hard-coded SOURCES array (Olympic track, 90d lookback)'),
  ('google-news-ioc-en',      'Google News',    'https://news.google.com/rss/search?q=padel+ioc&hl=en-US&gl=US&ceid=US:en',                  'rss',    'en', 1.0, 90, 'hourly', 'static', true, 'system', 'Migrated from hard-coded SOURCES array (IOC track, 90d lookback)'),
  ('padel-addict',            'Padel Addict',   'https://padeladdict.com/feed/',                                                              'rss',    'es', 1.2, 14, 'hourly', 'static', true, 'system', 'Migrated from hard-coded SOURCES array'),
  ('padel-magazine',          'Padel Magazine', 'https://padelmagazine.fr/feed/',                                                             'rss',    'fr', 1.2, 14, 'hourly', 'static', true, 'system', 'Migrated from hard-coded SOURCES array'),
  ('fip',                     'FIP',            'https://www.padelfip.com/wp-json/wp/v2/posts?per_page=15&_embed=wp:featuredmedia',          'wp-api', 'en', 1.5, 14, 'hourly', 'static', true, 'system', 'Migrated from hard-coded SOURCES array (WordPress REST API)')
ON CONFLICT (key) DO NOTHING;

COMMIT;

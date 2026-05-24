-- supabase/migrations/20260524_source_curation.sql
-- Source Curation Tools V2 — additive schema changes only.
-- - news_sources: + extraction_quality_pct (denormalized from ops_events) + auto_disabled_at (audit trail)
-- - news_source_suggestions: + submitted_by_kind (user vs ai_discovery) + detected_type + detected_payload (cached detector output)
-- Safe to drop on rollback.

ALTER TABLE public.news_sources
  ADD COLUMN IF NOT EXISTS extraction_quality_pct REAL,
  ADD COLUMN IF NOT EXISTS auto_disabled_at TIMESTAMPTZ;

COMMENT ON COLUMN public.news_sources.extraction_quality_pct IS
  '0..100 success rate over last 30 days of news_source.fetch.health ops_events. NULL when <5 fetches in window. Refreshed daily by refresh-source-volume cron.';
COMMENT ON COLUMN public.news_sources.auto_disabled_at IS
  'When the dead-source cron set enabled=false. NULL means operator-disabled (or never disabled). Used as a guard against re-disabling after operator re-enables.';

ALTER TABLE public.news_source_suggestions
  ADD COLUMN IF NOT EXISTS submitted_by_kind TEXT NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS detected_type TEXT,
  ADD COLUMN IF NOT EXISTS detected_payload JSONB DEFAULT '{}'::jsonb;

ALTER TABLE public.news_source_suggestions
  DROP CONSTRAINT IF EXISTS news_source_suggestions_submitted_by_kind_check;
ALTER TABLE public.news_source_suggestions
  ADD CONSTRAINT news_source_suggestions_submitted_by_kind_check
    CHECK (submitted_by_kind IN ('user', 'ai_discovery'));

ALTER TABLE public.news_source_suggestions
  DROP CONSTRAINT IF EXISTS news_source_suggestions_detected_type_check;
ALTER TABLE public.news_source_suggestions
  ADD CONSTRAINT news_source_suggestions_detected_type_check
    CHECK (detected_type IS NULL OR detected_type IN ('rss', 'wp-api', 'google-news-search', 'unknown'));

COMMENT ON COLUMN public.news_source_suggestions.submitted_by_kind IS
  'Discriminator for the unified suggestions queue. user = public submission. ai_discovery = candidate from Claude web-search batch.';
COMMENT ON COLUMN public.news_source_suggestions.detected_type IS
  'Cached source-detector output. Lets Suggestions tab render previews without re-fetching.';
COMMENT ON COLUMN public.news_source_suggestions.detected_payload IS
  'Cached { name, language, sample_articles[] } from detector. Used by Approve & Add to create news_sources row in one click.';

-- Indexed for the "AI runs / day" rate-limit query (count rows in 24h window by kind).
CREATE INDEX IF NOT EXISTS idx_news_source_suggestions_kind_created
  ON public.news_source_suggestions (submitted_by_kind, created_at DESC);

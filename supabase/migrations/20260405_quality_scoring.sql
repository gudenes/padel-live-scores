-- Add quality scoring and impression tracking columns
ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS quality_score REAL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS impression_count INTEGER DEFAULT 0;

ALTER TABLE public.highlights
  ADD COLUMN IF NOT EXISTS impression_count INTEGER DEFAULT 0;

-- Indexes for quality dashboard queries
CREATE INDEX IF NOT EXISTS idx_articles_quality ON public.articles (quality_score) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_articles_impressions ON public.articles (impression_count) WHERE status = 'active';

-- Batch increment impression_count for articles
CREATE OR REPLACE FUNCTION increment_impressions_articles(article_ids UUID[])
RETURNS void AS $$
  UPDATE public.articles
  SET impression_count = impression_count + 1
  WHERE id = ANY(article_ids);
$$ LANGUAGE sql;

-- Batch increment impression_count for highlights
CREATE OR REPLACE FUNCTION increment_impressions_highlights(highlight_ids UUID[])
RETURNS void AS $$
  UPDATE public.highlights
  SET impression_count = impression_count + 1
  WHERE id = ANY(highlight_ids);
$$ LANGUAGE sql;

-- Lazy snippet translations cache for the home news peek pattern.
--
-- When a user opens a news card whose source language differs from their
-- locale, we call Anthropic Haiku once to translate the snippet, then
-- store the translation here keyed by ISO locale code. Subsequent users
-- (and reloads) hit the cache instantly.
--
-- JSONB shape: { "en": "translation…", "pt": "translation…", … }
-- One row per article. Locales we support per next-intl: en/es/pt/it/fr.
--
-- No backfill — old articles only get translated if someone opens them.
-- Empty default ('{}'::jsonb) means "no translations yet"; the API layer
-- treats missing keys as cache miss and triggers a fresh Claude call.

ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS snippet_translations jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.articles.snippet_translations IS
  'Lazy translation cache for snippet field. Keyed by ISO locale code (en/es/pt/it/fr). Populated on first user expand of a news card whose article.language differs from user locale.';

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'articles'
      AND column_name = 'snippet_translations'
  ), 'articles.snippet_translations missing';
END $$;

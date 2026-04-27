-- Eager title translations cache for the home news carousel.
--
-- Unlike snippet_translations which is populated lazily when a user
-- expands the peek sheet, titles are visible on EVERY home page render
-- — they need to be translated up front so the user never sees a
-- foreign-language title sitting next to their localized UI.
--
-- Populated by:
--   - /api/cron/sync-articles → for every NEW article on ingest, one
--     Claude Haiku call generates translations into all 4 non-source
--     app locales (en/es/pt/it/fr) and stores them as a JSONB object.
--   - /api/admin/backfill-title-translations → one-shot for the
--     historical article backlog (run once after deploy).
--
-- JSONB shape: { "en": "translation…", "pt": "translation…", … }
-- The source-language key is omitted — UI falls back to article.title
-- when title_translations[user.locale] is missing.

ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS title_translations jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.articles.title_translations IS
  'Eager title translation cache populated on ingest. Keyed by ISO locale code (en/es/pt/it/fr). UI renders title_translations[user.locale] ?? article.title.';

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'articles'
      AND column_name = 'title_translations'
  ), 'articles.title_translations missing';
END $$;

-- supabase/migrations/20260508_news_posts.sql
-- First-party news posts (partnerships, product announcements).
-- One row per locale; EN is the source-of-truth, others are Haiku translations
-- linked via translated_from. Modelled on editorial_posts but standalone
-- (no parent entity_id) and with slug + status + cover_image for the
-- public /news pages.

CREATE TABLE IF NOT EXISTS news_posts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category        TEXT NOT NULL CHECK (category IN ('announcements', 'product')),
  locale          TEXT NOT NULL CHECK (locale IN ('en', 'es', 'pt', 'it', 'fr')),

  slug            TEXT NOT NULL,
  title           TEXT NOT NULL,
  body_md         TEXT NOT NULL,
  cover_image_url TEXT,

  translated_from UUID REFERENCES news_posts(id) ON DELETE CASCADE,

  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  model           TEXT,

  UNIQUE (locale, slug)
);

CREATE INDEX IF NOT EXISTS idx_news_posts_published
  ON news_posts (locale, status, published_at DESC)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_news_posts_category
  ON news_posts (locale, category, status, published_at DESC)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_news_posts_translated_from
  ON news_posts (translated_from)
  WHERE translated_from IS NOT NULL;

-- updated_at maintenance
CREATE OR REPLACE FUNCTION news_posts_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER news_posts_updated_at_trigger
  BEFORE UPDATE ON news_posts
  FOR EACH ROW EXECUTE FUNCTION news_posts_set_updated_at();

COMMENT ON TABLE news_posts IS 'First-party PadelNachos news posts. EN is source-of-truth, other locales are Haiku translations linked via translated_from.';
COMMENT ON COLUMN news_posts.translated_from IS 'NULL for English (source of truth). Non-NULL points at the English post whose translation this is.';

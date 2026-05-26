-- News pipeline V1: enrichment columns, entity/topic junctions, source catalog,
-- public suggestion queue. See docs/superpowers/specs/2026-05-23-immersive-news-feed-design.md

BEGIN;

-- ─── articles: enrichment columns ──────────────────────────────────────
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS summary_md TEXT,
  ADD COLUMN IF NOT EXISTS summary_translations JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS enrichment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (enrichment_status IN ('pending', 'enriched', 'failed', 'skipped')),
  ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS enrichment_error TEXT,
  ADD COLUMN IF NOT EXISTS enrichment_model TEXT,
  ADD COLUMN IF NOT EXISTS enrichment_retry_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_articles_enrichment_pending
  ON articles (created_at DESC)
  WHERE enrichment_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_articles_enriched_published
  ON articles (published_at DESC)
  WHERE enrichment_status = 'enriched';

-- ─── article_entities (polymorphic junction) ───────────────────────────
CREATE TABLE IF NOT EXISTS article_entities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id    UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('player', 'tournament', 'brand')),
  entity_id     UUID NOT NULL,
  mention_text  TEXT NOT NULL,
  confidence    REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (article_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_article_entities_lookup
  ON article_entities (entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_article_entities_by_article
  ON article_entities (article_id);

ALTER TABLE article_entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read article entities" ON article_entities FOR SELECT USING (true);

-- ─── article_topics ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS article_topics (
  article_id  UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  topic       TEXT NOT NULL,
  confidence  REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  PRIMARY KEY (article_id, topic)
);

CREATE INDEX IF NOT EXISTS idx_article_topics_topic
  ON article_topics (topic, article_id);

ALTER TABLE article_topics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read article topics" ON article_topics FOR SELECT USING (true);

-- ─── news_sources (operator-managed catalog) ───────────────────────────
CREATE TABLE IF NOT EXISTS news_sources (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key             TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  url             TEXT NOT NULL,
  source_type     TEXT NOT NULL CHECK (source_type IN ('rss', 'wp-api', 'google-news-search')),
  language        TEXT NOT NULL,
  weight          REAL NOT NULL DEFAULT 1.0,
  lookback_days   INTEGER NOT NULL DEFAULT 14,
  cadence         TEXT NOT NULL CHECK (cadence IN ('hourly', 'weekly')),
  query_kind      TEXT CHECK (query_kind IN ('static', 'player', 'tournament', 'brand', 'user-suggested')),
  query_entity_id UUID,
  query_template  TEXT,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      TEXT,
  notes           TEXT,
  last_fetch_at   TIMESTAMPTZ,
  last_fetch_status TEXT CHECK (last_fetch_status IN ('success', 'error', 'empty')),
  last_fetch_error TEXT,
  articles_last_7d INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_news_sources_cadence_enabled
  ON news_sources (cadence, enabled)
  WHERE enabled = true;

CREATE INDEX IF NOT EXISTS idx_news_sources_query
  ON news_sources (query_kind, query_entity_id)
  WHERE query_kind IS NOT NULL;

ALTER TABLE news_sources ENABLE ROW LEVEL SECURITY;
-- No public policies — operator/service-role only.

-- ─── news_source_suggestions ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS news_source_suggestions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url           TEXT NOT NULL,
  note          TEXT,
  suggested_by_email TEXT,
  suggested_by_ip TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'duplicate')),
  reviewed_by   TEXT,
  reviewed_at   TIMESTAMPTZ,
  review_note   TEXT,
  approved_source_id UUID REFERENCES news_sources(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_news_source_suggestions_pending
  ON news_source_suggestions (created_at DESC)
  WHERE status = 'pending';

ALTER TABLE news_source_suggestions ENABLE ROW LEVEL SECURITY;
-- Inserts go through the API endpoint with rate-limiting; no direct anon access.

COMMIT;

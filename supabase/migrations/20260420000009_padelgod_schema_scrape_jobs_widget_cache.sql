-- Padelgod foundation: scraper-internal state lives in its own schema.

CREATE SCHEMA IF NOT EXISTS padelgod;
COMMENT ON SCHEMA padelgod IS 'Padelgod scraper-internal state — operational logs, caches, queues. Not for app reads.';

-- 1. Operational log: every scrape attempt
CREATE TABLE padelgod.scrape_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL,
  tournament_id UUID REFERENCES public.tournaments(id),
  target_url TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'success', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INT,
  error_message TEXT,
  parser_version TEXT
);
CREATE INDEX idx_scrape_jobs_recent     ON padelgod.scrape_jobs(started_at DESC);
CREATE INDEX idx_scrape_jobs_tournament ON padelgod.scrape_jobs(tournament_id, job_type);
CREATE INDEX idx_scrape_jobs_status     ON padelgod.scrape_jobs(status, started_at DESC);

COMMENT ON TABLE padelgod.scrape_jobs IS
  'Every scrape attempt. job_type ∈ {discover, widget_id, draw, oop, live, rankings, profile, article, youtube}.';

-- 2. Widget code cache (durable so we don''t rediscover on every restart)
CREATE TABLE padelgod.widget_id_cache (
  tournament_id UUID PRIMARY KEY REFERENCES public.tournaments(id) ON DELETE CASCADE,
  widget_id TEXT NOT NULL UNIQUE,
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_validated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT true,
  extraction_method TEXT NOT NULL CHECK (extraction_method IN ('search', 'iframe', 'page_regex', 'manual'))
);
CREATE INDEX idx_widget_id_cache_active ON padelgod.widget_id_cache(is_active, last_validated_at);

COMMENT ON TABLE padelgod.widget_id_cache IS
  'tournament_id → FIP widget code (e.g., FIP-2026-1701). Marked is_active=false when widget returns "No results".';

-- Verification
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name='padelgod'),
    'padelgod schema missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='padelgod' AND table_name='scrape_jobs'),
    'padelgod.scrape_jobs missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='padelgod' AND table_name='widget_id_cache'),
    'padelgod.widget_id_cache missing';
END $$;
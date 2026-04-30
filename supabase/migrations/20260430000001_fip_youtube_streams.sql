-- 20260430000001_fip_youtube_streams.sql
-- FIP YouTube stream discovery + ops unresolved queue.
-- Spec: docs/superpowers/specs/2026-04-30-fip-youtube-streams-design.md

CREATE TABLE IF NOT EXISTS fip_court_streams (
  youtube_video_id      TEXT PRIMARY KEY,
  tournament_id         UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  court                 TEXT NOT NULL,
  day_date              DATE NOT NULL,
  title                 TEXT,
  thumbnail_url         TEXT,
  state                 TEXT NOT NULL CHECK (state IN ('upcoming','live','archived')),
  scheduled_start_at    TIMESTAMPTZ,
  actual_start_at       TIMESTAMPTZ,
  actual_end_at         TIMESTAMPTZ,
  view_count            INTEGER,
  concurrent_viewers    INTEGER,
  manual_offset_seconds INTEGER,
  link_method           TEXT NOT NULL CHECK (link_method IN ('auto','manual')),
  first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fip_court_streams_lookup
  ON fip_court_streams (tournament_id, court, day_date, state);

CREATE TABLE IF NOT EXISTS fip_streams_unresolved (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  youtube_video_id         TEXT UNIQUE NOT NULL,
  channel_id               TEXT NOT NULL,
  title                    TEXT NOT NULL,
  thumbnail_url            TEXT,
  state                    TEXT,
  scheduled_start_at       TIMESTAMPTZ,
  reason                   TEXT NOT NULL CHECK (reason IN ('parser_failed','no_tournament_match','no_court')),
  parsed_tournament_name   TEXT,
  parsed_day               TEXT,
  parsed_court             TEXT,
  resolved_at              TIMESTAMPTZ,
  resolved_tournament_id   UUID REFERENCES tournaments(id),
  resolved_court           TEXT,
  resolved_day_date        DATE,
  first_seen_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fip_streams_unresolved_open
  ON fip_streams_unresolved (resolved_at) WHERE resolved_at IS NULL;

-- supabase/migrations/20260514_youtube_channels.sql
-- YouTube live indicator: per-channel config + per-video live state.
-- Spec: docs/superpowers/specs/2026-05-14-youtube-live-indicator-design.md

-- ── Config: which YouTube channels we poll ──────────────────────────
CREATE TABLE youtube_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id TEXT NOT NULL UNIQUE,         -- YouTube channel ID (UCxxxxxxx)
  uploads_playlist_id TEXT NOT NULL,       -- Derived from channel_id (UU + slice(2))
  name TEXT NOT NULL,                      -- Display name (e.g., 'Premier Padel')
  abbreviation TEXT NOT NULL,              -- 2-3 chars for the avatar circle
  color_hex TEXT NOT NULL,                 -- Avatar background, e.g. '#FF0000'
  display_order INT NOT NULL DEFAULT 100,  -- Lower = first in the panel
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_youtube_channels_active
  ON youtube_channels (is_active, display_order)
  WHERE is_active = true;

-- ── State: currently-live videos per channel ────────────────────────
CREATE TABLE youtube_channel_live (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES youtube_channels(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,                  -- YouTube video ID (11 chars)
  title TEXT NOT NULL,                     -- snippet.title at discovery time
  started_at TIMESTAMPTZ,                  -- liveStreamingDetails.actualStartTime
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel_id, video_id)
);

CREATE INDEX idx_youtube_channel_live_seen
  ON youtube_channel_live (last_seen_at DESC);

-- ── Seed: Premier Padel + FIP Tour ──────────────────────────────────
INSERT INTO youtube_channels (channel_id, uploads_playlist_id, name, abbreviation, color_hex, display_order)
VALUES
  ('UCK59dYVs3Wgwoe73nDTH6jw', 'UUK59dYVs3Wgwoe73nDTH6jw', 'Premier Padel', 'PP', '#FF0000', 10),
  ('UCo2fCPOJnS95_PNOta5Jafg', 'UUo2fCPOJnS95_PNOta5Jafg', 'FIP Tour', 'FIP', '#1657A0', 20);

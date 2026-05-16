-- supabase/migrations/20260515_broadcasters_channel_id.sql
-- Add channel_id FK to broadcasters so the new Where-to-Watch popup
-- can nest regional broadcasters under the YouTube channel whose
-- content they license. Premier Padel today; FIP/PadelTV later.
-- Spec: docs/superpowers/specs/2026-05-15-where-to-watch-unification-design.md

ALTER TABLE broadcasters
  ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES youtube_channels(id);

CREATE INDEX IF NOT EXISTS broadcasters_channel_id_idx
  ON broadcasters (channel_id)
  WHERE channel_id IS NOT NULL;

COMMENT ON COLUMN broadcasters.channel_id IS
  'YouTube channel whose content this broadcaster is licensed to carry. NULL means unclassified — rows with NULL do not render in the new Where-to-Watch popup.';

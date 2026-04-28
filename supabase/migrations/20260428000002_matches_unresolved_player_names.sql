-- Thin-match support for amateur-tier tournaments (FIP Beyond / Promises /
-- Other). On those tiers, padelgod's draw populator can't always resolve
-- player names to FIP IDs (entry-list PDFs are sparse, players don't have
-- FIP profiles). Today the populator drops unresolved rows on the floor,
-- so the tournament shows up in /tournaments but has zero matches in the
-- public app.
--
-- This migration adds 4 nullable TEXT columns that mirror the existing
-- 4 player FK columns. The populator writes the raw player names from
-- the FIP draw bracket into these when FK resolution fails. The UI then
-- falls back to rendering the name strings (with no clickable profile)
-- when the FK is null.
--
-- Bronze/Silver/Gold/Premier matches are unchanged: their populator
-- continues to require full resolution and these columns stay NULL.

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS pair1_player1_name TEXT,
  ADD COLUMN IF NOT EXISTS pair1_player2_name TEXT,
  ADD COLUMN IF NOT EXISTS pair2_player1_name TEXT,
  ADD COLUMN IF NOT EXISTS pair2_player2_name TEXT;

COMMENT ON COLUMN public.matches.pair1_player1_name IS
  'Raw player name from the upstream feed. Populated by padelgod''s '
  'fip-draw-populator for amateur-tier tournaments where the entry-list '
  'resolver couldn''t find a public.players row. The matching '
  'pair1_player1_id stays NULL in those cases. UI falls back to this '
  'string when the FK is null. Always NULL for fully-resolved matches.';

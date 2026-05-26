-- Track how long an FIP-source tournament row has been absent from the
-- FIP WP /events response. Populated by `tournament-discovery` at the
-- end of each run:
--   - row present in CMS  → column cleared to NULL
--   - row missing from CMS → column stamped with NOW() if currently NULL
--                            (idempotent — preserves the original miss
--                            timestamp on subsequent runs)
--
-- Discovery's prune step then DELETEs rows where:
--   - last_missing_from_cms_at IS NOT NULL AND > 7 days old
--   - tournament has 0 matches and 0 widget_id_cache entries
--   - tournament has no padelapi_id (never delete padelapi-linked rows)
--
-- This was driven by the 2026-05-25 audit which found 8 orphan FIP
-- tournament rows accumulated over time as FIP CMS renamed/removed
-- events without telling us. FIP BRONZE MATOSINHOS and FIP BEYOND B3
-- CASTELLÓN were the two that surfaced it; cleanup script hit 6 more.

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS last_missing_from_cms_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.tournaments.last_missing_from_cms_at IS
  'When the tournament row last failed to appear in the FIP WP /events response. NULL when present (or never checked). See tournament-discovery worker for prune semantics.';

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tournaments'
      AND column_name = 'last_missing_from_cms_at'
  ), 'tournaments.last_missing_from_cms_at column missing after migration';
END $$;

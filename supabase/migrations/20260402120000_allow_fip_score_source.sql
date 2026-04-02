-- Migration: Allow 'fip' as a valid score_source for FIP-scraped set scores
-- The check constraint was blocking FIP cron from writing sets

ALTER TABLE sets DROP CONSTRAINT IF EXISTS sets_score_source_check;
ALTER TABLE sets ADD CONSTRAINT sets_score_source_check
  CHECK (score_source IN ('api', 'inferred', 'live', 'fip') OR score_source IS NULL);

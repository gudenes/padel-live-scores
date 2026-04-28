-- Tournament overview fields scraped from padelfip.com event pages.
--
-- The earlier 20260328120000 migration added venue/venue_address/venue_type
-- but never wired up the scraper, so those columns are still all-NULL.
-- This migration adds the remaining fields the FIP overview HTML exposes
-- (registration status, sign-up fee, per-round prize breakdown, schedule
-- notes) and a companion historical-backfill cron will populate everything
-- the scraper now extracts.
--
-- prize_breakdown shape:
--   {
--     "r32": 0, "r16": 102, "qf": 190, "sf": 382,
--     "finalist": 720, "winner": 1440,
--     "currency": "EUR",
--     "per": "player",
--     "source": "scraped" | "inferred"
--   }
-- Only rounds the page lists are populated; missing rounds stay absent
-- (NOT zero — distinguishes "round didn't happen" from "0€ prize").

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS registration_status TEXT,
  ADD COLUMN IF NOT EXISTS signup_fee_eur      INT,
  ADD COLUMN IF NOT EXISTS prize_breakdown     JSONB,
  ADD COLUMN IF NOT EXISTS schedule_notes      TEXT;

-- Lightweight index for "show open tournaments" list filters.
CREATE INDEX IF NOT EXISTS idx_tournaments_registration_status
  ON tournaments (registration_status)
  WHERE registration_status IS NOT NULL;

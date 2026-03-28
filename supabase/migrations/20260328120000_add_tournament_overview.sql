-- Add venue and prize money fields to tournaments table
-- Populated automatically by the sync cron via FIP overview page scraping
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS venue       TEXT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS venue_address TEXT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS venue_type  TEXT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS prize_money TEXT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS n_courts    INT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS surface     TEXT;

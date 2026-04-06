-- Draw size columns for FIP tournaments
-- Scraped from the event overview page on padelfip.com.
-- Used to validate expected match counts and detect duplicates/missing data.

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS draw_size_md INTEGER,      -- Main draw pairs (e.g. 32)
  ADD COLUMN IF NOT EXISTS draw_size_qd INTEGER,      -- Qualifying draw pairs (e.g. 16)
  ADD COLUMN IF NOT EXISTS prize_money_fip INTEGER;    -- Prize money in euros from FIP page

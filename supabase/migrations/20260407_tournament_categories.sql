-- Tournament categories: track which genders are included.
-- Some FIP tournaments are men-only or women-only.
-- Used by entry list readiness logic to determine when a tournament is 'ready'.

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS categories TEXT NOT NULL DEFAULT 'both'
  CHECK (categories IN ('both', 'men_only', 'women_only'));

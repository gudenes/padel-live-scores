-- Add round column to tournament_draws for visual bracket display.
-- Stores which round each draw position belongs to (R32, R16, QF, SF, F).

ALTER TABLE tournament_draws
  ADD COLUMN IF NOT EXISTS round TEXT;

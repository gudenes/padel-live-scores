-- Relax player_tournament_earnings.round_eliminated CHECK constraint
-- to permit 'W' (tournament winner / champion).
--
-- Background: the original schema (20260504000001) only allowed bracket-round
-- codes {F, SF, QF, R16, R32, R64, Q1, Q2, Q3}. The intent was for 'F' to mean
-- "won the tournament", with losers stored at the round they lost in. But the
-- engine (compute-earnings.ts) never carried the is_winner flag through to the
-- persisted row — every player who reached the Final got stored as 'F' regardless
-- of whether they actually won. The UI then hard-coded 'F' → 'W' coercion,
-- mislabelling every finalist as a champion.
--
-- This migration:
--   1. Drops the old CHECK (whatever its auto-generated name is).
--   2. Adds a new CHECK that additionally allows 'W'.
--   3. Updates the column comment to be unambiguous.
--
-- A follow-up code change (compute-earnings.ts) writes 'W' when is_winner is
-- true, and a backfill (scripts/backfill-player-earnings.ts --apply) re-derives
-- round_eliminated for historical rows from matches.winner_pair.
--
-- Safe to apply before the code change: 'W' is added to the allow-list, not
-- substituted for 'F'. Existing rows remain valid.

BEGIN;

-- Drop whichever CHECK constraint currently restricts round_eliminated values.
-- Postgres auto-names inline CHECK constraints as <table>_<col>_check, so
-- the conventional name is tried first; the DO block is a safety net in case
-- the auto-name ever differed.
DO $$
DECLARE
  con_name TEXT;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'public.player_tournament_earnings'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%round_eliminated%';

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.player_tournament_earnings DROP CONSTRAINT %I', con_name);
  END IF;
END$$;

ALTER TABLE public.player_tournament_earnings
  ADD CONSTRAINT player_tournament_earnings_round_eliminated_check
  CHECK (round_eliminated IN ('W', 'F', 'SF', 'QF', 'R16', 'R32', 'R64', 'Q1', 'Q2', 'Q3'));

COMMENT ON COLUMN public.player_tournament_earnings.round_eliminated IS
  'Player outcome code. ''W'' = won the tournament (champion). ''F'' = lost in the Final (finalist / runner-up). All other values = bracket round in which the player was eliminated (SF, QF, R16, R32, R64, Q1, Q2, Q3).';

COMMIT;

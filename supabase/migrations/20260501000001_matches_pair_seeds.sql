-- Add per-pair seed columns to public.matches.
--
-- Seeds historically lived only in `public.tournament_draws` (one row per
-- team per bracket position) and `padelgod.draw_snapshots` (per-match
-- snapshot). Surfacing them at the match-row level lets every match-list
-- UI render the seed pill ("[1]") next to player names without joining
-- to the bracket table — a join that would punish the daily matches
-- page (loads up to 400 matches with 4 player FKs each).
--
-- Why nullable + no default
-- -------------------------
-- A non-seeded pair is the rule, not the exception — only top 8/16
-- players in any draw get seeded. NULL = "not seeded", which is also
-- what `tournament_draws.seed` uses today.
--
-- Population
-- ----------
-- `padelgod/src/workers/fip-draw-populator.ts` writes these on INSERT
-- and gap-fills NULL-only on UPDATE (same gap-fill semantics it uses
-- for round / court / scheduled_at). Padelapi sync does not touch
-- these columns — padelapi doesn't carry seed data.

BEGIN;

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS pair1_seed INTEGER,
  ADD COLUMN IF NOT EXISTS pair2_seed INTEGER;

COMMENT ON COLUMN public.matches.pair1_seed IS
  'Seed number of pair 1 (the team in pair1_player1/pair1_player2 slots). '
  'NULL when not seeded — only top 8/16 pairs get seeded in any FIP draw. '
  'Sourced from padelgod.draw_snapshots.team1_seed via fip-draw-populator.';

COMMENT ON COLUMN public.matches.pair2_seed IS
  'Seed number of pair 2 (the team in pair2_player1/pair2_player2 slots). '
  'See pair1_seed for sourcing notes.';

COMMIT;

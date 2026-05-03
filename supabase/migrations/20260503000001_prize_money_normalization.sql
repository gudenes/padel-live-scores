-- Prize money normalization (Phase 1 / PR 1)
--
-- End goal: per-player career earnings since 2024 (see
-- docs/superpowers/specs/2026-05-03-prize-money-normalization-phase-1-design.md).
--
-- This migration adds the storage columns. Population happens in
-- PR 2 (backfill scripts) and PR 3 (gap-bucket investigation).
--
-- Why nullable
-- ------------
-- prize_money_eur: NULL means "unknown" (data not yet ingested or
-- genuinely unavailable upstream). Explicit 0 is meaningful and
-- distinct — amateur / unprized event. No CHECK on >= 0 because
-- nothing in our pipeline currently produces negatives, and a CHECK
-- would just hide a future bug behind a constraint error.
--
-- prize_money_eur_source: provenance tag — 'fip_int' | 'parsed_text'
-- | 'manual'. Lets ops + future auditors trace where a value came
-- from when two sources disagree. Enum-like, but TEXT for forward
-- compat (we may add 'padelapi' later if upstream ever exposes the
-- field structurally).
--
-- round_canonical: 'F' | 'SF' | 'QF' | 'R16' | 'R32' | 'R64' | 'Q1'
-- | 'Q2' | 'Q3'. NULL for unrecognized labels (RR group stage,
-- exhibitions, anything roundCanonical() can't classify). The point
-- of having it is to escape the 3-4-spellings-per-round mess in
-- matches.round (e.g. 'Round of 32' vs 'R32') without rewriting
-- every consumer.
--
-- The partial index supports the Phase 2 earnings query:
--   SELECT ... FROM matches
--   WHERE round_canonical = 'F' AND winner_pair = 1 ...
-- which scans only matches where round classification succeeded.

BEGIN;

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS prize_money_eur INTEGER,
  ADD COLUMN IF NOT EXISTS prize_money_eur_source TEXT;

COMMENT ON COLUMN public.tournaments.prize_money_eur IS
  'Total prize pool in EUR (whole euros, no fractional cents). '
  'NULL = unknown. Explicit 0 = amateur / no prize. '
  'Populated by scripts/backfill-prize-money-eur.ts (PR 2).';

COMMENT ON COLUMN public.tournaments.prize_money_eur_source IS
  'Provenance: ''fip_int'' | ''parsed_text'' | ''manual''. '
  'See docs/superpowers/specs/2026-05-03-prize-money-normalization-phase-1-design.md.';

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS round_canonical TEXT;

COMMENT ON COLUMN public.matches.round_canonical IS
  'Canonical round code: F | SF | QF | R16 | R32 | R64 | Q1 | Q2 | Q3. '
  'NULL when the source label cannot be classified. '
  'Computed by src/lib/round-canonical.ts::roundCanonical(round). '
  'Backfilled by scripts/backfill-round-canonical.ts (PR 2); '
  'maintenance at write sites added in a follow-up.';

CREATE INDEX IF NOT EXISTS matches_round_canonical_idx
  ON public.matches (round_canonical)
  WHERE round_canonical IS NOT NULL;

COMMIT;

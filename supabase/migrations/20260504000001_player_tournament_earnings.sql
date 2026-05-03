-- Player tournament earnings (Phase 2 PR 2B)
--
-- End goal: per-player career earnings since 2024 in EUR.
-- See docs/superpowers/specs/2026-05-03-player-earnings-phase-2-design.md.
--
-- Population: scripts/backfill-player-earnings.ts (this PR) runs the
-- pure-function engine in src/lib/earnings/* against finished matches
-- and upserts one row per (player, tournament, category).
--
-- Why a dedicated table (vs a view)
-- ---------------------------------
-- The engine consults multiple sources (Premier rulebook, scraped
-- breakdown, Cupra rulebook %) and embeds rulebook constants. A view
-- would have to re-execute that lookup logic in SQL — duplicate
-- truth, fragile when the rulebook updates. Materialising lets us
-- index for the "career totals per player" hot path and re-run the
-- backfill when rulebook tables change.
--
-- Composite uniqueness (player, tournament, category)
-- ---------------------------------------------------
-- Same player can appear in both men's and women's draws of the same
-- physical event in mixed tournaments — we never see this in our data
-- today, but the schema doesn't preclude it. The unique constraint
-- supports `ON CONFLICT (player_id, tournament_id, category)` upserts
-- in the backfill, which is what makes re-runs idempotent.
--
-- earned_at is denormalised from matches.finished_at so date-window
-- queries (career totals over a season, etc.) don't need a join.

BEGIN;

CREATE TABLE IF NOT EXISTS public.player_tournament_earnings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  player_id     UUID NOT NULL REFERENCES public.players(id),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id),

  category      TEXT NOT NULL CHECK (category IN ('men', 'women')),
  round_eliminated TEXT NOT NULL CHECK (round_eliminated IN
    ('F', 'SF', 'QF', 'R16', 'R32', 'R64', 'Q1', 'Q2', 'Q3')),

  per_player_eur INTEGER NOT NULL CHECK (per_player_eur >= 0),

  source TEXT NOT NULL CHECK (source IN (
    'premier_rulebook',
    'fip_breakdown_scraped',
    'fip_tour_rulebook_pct',
    'manual'
  )),

  earned_at   TIMESTAMPTZ NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT player_tournament_earnings_unique
    UNIQUE (player_id, tournament_id, category)
);

CREATE INDEX IF NOT EXISTS player_tournament_earnings_player_idx
  ON public.player_tournament_earnings (player_id);

CREATE INDEX IF NOT EXISTS player_tournament_earnings_earned_at_idx
  ON public.player_tournament_earnings (earned_at);

CREATE INDEX IF NOT EXISTS player_tournament_earnings_tournament_idx
  ON public.player_tournament_earnings (tournament_id);

COMMENT ON TABLE public.player_tournament_earnings IS
  'Per-player per-tournament EUR earnings. One row per (player, tournament, '
  'category). Computed by scripts/backfill-player-earnings.ts using the '
  'src/lib/earnings/* engine.';

COMMENT ON COLUMN public.player_tournament_earnings.round_eliminated IS
  'Canonical round the player stopped at. ''F'' = won the tournament. '
  'For losers, the round their last (terminal) match was in.';

COMMENT ON COLUMN public.player_tournament_earnings.source IS
  'Provenance: premier_rulebook | fip_breakdown_scraped | '
  'fip_tour_rulebook_pct | manual.';

COMMENT ON COLUMN public.player_tournament_earnings.earned_at IS
  'Denormalised from matches.finished_at of the player''s terminal match. '
  'Used for time-window queries without joining back to matches.';

COMMIT;

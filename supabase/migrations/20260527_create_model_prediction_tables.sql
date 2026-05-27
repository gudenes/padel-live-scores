-- Append-only snapshot tables for the Elo + Monte Carlo odds model.
-- See docs/superpowers/specs/2026-05-27-odds-admin-visibility-design.md §1.
-- No UPDATEs in normal operation — the latest row per key is the current state.

BEGIN;

-- ─── model_predictions ──────────────────────────────────────────────────────
-- One row per per-match snapshot (hourly cron writes one per upcoming match).

CREATE TABLE IF NOT EXISTS model_predictions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id              UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  pair1_prob            NUMERIC(5,4) NOT NULL CHECK (pair1_prob >= 0 AND pair1_prob <= 1),
  pair2_prob            NUMERIC(5,4) NOT NULL CHECK (pair2_prob >= 0 AND pair2_prob <= 1),
  pair1_decimal_odds    NUMERIC(8,3) NOT NULL CHECK (pair1_decimal_odds >= 1),
  pair2_decimal_odds    NUMERIC(8,3) NOT NULL CHECK (pair2_decimal_odds >= 1),
  pair1_team_elo        NUMERIC(7,2) NOT NULL,
  pair2_team_elo        NUMERIC(7,2) NOT NULL,
  pair1_team_form       NUMERIC(6,2) NOT NULL DEFAULT 0,
  pair2_team_form       NUMERIC(6,2) NOT NULL DEFAULT 0,
  model_version         TEXT NOT NULL,
  training_match_count  INTEGER NOT NULL,
  halflife_days         INTEGER NOT NULL
);

COMMENT ON TABLE model_predictions IS 'Per-match Elo-model odds snapshots. Append-only; latest row per match_id is current.';

CREATE INDEX IF NOT EXISTS model_predictions_match_created_idx
  ON model_predictions (match_id, created_at DESC);

CREATE INDEX IF NOT EXISTS model_predictions_created_idx
  ON model_predictions (created_at);

-- ─── model_tournament_predictions ───────────────────────────────────────────
-- One row per pair per tournament per snapshot.

CREATE TABLE IF NOT EXISTS model_tournament_predictions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id         UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  category              TEXT NOT NULL CHECK (category IN ('men', 'women')),
  pair_player1_id       UUID NOT NULL REFERENCES players(id),
  pair_player2_id       UUID NOT NULL REFERENCES players(id),
  pair_seed             INTEGER,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  champ_prob            NUMERIC(5,4) NOT NULL CHECK (champ_prob >= 0 AND champ_prob <= 1),
  finalist_prob         NUMERIC(5,4) NOT NULL CHECK (finalist_prob >= 0 AND finalist_prob <= 1),
  semi_prob             NUMERIC(5,4) NOT NULL CHECK (semi_prob >= 0 AND semi_prob <= 1),
  team_elo              NUMERIC(7,2) NOT NULL,
  team_form             NUMERIC(6,2) NOT NULL DEFAULT 0,
  entry_round           TEXT NOT NULL,
  model_version         TEXT NOT NULL,
  mc_runs               INTEGER NOT NULL,
  halflife_days         INTEGER NOT NULL
);

COMMENT ON TABLE model_tournament_predictions IS 'Per-pair Monte Carlo championship/finalist/semi probabilities. Append-only.';

CREATE INDEX IF NOT EXISTS model_tournament_predictions_tcat_created_idx
  ON model_tournament_predictions (tournament_id, category, created_at DESC);

CREATE INDEX IF NOT EXISTS model_tournament_predictions_created_idx
  ON model_tournament_predictions (created_at);

-- ─── prediction_scores ──────────────────────────────────────────────────────
-- One row per scored match. UNIQUE(match_id) enforces idempotency.

CREATE TABLE IF NOT EXISTS prediction_scores (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id            UUID NOT NULL REFERENCES model_predictions(id) ON DELETE CASCADE,
  match_id                 UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  scored_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  actual_winner_pair       INTEGER NOT NULL CHECK (actual_winner_pair IN (1, 2)),
  predicted_prob_winner    NUMERIC(5,4) NOT NULL CHECK (predicted_prob_winner > 0 AND predicted_prob_winner <= 1),
  brier_score              NUMERIC(6,5) NOT NULL CHECK (brier_score >= 0 AND brier_score <= 1),
  log_loss                 NUMERIC(8,5) NOT NULL CHECK (log_loss >= 0),
  model_version            TEXT NOT NULL,
  CONSTRAINT prediction_scores_match_id_unique UNIQUE (match_id)
);

COMMENT ON TABLE prediction_scores IS 'Per-match calibration scoring. UNIQUE(match_id) = one score per match.';

CREATE INDEX IF NOT EXISTS prediction_scores_version_scored_idx
  ON prediction_scores (model_version, scored_at);

COMMIT;

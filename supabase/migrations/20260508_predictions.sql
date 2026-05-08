-- Phase 2: persistent match predictions + leaderboard support.
-- See docs/superpowers/specs/2026-05-08-picks-leaderboard-phase-2-design.md.
--
-- One row per (user, match). Pick-time fields (pair, margin, probability,
-- multiplier, is_fallback) are frozen on insert. Match-finish fields
-- (result, reward, resolved_at) are written by /api/cron/resolve-predictions
-- once the match transitions to finished/retired/walkover.

CREATE TABLE IF NOT EXISTS predictions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id     UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,

  -- Frozen at pick-time
  pair         SMALLINT NOT NULL CHECK (pair IN (1, 2)),
  margin       TEXT     NOT NULL CHECK (margin IN ('2-0', '2-1')),
  probability  REAL     NOT NULL,
  multiplier   REAL     NOT NULL,
  is_fallback  BOOLEAN  NOT NULL DEFAULT false,

  -- Frozen at match-finish (resolver writes these)
  result       TEXT     NULL CHECK (result IN ('perfect','right','wrong','upset','invalidated')),
  reward       INTEGER  NULL,
  resolved_at  TIMESTAMPTZ NULL,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id, match_id)
);

CREATE INDEX IF NOT EXISTS predictions_user_idx
  ON predictions (user_id);
CREATE INDEX IF NOT EXISTS predictions_match_idx
  ON predictions (match_id);
CREATE INDEX IF NOT EXISTS predictions_unresolved_idx
  ON predictions (match_id) WHERE resolved_at IS NULL;

-- Auto-bump updated_at on row update
CREATE OR REPLACE FUNCTION predictions_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS predictions_set_updated_at ON predictions;
CREATE TRIGGER predictions_set_updated_at
  BEFORE UPDATE ON predictions
  FOR EACH ROW EXECUTE FUNCTION predictions_touch_updated_at();

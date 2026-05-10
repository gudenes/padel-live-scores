-- Forward-only historical ranking capture.
-- One row per (player, type, year, week). Race rows use ISO year/week of capture
-- since FIP race endpoint does not expose a week parameter.
CREATE TABLE IF NOT EXISTS player_ranking_snapshots (
  id            bigserial PRIMARY KEY,
  player_id     uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  type          text NOT NULL CHECK (type IN ('official','race')),
  gender        text NOT NULL CHECK (gender IN ('men','women')),
  year          int  NOT NULL,
  week          int  NOT NULL,
  ranking_date  date NOT NULL,
  ranking       int  NOT NULL,
  points        int,
  ranking_move  int,
  source        text NOT NULL CHECK (source IN ('vercel-fip','padelgod-fip')),
  captured_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, type, year, week)
);

CREATE INDEX IF NOT EXISTS idx_prs_player_type_date
  ON player_ranking_snapshots (player_id, type, ranking_date DESC);

CREATE INDEX IF NOT EXISTS idx_prs_type_date_rank
  ON player_ranking_snapshots (type, ranking_date DESC, ranking);

COMMENT ON TABLE player_ranking_snapshots IS
  'Append-only historical FIP rankings (official + race). One row per (player, type, year, week). Written by Vercel sync-fip-rankings cron and padelgod player-rankings worker.';

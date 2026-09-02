-- Week-over-week FIP points delta, stored on players so the public rankings
-- page can render +/- without reading player_ranking_snapshots (service-role only).
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS points_move integer,
  ADD COLUMN IF NOT EXISTS race_points_move integer;

COMMENT ON COLUMN players.points_move IS
  'Official points this week minus last week. Null = no previous week (UI shows --). Written by padelgod player-rankings and Vercel sync-fip-rankings.';
COMMENT ON COLUMN players.race_points_move IS
  'Race points this week minus last week. Null = no previous week (UI shows --).';

-- Backfill from the two most recent snapshots per (player, type).
-- Two UPDATEs: a single UPDATE FROM with both types is non-deterministic
-- when a player has official AND race rows (Postgres picks one join row).
WITH ordered AS (
  SELECT player_id, points,
    ROW_NUMBER() OVER (
      PARTITION BY player_id
      ORDER BY ranking_date DESC, year DESC, week DESC
    ) AS rn
  FROM player_ranking_snapshots
  WHERE type = 'official' AND points IS NOT NULL
),
delta AS (
  SELECT c.player_id, (c.points - p.points) AS points_move
  FROM ordered c
  JOIN ordered p ON p.player_id = c.player_id AND p.rn = 2
  WHERE c.rn = 1
)
UPDATE players pl
SET points_move = d.points_move
FROM delta d
WHERE d.player_id = pl.id;

WITH ordered AS (
  SELECT player_id, points,
    ROW_NUMBER() OVER (
      PARTITION BY player_id
      ORDER BY ranking_date DESC, year DESC, week DESC
    ) AS rn
  FROM player_ranking_snapshots
  WHERE type = 'race' AND points IS NOT NULL
),
delta AS (
  SELECT c.player_id, (c.points - p.points) AS points_move
  FROM ordered c
  JOIN ordered p ON p.player_id = c.player_id AND p.rn = 2
  WHERE c.rn = 1
)
UPDATE players pl
SET race_points_move = d.points_move
FROM delta d
WHERE d.player_id = pl.id;

-- Add FIP race ranking + official ranking movement fields
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS ranking_move   integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS race_ranking   integer,
  ADD COLUMN IF NOT EXISTS race_points    integer,
  ADD COLUMN IF NOT EXISTS race_move      integer DEFAULT 0;

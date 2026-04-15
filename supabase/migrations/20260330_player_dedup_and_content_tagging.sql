-- Phase 1: Player deduplication — add fip_id column
ALTER TABLE players ADD COLUMN IF NOT EXISTS fip_id text UNIQUE;

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_players_fip_id ON players (fip_id) WHERE fip_id IS NOT NULL;

-- Phase 2: Content tagging — junction tables

CREATE TABLE IF NOT EXISTS article_players (
  article_id uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  player_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  PRIMARY KEY (article_id, player_id)
);

CREATE TABLE IF NOT EXISTS article_tournaments (
  article_id    uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  PRIMARY KEY (article_id, tournament_id)
);

CREATE TABLE IF NOT EXISTS highlight_players (
  highlight_id uuid NOT NULL REFERENCES highlights(id) ON DELETE CASCADE,
  player_id    uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  PRIMARY KEY (highlight_id, player_id)
);

-- Indexes for reverse lookups (find content by player/tournament)
CREATE INDEX IF NOT EXISTS idx_article_players_player ON article_players (player_id);
CREATE INDEX IF NOT EXISTS idx_article_tournaments_tournament ON article_tournaments (tournament_id);
CREATE INDEX IF NOT EXISTS idx_highlight_players_player ON highlight_players (player_id);

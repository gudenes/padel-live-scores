-- tournament_draws: stores parsed bracket data from FIP draw PDFs
-- Draw entries link to players for pre-assignment before FIP scraper runs
CREATE TABLE IF NOT EXISTS tournament_draws (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('men', 'women')),
  draw_position INTEGER NOT NULL,
  seed INTEGER,
  marker TEXT CHECK (marker IN ('Q', 'WC', 'LL')),
  player1_name TEXT NOT NULL,
  player1_country TEXT,
  player1_id UUID REFERENCES players(id),
  player2_name TEXT NOT NULL,
  player2_country TEXT,
  player2_id UUID REFERENCES players(id),
  team_points INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tournament_id, category, draw_position)
);

-- Index for FIP scraper lookups (by tournament + category)
CREATE INDEX IF NOT EXISTS idx_tournament_draws_tournament_category
  ON tournament_draws(tournament_id, category);

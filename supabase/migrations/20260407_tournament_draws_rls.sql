-- Fix RLS for tournament_draws
-- Allow public read access (so the tournament page can show entry list/draw)
-- Allow service role full access (for ops dashboard seeding via service key)

-- Enable RLS if not already enabled
ALTER TABLE tournament_draws ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies to start clean
DROP POLICY IF EXISTS "Allow public read access on tournament_draws" ON tournament_draws;
DROP POLICY IF EXISTS "Public read tournament_draws" ON tournament_draws;
DROP POLICY IF EXISTS "Service role full access tournament_draws" ON tournament_draws;

-- Public can read all rows (for tournament page display)
CREATE POLICY "Public read tournament_draws"
  ON tournament_draws
  FOR SELECT
  TO public
  USING (true);

-- Service role can do anything (for ops dashboard seed APIs)
CREATE POLICY "Service role full access tournament_draws"
  ON tournament_draws
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

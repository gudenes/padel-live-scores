-- RLS for broadcast_info + broadcasters
--
-- Both tables hold public read-only data (broadcaster names, URLs,
-- country mappings) sourced from premierpadel.com's public API.
-- Anyone visiting a Premier-tier tournament page should be able to
-- read them, including anonymous users.
--
-- Without these policies, Supabase silently returned 0 rows to the
-- anon key (the browser's client) — the WhereToWatch card was loading
-- successfully but with empty arrays, so it hid itself.

-- ── broadcast_info ──────────────────────────────────────────────
ALTER TABLE broadcast_info ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read broadcast_info" ON broadcast_info;
DROP POLICY IF EXISTS "Service role full access broadcast_info" ON broadcast_info;

CREATE POLICY "Public read broadcast_info"
  ON broadcast_info
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Service role full access broadcast_info"
  ON broadcast_info
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── broadcasters ────────────────────────────────────────────────
ALTER TABLE broadcasters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read broadcasters" ON broadcasters;
DROP POLICY IF EXISTS "Service role full access broadcasters" ON broadcasters;

CREATE POLICY "Public read broadcasters"
  ON broadcasters
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Service role full access broadcasters"
  ON broadcasters
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

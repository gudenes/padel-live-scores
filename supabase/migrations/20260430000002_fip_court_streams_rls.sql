-- 20260430000002_fip_court_streams_rls.sql
--
-- Add a public read policy on fip_court_streams so the match detail
-- page's client-side resolver (browser anon key) can fetch stream data.
-- The matches-list pages already work because they resolve server-side
-- via the service role key.
--
-- fip_streams_unresolved intentionally stays locked to service role —
-- it's ops-only data (incomplete videos, parser failures) and the ops
-- API routes proxy access via the ops_token cookie.

ALTER TABLE fip_court_streams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access to fip_court_streams"
  ON fip_court_streams
  FOR SELECT
  USING (true);

-- Belt-and-suspenders: also enable RLS on the unresolved table without
-- adding any policy. Anon reads return empty (silent denial), service
-- role bypasses RLS as always.
ALTER TABLE fip_streams_unresolved ENABLE ROW LEVEL SECURITY;

-- Drop dead FIP-streams attribution tables.
--
-- The fip-streams-discover cron has never auto-attributed a row end-to-end
-- (every logged run reported newly_matched: 0 against 50 scanned videos —
-- two bugs in its matcher rejected every candidate). The 3 rows that ever
-- existed in fip_court_streams were manual operator backfills via the now-
-- deleted ops tab.
--
-- The tournament-page "Where to Watch" panel switched to query-time title-
-- token matching in PR #389 and no longer reads these tables. The per-match
-- streamTier field was set but never rendered by any UI component, so the
-- resolver that read fip_court_streams is also gone.
--
-- See PR <this PR> for the corresponding code cleanup.

DROP TABLE IF EXISTS public.fip_streams_unresolved CASCADE;
DROP TABLE IF EXISTS public.fip_court_streams CASCADE;

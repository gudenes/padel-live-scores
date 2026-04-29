-- Bump PostgREST `db_max_rows` from the default 1000 → 10000.
--
-- Diagnosed via Leiria 2026-04-29 (FIP Silver, 5,369 entry_list_snapshots):
-- the populator's `loadEntryListNameMap` issued an unranged SELECT,
-- PostgREST silently capped the response at 1000 rows, the women's
-- roster fell past the cap, every women's match failed to resolve.
-- This is a system-wide risk: 28 files read `matches`, 23 read
-- `tournaments`, 15 read `players` without explicit limits — most are
-- single-row queries by id, but the pattern is fragile.
--
-- This migration is informational — the actual setting was applied
-- via the Supabase project dashboard (Project Settings → API →
-- "Max Rows" → 10000) on 2026-04-29 because the equivalent SQL
-- (ALTER ROLE authenticator SET pgrst.db_max_rows = '10000') requires
-- superuser privileges that the migration role doesn't have on hosted
-- Supabase.
--
-- The file is committed so:
--   1. The change is tracked in git history.
--   2. A future replicate/restore pipeline knows to apply it.
--   3. New developers can find the rationale next to the code that
--      depends on it.
--
-- Defense-in-depth: code that can plausibly grow past 10k rows STILL
-- needs to use src/lib/db-paginate.ts (mirrored to padelgod). See
-- CLAUDE.md → "PostgREST 1k cap" for the project policy.

DO $$
BEGIN
  RAISE NOTICE
    'PostgREST db_max_rows configured at 10000 via Supabase dashboard '
    'on 2026-04-29. See src/lib/db-paginate.ts for the explicit-pagination '
    'helper used by code paths that exceed 10k rows.';
END $$;

-- If you're running this against a self-hosted Postgres + PostgREST
-- (not Supabase), uncomment the line below to apply the equivalent
-- setting at the role level:
--
-- ALTER ROLE authenticator SET pgrst.db_max_rows = '10000';
-- NOTIFY pgrst, 'reload config';

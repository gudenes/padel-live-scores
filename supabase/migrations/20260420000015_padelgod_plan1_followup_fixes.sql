-- Padelgod Plan 1 follow-up fixes.
-- These 5 schema changes were applied directly to production Supabase via the
-- Dashboard SQL Editor while diagnosing worker failures during Plan 2 + Plan 3
-- deployment. This migration commits them to version control so:
--   1. Fresh deployments get the same state as prod.
--   2. New dev environments don't drift.
--   3. The "what's actually in prod" question has a single source of truth.
--
-- Idempotent: applying to prod is a no-op; applying to a fresh DB brings it
-- to the post-fix state.

-- =============================================================================
-- Fix 1: Grant service_role full access to the padelgod schema
-- =============================================================================
-- Symptom that surfaced this:
--   "permission denied for schema padelgod" when worker called the
--   padelgod_tournaments_needing_widget_code() RPC.
-- Root cause:
--   Custom schemas in Supabase don't auto-grant to service_role.

GRANT USAGE ON SCHEMA padelgod TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA padelgod TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA padelgod TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA padelgod TO service_role;

-- Future tables auto-inherit the same grants
ALTER DEFAULT PRIVILEGES IN SCHEMA padelgod GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA padelgod GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA padelgod GRANT ALL ON FUNCTIONS TO service_role;

-- =============================================================================
-- Fix 2: Add last_updated_by column to tournaments + players
-- =============================================================================
-- Symptom: worker upsert failed with
--   "Could not find the 'last_updated_by' column of 'tournaments' in schema cache"
-- Root cause:
--   Plan 1 added last_updated_by only to public.matches; tournament-discovery
--   and player-rankings workers also write it.

ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS last_updated_by TEXT;
ALTER TABLE public.players     ADD COLUMN IF NOT EXISTS last_updated_by TEXT;

COMMENT ON COLUMN public.tournaments.last_updated_by IS
  'Source of the most recent UPDATE: padelapi | padelgod | manual';
COMMENT ON COLUMN public.players.last_updated_by IS
  'Source of the most recent UPDATE: padelapi | padelgod | manual';

-- =============================================================================
-- Fix 3: UNIQUE constraint on tournaments.slug (full constraint, not partial)
-- =============================================================================
-- Symptom: PostgREST onConflict failed:
--   "no unique or exclusion constraint matching the ON CONFLICT specification"
-- Root cause:
--   Plan 1 backfill added a partial UNIQUE INDEX (WHERE slug IS NOT NULL).
--   PostgREST''s upsert requires a non-partial UNIQUE constraint.
--   PostgreSQL UNIQUE treats NULLs as distinct by default, so this still
--   allows multiple Premier-padel tournaments with NULL slug.

DROP INDEX IF EXISTS public.tournaments_slug_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tournaments_slug_unique'
  ) THEN
    ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_slug_unique UNIQUE (slug);
  END IF;
END $$;

-- =============================================================================
-- Fix 4: Drop NOT NULL on legacy external_id columns
-- =============================================================================
-- Symptom: tournament insert failed:
--   "null value in column 'external_id' of relation 'tournaments' violates
--    not-null constraint"
-- Root cause:
--   external_id is a legacy column (per CLAUDE.md "deprecated, kept for
--   back-compat"). The OLD padelapi cron always wrote it. Padelgod uses
--   padelapi_id / fip_id / slug instead and has nothing meaningful for
--   external_id on FIP-sourced rows.

ALTER TABLE public.tournaments ALTER COLUMN external_id DROP NOT NULL;
ALTER TABLE public.players     ALTER COLUMN external_id DROP NOT NULL;
ALTER TABLE public.matches     ALTER COLUMN external_id DROP NOT NULL;

-- =============================================================================
-- Fix 5: Refresh PostgREST schema cache
-- =============================================================================
-- After every schema change, PostgREST''s introspection cache needs to refresh.
-- The NOTIFY is one-shot but harmless to include in the migration body.

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- Verification
-- =============================================================================
DO $$
BEGIN
  -- Fix 1: GRANTs
  ASSERT has_schema_privilege('service_role', 'padelgod', 'USAGE'),
    'service_role lacks USAGE on padelgod schema';
  ASSERT has_table_privilege('service_role', 'padelgod.scrape_jobs', 'INSERT'),
    'service_role lacks INSERT on padelgod.scrape_jobs';

  -- Fix 2: last_updated_by columns
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='tournaments' AND column_name='last_updated_by'),
    'tournaments.last_updated_by missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='players' AND column_name='last_updated_by'),
    'players.last_updated_by missing';

  -- Fix 3: full UNIQUE constraint on slug
  ASSERT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tournaments_slug_unique' AND contype = 'u'
  ), 'tournaments_slug_unique constraint missing';

  -- Fix 4: external_id nullable
  ASSERT NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='tournaments'
      AND column_name='external_id' AND is_nullable='NO'),
    'tournaments.external_id still NOT NULL';
  ASSERT NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='players'
      AND column_name='external_id' AND is_nullable='NO'),
    'players.external_id still NOT NULL';
  ASSERT NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='matches'
      AND column_name='external_id' AND is_nullable='NO'),
    'matches.external_id still NOT NULL';
END $$;

-- Padelgod foundation: tournaments gets public_id, slug (renamed from fip_slug), updated_at.
-- created_at already exists on tournaments per existing schema.

-- Step 1: Rename fip_slug → slug (tournaments.fip_slug exists from migration 20260401000000)
ALTER TABLE public.tournaments RENAME COLUMN fip_slug TO slug;

-- Step 1b: Rebuild sync_tournaments_id_columns() to use the new column name.
-- The trigger function from migration 20260407_canonical_source_ids.sql references
-- fip_slug; without this rebuild, every INSERT/UPDATE on tournaments would fail.
CREATE OR REPLACE FUNCTION sync_tournaments_id_columns() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- padelapi_id ↔ external_id (only for padelapi-sourced rows)
    IF NEW.source = 'padelapi' OR NEW.source IS NULL THEN
      IF NEW.padelapi_id IS NULL THEN NEW.padelapi_id := NEW.external_id; END IF;
      IF NEW.external_id IS NULL THEN NEW.external_id := NEW.padelapi_id; END IF;
    END IF;
    -- fip_id ↔ slug (unconditional — same concept, slug is the canonical name now)
    IF NEW.fip_id IS NULL THEN NEW.fip_id := NEW.slug; END IF;
    IF NEW.slug   IS NULL THEN NEW.slug   := NEW.fip_id; END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- padelapi_id ↔ external_id propagation
    IF NEW.source = 'padelapi' OR NEW.source IS NULL THEN
      IF NEW.padelapi_id IS DISTINCT FROM OLD.padelapi_id
         AND NEW.external_id IS NOT DISTINCT FROM OLD.external_id THEN
        NEW.external_id := NEW.padelapi_id;
      ELSIF NEW.external_id IS DISTINCT FROM OLD.external_id
         AND NEW.padelapi_id IS NOT DISTINCT FROM OLD.padelapi_id THEN
        NEW.padelapi_id := NEW.external_id;
      END IF;
    END IF;
    -- fip_id ↔ slug propagation
    IF NEW.fip_id IS DISTINCT FROM OLD.fip_id
       AND NEW.slug IS NOT DISTINCT FROM OLD.slug THEN
      NEW.slug := NEW.fip_id;
    ELSIF NEW.slug IS DISTINCT FROM OLD.slug
       AND NEW.fip_id IS NOT DISTINCT FROM OLD.fip_id THEN
      NEW.fip_id := NEW.slug;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 2: Add public_id (DEFAULT generates one per row at insert; backfill in Task 18)
ALTER TABLE public.tournaments
  ADD COLUMN public_id TEXT DEFAULT public.public_id('tour');

-- Note: UNIQUE + NOT NULL constraints applied AFTER backfill in Task 18.

-- Step 3: Add updated_at (created_at already present)
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Step 4: Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS trg_tournaments_updated_at ON public.tournaments;
CREATE TRIGGER trg_tournaments_updated_at
  BEFORE UPDATE ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Verification
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tournaments' AND column_name = 'slug'
  ), 'tournaments.slug column missing';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tournaments' AND column_name = 'public_id'
  ), 'tournaments.public_id column missing';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tournaments' AND column_name = 'updated_at'
  ), 'tournaments.updated_at column missing';

  ASSERT NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tournaments' AND column_name = 'fip_slug'
  ), 'tournaments.fip_slug should have been renamed to slug';

  -- Confirm sync_tournaments_id_columns no longer references fip_slug
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'sync_tournaments_id_columns'
      AND pg_get_functiondef(p.oid) LIKE '%fip_slug%'
  ), 'sync_tournaments_id_columns() still references fip_slug — must be rebuilt to use slug';
END $$;

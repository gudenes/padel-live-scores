-- Padelgod foundation: tournaments gets public_id, slug (renamed from fip_slug), updated_at.
-- created_at already exists on tournaments per existing schema.

-- Step 1: Rename fip_slug → slug (tournaments.fip_slug exists from migration 20260401000000)
ALTER TABLE public.tournaments RENAME COLUMN fip_slug TO slug;

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
END $$;

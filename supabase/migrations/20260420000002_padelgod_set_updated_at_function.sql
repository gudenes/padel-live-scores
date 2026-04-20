-- Padelgod foundation: shared trigger function to keep updated_at in sync on every UPDATE.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.set_updated_at() IS
  'Trigger function: sets NEW.updated_at = NOW() on every UPDATE. Apply via BEFORE UPDATE trigger on every entity table.';

-- Verification
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'set_updated_at'
      AND pronamespace = 'public'::regnamespace
  ), 'public.set_updated_at() function not found';
END $$;

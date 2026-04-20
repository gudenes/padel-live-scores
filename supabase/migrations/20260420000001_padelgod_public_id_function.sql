-- Padelgod foundation: public_id() function generates Stripe-style prefixed nanoid IDs.
-- Format: {prefix}_{12 base62 chars}, e.g., 'tour_8Kx3mPq2RvN5'.

CREATE OR REPLACE FUNCTION public.public_id(prefix TEXT)
RETURNS TEXT AS $$
DECLARE
  alphabet CONSTANT TEXT := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  result TEXT := '';
  i INT;
BEGIN
  FOR i IN 1..12 LOOP
    result := result || substr(alphabet, 1 + floor(random() * 62)::int, 1);
  END LOOP;
  RETURN prefix || '_' || result;
END;
$$ LANGUAGE plpgsql VOLATILE;

COMMENT ON FUNCTION public.public_id(TEXT) IS
  'Generates Padelgod public IDs in format {prefix}_{12-char base62}. Used as DEFAULT on entity public_id columns.';

-- Verification: ensure function exists and produces correctly-formatted IDs
DO $$
DECLARE
  sample TEXT;
BEGIN
  sample := public.public_id('tst');
  ASSERT length(sample) = 16, format('Expected length 16, got %s for sample %L', length(sample), sample);
  ASSERT sample LIKE 'tst\_%' ESCAPE '\', format('Expected prefix tst_, got %L', sample);
END $$;

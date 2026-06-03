-- supabase/migrations/20260603010000_ad_banners_multi_country.sql
-- A banner may now target MULTIPLE countries. Replace the single country_code
-- with a country_codes TEXT[] (empty array = global default). Data-preserving.

ALTER TABLE ad_banners ADD COLUMN IF NOT EXISTS country_codes TEXT[] NOT NULL DEFAULT '{}';

-- Backfill existing rows from the single column (NULL/'' -> global = '{}').
UPDATE ad_banners
SET country_codes = CASE
  WHEN country_code IS NULL OR country_code = '' THEN '{}'::text[]
  ELSE ARRAY[country_code]
END
WHERE country_codes = '{}'::text[];

ALTER TABLE ad_banners DROP COLUMN IF EXISTS country_code;

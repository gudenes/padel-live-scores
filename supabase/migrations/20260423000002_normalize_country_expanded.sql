-- 20260423000002_normalize_country_expanded.sql
--
-- Follow-up to 20260423000001. The first migration's mapping was
-- incomplete — it missed ~12 FIFA-style aliases that padelfip.com
-- and matchscorerlive.com emit in production (RUS, INA, SIN, PAK,
-- KOS, NGR, GEO, BRN, LIT, ARM, AZE, ALG, KAZ). Rows holding those
-- codes were silently left as alpha-3.
--
-- This migration uses the expanded CASE that matches
-- `/shared/country-codes-3to2.json`. Keep the two in sync — a drift
-- test in `src/lib/__tests__/country-map-sync.test.ts` asserts the
-- TS side stays aligned; this SQL is edited by hand when the JSON
-- grows.
--
-- Idempotent. Safe to re-run after any further write-path fixes or
-- accidental alpha-3 leaks during Railway/Vercel rollouts.
--
-- Tables:
--   public.players.country
--   public.tournaments.country
--   padelgod.entry_list_snapshots.country
--   padelgod.draw_snapshots.team1_country
--   padelgod.draw_snapshots.team2_country
--
-- Rollback: no undo — mappings are lossy (POR and PRT both → PT).
-- But the write-side normalizer is deterministic, so re-applying
-- after a hypothetical rollback gives identical results.

BEGIN;

-- ── Temp mapping function ────────────────────────────────────────────
-- pg_temp is session-local; dropped automatically at COMMIT.
-- Mirrors the full /shared/country-codes-3to2.json map.
CREATE OR REPLACE FUNCTION pg_temp.alpha3_to_alpha2(code text) RETURNS text AS $$
BEGIN
  IF code IS NULL OR length(trim(code)) = 0 THEN
    RETURN NULL;
  END IF;
  IF length(trim(code)) = 2 THEN
    RETURN upper(trim(code));
  END IF;
  RETURN CASE upper(trim(code))
    -- A
    WHEN 'AND' THEN 'AD'
    WHEN 'ARE' THEN 'AE' WHEN 'UAE' THEN 'AE'
    WHEN 'ARM' THEN 'AM'
    WHEN 'ARG' THEN 'AR'
    WHEN 'AUT' THEN 'AT'
    WHEN 'AUS' THEN 'AU'
    WHEN 'AZE' THEN 'AZ'
    -- B
    WHEN 'BEL' THEN 'BE'
    WHEN 'BHR' THEN 'BH' WHEN 'BRN' THEN 'BH'
    WHEN 'BOL' THEN 'BO'
    WHEN 'BRA' THEN 'BR'
    WHEN 'BUL' THEN 'BG' WHEN 'BGR' THEN 'BG'
    -- C
    WHEN 'CAN' THEN 'CA'
    WHEN 'CHE' THEN 'CH' WHEN 'SUI' THEN 'CH'
    WHEN 'CIV' THEN 'CI'
    WHEN 'CHL' THEN 'CL' WHEN 'CHI' THEN 'CL'
    WHEN 'CMR' THEN 'CM'
    WHEN 'CHN' THEN 'CN'
    WHEN 'COL' THEN 'CO'
    WHEN 'CRI' THEN 'CR' WHEN 'CRC' THEN 'CR'
    WHEN 'CUB' THEN 'CU'
    WHEN 'CYP' THEN 'CY'
    WHEN 'CZE' THEN 'CZ'
    -- D
    WHEN 'DEU' THEN 'DE' WHEN 'GER' THEN 'DE'
    WHEN 'DNK' THEN 'DK' WHEN 'DEN' THEN 'DK'
    WHEN 'DOM' THEN 'DO'
    WHEN 'ALG' THEN 'DZ'
    -- E
    WHEN 'ECU' THEN 'EC'
    WHEN 'EST' THEN 'EE'
    WHEN 'EGY' THEN 'EG'
    WHEN 'ESA' THEN 'SV'
    WHEN 'ESP' THEN 'ES'
    -- F
    WHEN 'FIN' THEN 'FI'
    WHEN 'FRA' THEN 'FR'
    -- G
    WHEN 'GBR' THEN 'GB'
    WHEN 'GEO' THEN 'GE'
    WHEN 'GHA' THEN 'GH'
    WHEN 'GRC' THEN 'GR' WHEN 'GRE' THEN 'GR'
    WHEN 'GTM' THEN 'GT'
    WHEN 'GUY' THEN 'GY'
    -- H
    WHEN 'HKG' THEN 'HK'
    WHEN 'HON' THEN 'HN'
    WHEN 'HRV' THEN 'HR' WHEN 'CRO' THEN 'HR'
    WHEN 'HUN' THEN 'HU'
    -- I
    WHEN 'IDN' THEN 'ID' WHEN 'INA' THEN 'ID'
    WHEN 'IRL' THEN 'IE'
    WHEN 'ISR' THEN 'IL'
    WHEN 'IND' THEN 'IN'
    WHEN 'ISL' THEN 'IS'
    WHEN 'ITA' THEN 'IT'
    -- J
    WHEN 'JAM' THEN 'JM'
    WHEN 'JPN' THEN 'JP'
    -- K
    WHEN 'KEN' THEN 'KE'
    WHEN 'KOR' THEN 'KR'
    WHEN 'KOS' THEN 'XK'
    WHEN 'KSA' THEN 'SA' WHEN 'SAU' THEN 'SA'
    WHEN 'KAZ' THEN 'KZ'
    -- L
    WHEN 'LAT' THEN 'LV' WHEN 'LVA' THEN 'LV'
    WHEN 'LTU' THEN 'LT' WHEN 'LIT' THEN 'LT'
    WHEN 'LUX' THEN 'LU'
    -- M
    WHEN 'MAR' THEN 'MA'
    WHEN 'MLT' THEN 'MT'
    WHEN 'MEX' THEN 'MX'
    WHEN 'MAS' THEN 'MY'
    WHEN 'MON' THEN 'MC'
    -- N
    WHEN 'NCA' THEN 'NI'
    WHEN 'NED' THEN 'NL' WHEN 'NLD' THEN 'NL'
    WHEN 'NOR' THEN 'NO'
    WHEN 'NZL' THEN 'NZ'
    WHEN 'NGA' THEN 'NG' WHEN 'NGR' THEN 'NG'
    -- P
    WHEN 'PAK' THEN 'PK'
    WHEN 'PAN' THEN 'PA'
    WHEN 'PER' THEN 'PE'
    WHEN 'PHI' THEN 'PH'
    WHEN 'POL' THEN 'PL'
    WHEN 'PRT' THEN 'PT' WHEN 'POR' THEN 'PT'
    WHEN 'PAR' THEN 'PY' WHEN 'PRY' THEN 'PY'
    -- Q
    WHEN 'QAT' THEN 'QA'
    -- R
    WHEN 'ROM' THEN 'RO' WHEN 'ROU' THEN 'RO'
    WHEN 'SRB' THEN 'RS'
    WHEN 'RUS' THEN 'RU'
    -- S
    WHEN 'SEN' THEN 'SN'
    WHEN 'SGP' THEN 'SG' WHEN 'SIN' THEN 'SG'
    WHEN 'SVK' THEN 'SK'
    WHEN 'SLO' THEN 'SI' WHEN 'SVN' THEN 'SI'
    WHEN 'SUR' THEN 'SR'
    WHEN 'SWE' THEN 'SE'
    -- T
    WHEN 'TTO' THEN 'TT'
    WHEN 'TUN' THEN 'TN'
    WHEN 'TUR' THEN 'TR'
    WHEN 'TWN' THEN 'TW'
    WHEN 'THA' THEN 'TH'
    -- U
    WHEN 'UKR' THEN 'UA'
    WHEN 'URY' THEN 'UY' WHEN 'URU' THEN 'UY'
    WHEN 'USA' THEN 'US'
    -- V
    WHEN 'VEN' THEN 'VE'
    -- Z
    WHEN 'RSA' THEN 'ZA' WHEN 'ZAF' THEN 'ZA'
    -- Unknown: return NULL so the forthcoming CHECK constraint
    -- doesn't reject the row. Surfaces in data-quality views.
    ELSE NULL
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ── Apply normalization (idempotent — only touches >2-char rows) ─────

UPDATE public.players
SET country = pg_temp.alpha3_to_alpha2(country)
WHERE country IS NOT NULL AND length(country) > 2;

UPDATE public.tournaments
SET country = pg_temp.alpha3_to_alpha2(country)
WHERE country IS NOT NULL AND length(country) > 2;

UPDATE padelgod.entry_list_snapshots
SET country = pg_temp.alpha3_to_alpha2(country)
WHERE country IS NOT NULL AND length(country) > 2;

UPDATE padelgod.draw_snapshots
SET team1_country = pg_temp.alpha3_to_alpha2(team1_country)
WHERE team1_country IS NOT NULL AND length(team1_country) > 2;

UPDATE padelgod.draw_snapshots
SET team2_country = pg_temp.alpha3_to_alpha2(team2_country)
WHERE team2_country IS NOT NULL AND length(team2_country) > 2;

COMMIT;

-- ── Post-apply sanity check (comment below to use) ────────────────────
--
-- Expected: all counts are 0 after applying AND after Vercel/Railway
-- are both on post-normalization code. If any counts are > 0, it means
-- a new write path is leaking alpha-3 that we haven't normalized yet.
--
-- SELECT 'players' AS tbl, count(*) FROM public.players WHERE length(country) > 2
-- UNION ALL SELECT 'tournaments', count(*) FROM public.tournaments WHERE length(country) > 2
-- UNION ALL SELECT 'entry_list_snapshots', count(*) FROM padelgod.entry_list_snapshots WHERE length(country) > 2
-- UNION ALL SELECT 'draw_snapshots.t1', count(*) FROM padelgod.draw_snapshots WHERE length(team1_country) > 2
-- UNION ALL SELECT 'draw_snapshots.t2', count(*) FROM padelgod.draw_snapshots WHERE length(team2_country) > 2;

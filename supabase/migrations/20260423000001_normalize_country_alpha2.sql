-- 20260423000001_normalize_country_alpha2.sql
--
-- One-time backfill: normalize every `country` column we own to ISO
-- 3166-1 alpha-2. Prior to this migration the column was a mixed bag —
-- padelapi sync wrote alpha-2 ("ES"), FIP-sourced writes (padelgod
-- scrapers + FIP PDF pipeline) wrote alpha-3 ("ESP"), so roughly 90%
-- of player rows held alpha-3 while 10% held alpha-2. Flag-emoji
-- rendering needs alpha-2, and joins/filters couldn't rely on a single
-- format.
--
-- Write-time normalization is landed in the same PR (padelgod parsers
-- + fip-entry-list-persist), so from this point on new writes always
-- arrive alpha-2. This migration just cleans up the historical rows.
--
-- Tables touched:
--   - public.players.country
--   - public.tournaments.country
--   - padelgod.entry_list_snapshots.country
--   - padelgod.draw_snapshots.team1_country, team2_country
--
-- Tables NOT touched:
--   - padelgod.oop_snapshots — no country column
--   - padelgod.results_snapshots — no country column
--   - padelgod.widget_id_cache — no country column
--
-- Strategy: inline CASE expression. Covers every 3-letter code seen in
-- production data today plus common FIFA-style aliases FIP occasionally
-- emits (POR, NED, GER, SUI, CRO, RSA…). Unknown 3-letter inputs pass
-- through unchanged so we can surface them in ops data-quality checks.
--
-- Rollback: there's no undo — alpha-3 → alpha-2 is lossy (POR and PRT
-- both map to PT, for example). But every target format is ISO-valid
-- and the write-side normalizer is deterministic, so a re-apply after
-- a hypothetical rollback would produce identical results.

BEGIN;

-- ── Shared mapping function (session-local, dropped at end) ──────────
--
-- A temp function keeps the six UPDATE statements DRY without leaving
-- permanent functions behind. We inline the same table as
-- `padelgod/src/lib/country.ts` CC3_TO_CC2 — keep them in sync if you
-- add codes.

CREATE OR REPLACE FUNCTION pg_temp.alpha3_to_alpha2(code text) RETURNS text AS $$
BEGIN
  IF code IS NULL OR length(trim(code)) = 0 THEN
    RETURN NULL;
  END IF;
  -- Already alpha-2 → pass through upper-cased
  IF length(trim(code)) = 2 THEN
    RETURN upper(trim(code));
  END IF;
  RETURN CASE upper(trim(code))
    -- Iberia + Americas
    WHEN 'ESP' THEN 'ES' WHEN 'ARG' THEN 'AR' WHEN 'BRA' THEN 'BR'
    WHEN 'PRT' THEN 'PT' WHEN 'POR' THEN 'PT'
    WHEN 'URY' THEN 'UY' WHEN 'URU' THEN 'UY'
    WHEN 'PRY' THEN 'PY' WHEN 'PAR' THEN 'PY'
    WHEN 'CHL' THEN 'CL' WHEN 'CHI' THEN 'CL'
    WHEN 'MEX' THEN 'MX' WHEN 'USA' THEN 'US'
    WHEN 'COL' THEN 'CO' WHEN 'PER' THEN 'PE'
    WHEN 'CRI' THEN 'CR' WHEN 'CRC' THEN 'CR'
    WHEN 'ECU' THEN 'EC' WHEN 'BOL' THEN 'BO'
    -- Western Europe
    WHEN 'FRA' THEN 'FR' WHEN 'ITA' THEN 'IT' WHEN 'BEL' THEN 'BE'
    WHEN 'NLD' THEN 'NL' WHEN 'NED' THEN 'NL'
    WHEN 'DEU' THEN 'DE' WHEN 'GER' THEN 'DE'
    WHEN 'GBR' THEN 'GB' WHEN 'DNK' THEN 'DK' WHEN 'DEN' THEN 'DK'
    WHEN 'SWE' THEN 'SE' WHEN 'FIN' THEN 'FI' WHEN 'NOR' THEN 'NO'
    WHEN 'AUT' THEN 'AT' WHEN 'CHE' THEN 'CH' WHEN 'SUI' THEN 'CH'
    WHEN 'IRL' THEN 'IE' WHEN 'GRC' THEN 'GR' WHEN 'GRE' THEN 'GR'
    -- Central/Eastern Europe
    WHEN 'POL' THEN 'PL' WHEN 'CZE' THEN 'CZ'
    WHEN 'HRV' THEN 'HR' WHEN 'CRO' THEN 'HR'
    WHEN 'ROU' THEN 'RO' WHEN 'UKR' THEN 'UA'
    -- Middle East + Africa
    WHEN 'QAT' THEN 'QA' WHEN 'ARE' THEN 'AE' WHEN 'UAE' THEN 'AE'
    WHEN 'EGY' THEN 'EG' WHEN 'SAU' THEN 'SA' WHEN 'BHR' THEN 'BH'
    WHEN 'KWT' THEN 'KW' WHEN 'MAR' THEN 'MA'
    WHEN 'ZAF' THEN 'ZA' WHEN 'RSA' THEN 'ZA'
    -- Asia-Pacific
    WHEN 'JPN' THEN 'JP' WHEN 'KOR' THEN 'KR' WHEN 'CHN' THEN 'CN'
    WHEN 'IND' THEN 'IN' WHEN 'AUS' THEN 'AU'
    -- Unknown 3-letter → pass through upper-cased (surfaces in ops
    -- data-quality view; won't render a flag but stays queryable)
    ELSE upper(trim(code))
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ── public.players ────────────────────────────────────────────────────
-- Only touch rows where normalization actually changes the value.

UPDATE public.players
SET country = pg_temp.alpha3_to_alpha2(country)
WHERE country IS NOT NULL
  AND country <> pg_temp.alpha3_to_alpha2(country);

-- ── public.tournaments ────────────────────────────────────────────────

UPDATE public.tournaments
SET country = pg_temp.alpha3_to_alpha2(country)
WHERE country IS NOT NULL
  AND country <> pg_temp.alpha3_to_alpha2(country);

-- ── padelgod.entry_list_snapshots ─────────────────────────────────────

UPDATE padelgod.entry_list_snapshots
SET country = pg_temp.alpha3_to_alpha2(country)
WHERE country IS NOT NULL
  AND country <> pg_temp.alpha3_to_alpha2(country);

-- ── padelgod.draw_snapshots (team1 + team2) ───────────────────────────

UPDATE padelgod.draw_snapshots
SET team1_country = pg_temp.alpha3_to_alpha2(team1_country)
WHERE team1_country IS NOT NULL
  AND team1_country <> pg_temp.alpha3_to_alpha2(team1_country);

UPDATE padelgod.draw_snapshots
SET team2_country = pg_temp.alpha3_to_alpha2(team2_country)
WHERE team2_country IS NOT NULL
  AND team2_country <> pg_temp.alpha3_to_alpha2(team2_country);

COMMIT;

-- ── Post-apply sanity check (read-only, informational) ────────────────
-- Run this after the migration lands to confirm no rows were missed
-- and to surface any unknown-code passthrough that needs a mapping
-- entry in `padelgod/src/lib/country.ts`.
--
-- Expected: all counts go to 0 for columns we own.
--
-- SELECT 'players'               AS table, count(*) FROM public.players               WHERE length(country) > 2
-- UNION ALL SELECT 'tournaments',            count(*) FROM public.tournaments          WHERE length(country) > 2
-- UNION ALL SELECT 'entry_list_snapshots',   count(*) FROM padelgod.entry_list_snapshots WHERE length(country) > 2
-- UNION ALL SELECT 'draw_snapshots.t1',      count(*) FROM padelgod.draw_snapshots     WHERE length(team1_country) > 2
-- UNION ALL SELECT 'draw_snapshots.t2',      count(*) FROM padelgod.draw_snapshots     WHERE length(team2_country) > 2;

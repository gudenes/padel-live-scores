-- Backfill tournaments.level for FIP-source rows whose level is null or
-- bucketed as the legacy 'fip_other' code.
--
-- Why: padelgod's tournament-discovery worker now sets level from the WP
-- `category-event` taxonomy (see padelgod/src/lib/fip-categories.ts), but
-- existing rows were either ingested with `level=null` (padelgod path) or
-- collapsed into 'fip_other' (legacy Vercel scraper path). This one-shot
-- backfill recategorizes them by slug pattern so the new tier weighting
-- (src/lib/tournament-labels.ts::levelTierWeight) sorts them correctly.
--
-- The next padelgod discovery run will refresh `level` from authoritative
-- WP data, so this just gets the surface in good shape immediately
-- instead of waiting for the worker tick.

UPDATE public.tournaments
SET level = CASE
  WHEN slug LIKE 'fip-platinum-%'  THEN 'fip_platinum'
  WHEN slug LIKE 'fip-gold-%'      THEN 'fip_gold'
  WHEN slug LIKE 'fip-silver-%'    THEN 'fip_silver'
  WHEN slug LIKE 'fip-bronze-%'    THEN 'fip_bronze'
  WHEN slug LIKE 'fip-bronzr-%'    THEN 'fip_bronze' -- typo in FIP CMS (Sassuolo)
  WHEN slug LIKE 'fip-broze-%'     THEN 'fip_bronze' -- typo (Indonesia)
  WHEN slug LIKE 'fip-star-%'      THEN 'fip_star'
  WHEN slug LIKE 'fip-rise-%'      THEN 'fip_rise'
  WHEN slug LIKE 'fip-promotion-%' THEN 'fip_promotion'
  WHEN slug LIKE 'fip-promises-%'  THEN 'fip_promises'
  WHEN slug LIKE 'fip-beyond-%'    THEN 'fip_beyond'
  WHEN slug LIKE 'hexagon-%'       THEN 'fip_hexagon'
  WHEN slug LIKE 'fip-world-cup%'        THEN 'fip_championship'
  WHEN slug LIKE 'fip-senior-world-%'    THEN 'fip_championship'
  WHEN slug LIKE 'fip-junior-%'          THEN 'fip_championship'
  WHEN slug LIKE 'fip-juniors-%'         THEN 'fip_championship'
  WHEN slug LIKE 'fip-euro-%'            THEN 'fip_championship'
  WHEN slug LIKE 'fip-international-padel%' THEN 'fip_championship'
  WHEN slug LIKE 'fip-team-cup%'         THEN 'fip_championship'
  ELSE level
END
WHERE source = 'fip'
  AND (level IS NULL OR level = 'fip_other');

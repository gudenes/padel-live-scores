-- Correct the Where-to-Watch geo seed using live YouTube regionRestriction data
-- (checked 2026-06-09 across the last 50 uploads per channel).
--
-- Findings:
--   FIP Tour      — only Russia + Belarus restricted (loose); not worth managing.
--   Premier Padel — a large, stable footprint blocked in ~90% of restricted
--                   uploads: all of Latin America + the Caribbean, plus Italy,
--                   Portugal, Croatia, San Marino, Vatican and Russia.
--
-- The original migration seeded BOTH channels with a guessed 20-country LatAm
-- list. This replaces that with reality: drop the FIP seed, and reseed Premier
-- from the observed set. Only `source='seed'` rows are touched — any operator
-- ('manual') rows are preserved.

-- 1. FIP: remove the incorrect LatAm seed (we no longer seed FIP blocks).
DELETE FROM channel_region_rules
WHERE source = 'seed'
  AND channel_id IN (SELECT id FROM youtube_channels WHERE abbreviation = 'FIP');

-- 2. Premier: replace the guessed seed with the observed restriction set.
DELETE FROM channel_region_rules
WHERE source = 'seed'
  AND channel_id IN (SELECT id FROM youtube_channels WHERE abbreviation = 'PP');

INSERT INTO channel_region_rules (channel_id, country_iso2, effect, source, note)
SELECT c.id, x.cc, 'block', 'seed', 'Geo-restricted on YouTube (observed 2026-06-09)'
FROM youtube_channels c
CROSS JOIN (VALUES
  -- Russia
  ('ru'),
  -- Latin America (mainland)
  ('ar'),('bo'),('br'),('cl'),('co'),('cr'),('ec'),('gt'),('gy'),('hn'),
  ('mx'),('ni'),('pa'),('pe'),('py'),('sr'),('sv'),('uy'),('ve'),('gf'),
  -- Caribbean (islands + territories)
  ('ag'),('ai'),('aw'),('bb'),('bm'),('bs'),('cw'),('dm'),('do'),('fk'),
  ('gd'),('gp'),('ht'),('jm'),('ky'),('lc'),('mf'),('mq'),('ms'),('tc'),
  ('tt'),('vg'),
  -- Europe (local-rights territories)
  ('it'),('pt'),('hr'),('sm'),('va')
) AS x(cc)
WHERE c.abbreviation = 'PP'
ON CONFLICT (channel_id, country_iso2) DO NOTHING;

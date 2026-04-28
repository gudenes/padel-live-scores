-- Country code support on padelgod.oop_snapshots. Pairs with the
-- crionet-oop parser update that extracts country from the flag image
-- src ("/images/flags/INA.jpg" → "INA"), and the public.matches
-- pair*_player*_country columns added in
-- 20260428000003_matches_unresolved_player_countries.sql.
--
-- Stored as the verbatim 3-letter IOC/FIP code from the widget. Same
-- normalisation policy as `players.country` — alpha-3 / alpha-2 mix
-- handled at render time by the public app's countryFlag() helper.
--
-- All four columns are nullable. Pre-existing rows will be NULL until
-- the next OOP fetch overwrites them; the populator's amateur-tier
-- thin-match path tolerates NULLs (it keeps reading the latest row
-- per match_widget_id, which the next scrape refreshes).

ALTER TABLE padelgod.oop_snapshots
  ADD COLUMN IF NOT EXISTS team1_player1_country TEXT,
  ADD COLUMN IF NOT EXISTS team1_player2_country TEXT,
  ADD COLUMN IF NOT EXISTS team2_player1_country TEXT,
  ADD COLUMN IF NOT EXISTS team2_player2_country TEXT;

COMMENT ON COLUMN padelgod.oop_snapshots.team1_player1_country IS
  'IOC/FIP country code (3-letter, e.g. INA / HKG / ESP) parsed from '
  'the widget''s flag image filename. Captured per scrape; NULL when '
  'the row''s <img class="flags"> had no src (rare — happens on the '
  'very first hydration before the static HTML loads).';

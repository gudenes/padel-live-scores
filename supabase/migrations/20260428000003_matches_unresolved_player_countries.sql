-- Country code support for thin-match (amateur tier) players. Pairs
-- with the pair*_player*_name columns added in the previous migration
-- (20260428000002_matches_unresolved_player_names.sql).
--
-- Without this, thin matches render player names but no flag — the UI
-- has no country to feed into countryFlag(). The OOP widget on
-- matchscorerlive.com always carries the country in the flag image
-- filename (e.g. /images/flags/INA.jpg → "INA"), so we capture it at
-- scrape time and write it alongside the name.
--
-- Stored as a 3-letter IOC/FIP code (ESP, INA, HKG, …) — the same
-- representation `players.country` uses today. The UI's countryFlag()
-- helper already handles alpha-3 and alpha-2 transparently.

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS pair1_player1_country TEXT,
  ADD COLUMN IF NOT EXISTS pair1_player2_country TEXT,
  ADD COLUMN IF NOT EXISTS pair2_player1_country TEXT,
  ADD COLUMN IF NOT EXISTS pair2_player2_country TEXT;

COMMENT ON COLUMN public.matches.pair1_player1_country IS
  'IOC/FIP country code (3-letter, e.g. INA / HKG / ESP) captured by '
  'padelgod''s fip-draw-populator from the OOP widget''s flag image '
  'filename. Populated only for amateur-tier (Beyond/Promises/Other) '
  'thin matches where pair1_player1_id is NULL — the matching FK player '
  'in public.players already carries its own country. UI''s '
  'countryFlag() reads this as a fallback when the FK is null.';

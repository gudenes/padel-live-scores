-- Normalise three non-ISO country codes that snuck into players.country.
-- Confirmed by inspecting the affected players' names:
--   KA → KZ (Kazakhstan)     — 12 players with Kazakh names
--                              (Adilyar Muzdybayev, Zhanibek Umbetov, …)
--   TU → TR (Turkey)          — 7 players with Turkish names
--                              (Selahattin Yazar, Nihal Cetinkaya, …)
--   UK → UA (Ukraine — NOT GB) — 9 players with Ukrainian names
--                              (Bohdan Levchuk, Olena Kyrpot, …)
--                              "UK" here was an ad-hoc abbreviation for
--                              Ukraine, not an ISO code for the UK.
--
-- After this runs, every player country code in the DB resolves to a
-- valid ISO 3166-1 alpha-2, which means the FlagImage CDN fallback
-- (flagcdn.com) produces a real flag for every player.

BEGIN;

UPDATE players SET country = 'KZ' WHERE country = 'KA';
UPDATE players SET country = 'TR' WHERE country = 'TU';
UPDATE players SET country = 'UA' WHERE country = 'UK';

-- Verification — rowcounts should be 12, 7, 9 respectively.
-- Uncomment to inspect:
--   SELECT country, COUNT(*) FROM players
--   WHERE country IN ('KA','TU','UK','KZ','TR','UA')
--   GROUP BY country ORDER BY country;

COMMIT;

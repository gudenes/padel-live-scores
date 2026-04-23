-- 20260423000003_country_alpha2_check.sql
--
-- Guardrail: add CHECK constraints on every `country`-holding column
-- so future alpha-3 leaks fail loudly instead of silently corrupting
-- the column format.
--
-- Apply AFTER 20260423000002_normalize_country_expanded.sql has been
-- applied AND verified clean via the post-apply sanity SELECT (all
-- counts = 0). Also verify both Vercel (Next.js) and Railway
-- (padelgod) are on post-normalization code — otherwise a still-old
-- cron tick would hard-fail on its next write attempt.
--
-- Rollback
-- --------
-- If an unmapped 3-letter code sneaks through (new country we haven't
-- mapped), the write fails with:
--   "new row for relation X violates check constraint Y"
-- The Railway/Vercel cron will log the unknown code (the normalizer
-- emits `console.warn [country] unknown code "XYZ"`). Add the code
-- to `/shared/country-codes-3to2.json` + the padelgod duplicate, ship
-- the PR, and the next write succeeds.
--
-- To temporarily remove a constraint without redeploying:
--   ALTER TABLE <table> DROP CONSTRAINT <name>;
--
-- NOTE: `tournament_draws.player1_country` and
-- `tournament_draws.player2_country` already hold 100% alpha-2
-- (verified via audit). Including them for completeness.

BEGIN;

-- Core player + tournament rows
ALTER TABLE public.players
  ADD CONSTRAINT players_country_alpha2_check
  CHECK (country IS NULL OR length(country) = 2);

ALTER TABLE public.tournaments
  ADD CONSTRAINT tournaments_country_alpha2_check
  CHECK (country IS NULL OR length(country) = 2);

-- Tournament draws (canonical brackets)
ALTER TABLE public.tournament_draws
  ADD CONSTRAINT tournament_draws_player1_country_alpha2_check
  CHECK (player1_country IS NULL OR length(player1_country) = 2);

ALTER TABLE public.tournament_draws
  ADD CONSTRAINT tournament_draws_player2_country_alpha2_check
  CHECK (player2_country IS NULL OR length(player2_country) = 2);

-- Padelgod scrape snapshots
ALTER TABLE padelgod.entry_list_snapshots
  ADD CONSTRAINT entry_list_snapshots_country_alpha2_check
  CHECK (country IS NULL OR length(country) = 2);

ALTER TABLE padelgod.draw_snapshots
  ADD CONSTRAINT draw_snapshots_team1_country_alpha2_check
  CHECK (team1_country IS NULL OR length(team1_country) = 2);

ALTER TABLE padelgod.draw_snapshots
  ADD CONSTRAINT draw_snapshots_team2_country_alpha2_check
  CHECK (team2_country IS NULL OR length(team2_country) = 2);

COMMIT;

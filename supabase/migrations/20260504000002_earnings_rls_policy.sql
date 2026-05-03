-- Public read policy for player_tournament_earnings.
--
-- PR 2B's migration enabled RLS by Supabase default but added no
-- policies, blocking anon SELECT entirely (silent failure — the player
-- profile tiles in PR 2C would render €0 for everyone).
--
-- Mirrors the pattern on public.players ("Public read players" with
-- USING (true)). Earnings are derived from public match data and
-- public prize-money rulebooks, so they're equally public.
--
-- Writes are restricted to the service-role key by default (the policy
-- below only opens SELECT), which is what we want — the backfill
-- script uses SUPABASE_SERVICE_KEY and bypasses RLS.

BEGIN;

CREATE POLICY "Public read player_tournament_earnings"
  ON public.player_tournament_earnings
  FOR SELECT
  USING (true);

COMMIT;

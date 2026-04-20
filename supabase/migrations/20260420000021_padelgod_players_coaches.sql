-- Padelgod fast-follow: surface FIP player coaches on the players table.
-- FIP exposes one or more coach names per player on the .overview__coaches element.
-- V1 stores them as a simple TEXT[] — V2 could normalize into a coaches + player_coaches
-- pair of tables if we later want queryable coach-level analytics.

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS coaches TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.players.coaches IS
  'Current coaches for the player (from FIP profile page). Overwritten on each profile sync. Empty array if unknown / none listed.';

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='players' AND column_name='coaches'
  ), 'players.coaches column missing';
END $$;

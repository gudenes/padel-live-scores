-- supabase/migrations/20260607110000_projection_predicted_finish_round.sql
-- Frozen pre-tournament projected-finish round for the Road to Trophy.
--
-- The projection worker recomputes the live "projected to reach {round}" call
-- every run, so it drifts as results land. To grade whether the model's call
-- was right once a pair's run ends, we freeze the FIRST prediction here and
-- never overwrite it (the worker carries it forward across its delete+insert
-- refresh). Stored as the round code: 'R64' | 'R32' | 'R16' | 'QF' | 'SF' | 'F'.
alter table public.tournament_projections
  add column if not exists predicted_finish_round text;

comment on column public.tournament_projections.predicted_finish_round is
  'Frozen-once projected finish round (deepest >=50% at first capture). Used to grade the model''s Road-to-Trophy call after the fact. Never overwritten once set.';

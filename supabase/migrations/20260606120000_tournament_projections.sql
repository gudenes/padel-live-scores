-- supabase/migrations/20260606120000_tournament_projections.sql
-- Per-pair tournament projections for the "Road to Trophy" / Projection feature.
-- Computed hourly by padelgod's tournament-projection-snapshot worker from the
-- Elo model + a bracket-structure-aware Monte-Carlo simulation.
-- Public-readable (the public Projection tab reads with the anon key, Premier
-- only); writes are service-role only. Holds ALL tiers (admin QA reads everything).

create table if not exists public.tournament_projections (
  id                uuid primary key default gen_random_uuid(),
  tournament_id     uuid not null references public.tournaments(id) on delete cascade,
  category          text not null check (category in ('men','women')),
  pair_key          text not null,            -- "smallerId::largerId"
  pair_player_ids   uuid[] not null,          -- length 2
  tournament_level  text,                     -- denormalized for filtering/QA
  champion_prob     numeric(5,4) not null,
  finalist_prob     numeric(5,4) not null,
  semifinal_prob    numeric(5,4) not null,
  rounds            jsonb not null,           -- [{round,reach_prob,expected_opponent_pair_key,opponents:[{pair_key,player_ids,names,reach_prob,win_prob}]}]
  model_version     text not null,
  mc_runs           integer not null,
  computed_at       timestamptz not null default now(),
  unique (tournament_id, category, pair_key)
);

create index if not exists tournament_projections_tournament_idx
  on public.tournament_projections (tournament_id, category);
create index if not exists tournament_projections_level_idx
  on public.tournament_projections (tournament_level);

-- RLS: anon/authenticated may READ; writes are service-role only (bypasses RLS).
alter table public.tournament_projections enable row level security;
drop policy if exists tournament_projections_read on public.tournament_projections;
create policy tournament_projections_read
  on public.tournament_projections for select to anon, authenticated using (true);

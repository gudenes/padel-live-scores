-- supabase/migrations/20260606140000_tournament_projection_snapshots.sql
-- Append-only history of per-pair tournament odds, for the champion-odds
-- sparkline. Public-read (anon); service-role writes. Mirrors match_live_odds_snapshots.
create table if not exists public.tournament_projection_snapshots (
  id             bigint generated always as identity primary key,
  tournament_id  uuid not null references public.tournaments(id) on delete cascade,
  category       text not null check (category in ('men','women')),
  pair_key       text not null,
  champion_prob  numeric(5,4) not null,
  finalist_prob  numeric(5,4) not null,
  semifinal_prob numeric(5,4) not null,
  computed_at    timestamptz not null default now()
);
create index if not exists tournament_projection_snapshots_lookup_idx
  on public.tournament_projection_snapshots (tournament_id, category, pair_key, computed_at);

alter table public.tournament_projection_snapshots enable row level security;
drop policy if exists tournament_projection_snapshots_read on public.tournament_projection_snapshots;
create policy tournament_projection_snapshots_read
  on public.tournament_projection_snapshots for select to anon, authenticated using (true);

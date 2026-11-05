-- Team announcements can precede individual pairings/Crionet match IDs.
-- One replaceable snapshot per event; failed fetches retain the previous one.
create table public.world_cup_tie_snapshots (
  tournament_id uuid primary key references public.tournaments(id) on delete cascade,
  source_url text not null,
  ties jsonb not null check (jsonb_typeof(ties) = 'array'),
  fetched_at timestamptz not null
);
alter table public.world_cup_tie_snapshots enable row level security;
grant select on public.world_cup_tie_snapshots to anon, authenticated;
grant all on public.world_cup_tie_snapshots to service_role;
create policy "Public can read official team announcements"
  on public.world_cup_tie_snapshots for select to anon, authenticated using (true);

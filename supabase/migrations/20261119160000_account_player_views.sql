-- Account-owned scouting views. Access is through authenticated admin routes only.
create table if not exists public.scouting_player_views (
  user_id uuid not null references public.users(id) on delete cascade,
  id uuid not null,
  name text not null check (char_length(name) between 1 and 80),
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);
create unique index if not exists scouting_player_views_active_name
  on public.scouting_player_views(user_id, lower(name)) where deleted_at is null;
alter table public.scouting_player_views enable row level security;
revoke all on public.scouting_player_views from anon, authenticated;
grant all on public.scouting_player_views to service_role;
comment on table public.scouting_player_views is 'Private saved player searches. Deleted rows retain IDs to prevent old browser imports from resurrecting them.';

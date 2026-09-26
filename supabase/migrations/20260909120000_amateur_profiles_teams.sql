-- 20260909120000_amateur_profiles_teams.sql
-- Amateur player profiles + reusable team model.
-- Amateurs share the players table under tier='amateur'; isolation from the
-- pro product is enforced in application code (see src/lib/player-tier.ts).

alter table public.players
  add column if not exists tier text not null default 'pro',
  add column if not exists home_club text,
  add column if not exists hidden boolean not null default false;

alter table public.players
  drop constraint if exists players_tier_check;
alter table public.players
  add constraint players_tier_check check (tier in ('pro','amateur'));

create index if not exists players_tier_idx
  on public.players (tier) where tier <> 'pro';

create table if not exists public.teams (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  club        text,
  city        text,
  country     text,
  crest_url   text,
  competition text,
  category    text,
  source      text not null default 'manual',
  external_id text,
  created_at  timestamptz not null default now(),
  unique (source, external_id)
);

create table if not exists public.team_seasons (
  id             uuid primary key default gen_random_uuid(),
  team_id        uuid not null references public.teams(id) on delete cascade,
  label          text not null,
  starts_on      date,
  ends_on        date,
  ranking        int,
  ties_played    int,
  ties_won       int,
  courts_won     int,
  courts_lost    int,
  points_for     int,
  points_against int,
  notes          text,
  created_at     timestamptz not null default now(),
  unique (team_id, label)
);

create table if not exists public.team_memberships (
  id                 uuid primary key default gen_random_uuid(),
  team_season_id     uuid not null references public.team_seasons(id) on delete cascade,
  player_id          uuid not null references public.players(id) on delete cascade,
  competition_points numeric,
  competition_rank   int,
  roster_rank        int,
  games_played       int,
  wins               int,
  losses             int,
  created_at         timestamptz not null default now(),
  unique (team_season_id, player_id)
);

create table if not exists public.team_fixtures (
  id             uuid primary key default gen_random_uuid(),
  team_season_id uuid not null references public.team_seasons(id) on delete cascade,
  code           text not null,
  label          text not null,
  sort_order     int not null,
  played_on      date,
  opponent_name  text,
  complete       boolean not null default true,
  result         text,
  points_for     int,
  points_against int,
  courts_won     int,
  courts_lost    int,
  unique (team_season_id, code)
);

create table if not exists public.team_fixture_slots (
  id          uuid primary key default gen_random_uuid(),
  fixture_id  uuid not null references public.team_fixtures(id) on delete cascade,
  label       text not null,
  worth       int not null,
  slot_group  int not null,
  result      text,
  sets        int,
  court_count int not null default 1,
  exact       boolean not null default true,
  partial     boolean not null default false,
  sort_order  int not null,
  unique (fixture_id, sort_order)
);

create table if not exists public.team_fixture_slot_players (
  slot_id   uuid not null references public.team_fixture_slots(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  primary key (slot_id, player_id)
);

create index if not exists team_memberships_player_idx
  on public.team_memberships (player_id);
create index if not exists team_fixture_slot_players_player_idx
  on public.team_fixture_slot_players (player_id);
create index if not exists team_fixtures_season_idx
  on public.team_fixtures (team_season_id, sort_order);

alter table public.teams                     enable row level security;
alter table public.team_seasons              enable row level security;
alter table public.team_memberships          enable row level security;
alter table public.team_fixtures             enable row level security;
alter table public.team_fixture_slots        enable row level security;
alter table public.team_fixture_slot_players enable row level security;

drop policy if exists teams_read             on public.teams;
drop policy if exists team_seasons_read      on public.team_seasons;
drop policy if exists team_memberships_read  on public.team_memberships;
drop policy if exists team_fixtures_read     on public.team_fixtures;
drop policy if exists team_slots_read        on public.team_fixture_slots;
drop policy if exists team_slot_players_read on public.team_fixture_slot_players;

create policy teams_read              on public.teams                     for select using (true);
create policy team_seasons_read       on public.team_seasons              for select using (true);
create policy team_memberships_read   on public.team_memberships          for select using (true);
create policy team_fixtures_read      on public.team_fixtures             for select using (true);
create policy team_slots_read         on public.team_fixture_slots        for select using (true);
create policy team_slot_players_read  on public.team_fixture_slot_players for select using (true);

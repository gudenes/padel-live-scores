-- 20260923180000_league_standings.sql
-- Upstream-published standings for a franchise league.
--
-- WHY A TABLE AND NOT COLUMNS ON team_seasons
--
-- A franchise has a standing per (division x scope x event): PPL and PPL II,
-- each kept three ways (overall / men's / women's), each published both per
-- event and as a season aggregate. team_seasons is one row per (team,
-- division), so this is 3 x N values per row — a column set would have to be
-- `points_men`, `points_women`, ... and would still have nowhere to put the
-- per-event breakdown.
--
-- WHY THIS IS SCRAPED AND NOT DERIVED
--
-- The league's standings points are not a function of the results. From
-- their own published PPL II women's season table: Toronto is 6-0, 100% of
-- matches won, and ranks SECOND behind Las Vegas on 4-2. The points decide
-- the order and nothing we store reproduces them. ties_won / courts_won on
-- team_seasons stay derived; these are read from upstream.
--
-- WHY event_key IS TEXT NOT NULL
--
-- The obvious shape is a nullable event_tournament_id, null meaning "season
-- aggregate". That is a trap this repo has already sprung: league_ties keyed
-- podium rows with a null session_number, and because NULL is not equal to
-- NULL, the unique index let duplicates straight through. 52 ties collapsed
-- to 20 before it was caught. A text key has no such hole — the aggregate is
-- the literal 'season-2026', and every row participates in the constraint.
--
-- The upstream tournament slug is used as the key rather than our UUID
-- because standings exist for events that have NO importable detail page
-- (miami-ppl-ii-2026 publishes a full standings table but 404s on its
-- tournament payload, so it has no row in `tournaments` at all). A FK would
-- make those rows unstorable. tournament_id is kept alongside, nullable, for
-- the events we do have.

create table if not exists public.league_standings (
  id              uuid primary key default gen_random_uuid(),
  team_season_id  uuid not null references public.team_seasons (id) on delete cascade,

  -- 'all' | 'men' | 'women'. Matches the Scope type in src/lib/ppl-standings.ts.
  scope           text not null,

  -- Upstream event slug, or the season aggregate key (e.g. 'season-2026').
  event_key       text not null,

  -- Our tournament, when the event has one. Null for events upstream
  -- publishes standings for but no importable detail page.
  tournament_id   uuid references public.tournaments (id) on delete set null,

  -- The standing itself.
  rank            integer,
  points          integer,
  matches_played  integer,
  wins            integer,
  losses          integer,

  -- Percentages as upstream renders them: 75 means 75%, not 0.75.
  pct_matches_won integer,
  pct_sets_won    integer,
  pct_games_won   integer,
  pct_points_won  integer,

  source          text not null default 'ppl',
  captured_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),

  constraint league_standings_scope_check check (scope in ('all', 'men', 'women')),
  constraint league_standings_key unique (team_season_id, scope, event_key)
);

comment on table public.league_standings is
  'Standings as the league publishes them. Points are NOT derivable from results (a 6-0 franchise can rank below a 4-2 one), so they are read from the source rather than computed.';
comment on column public.league_standings.event_key is
  'Upstream event slug, or the season-aggregate key such as ''season-2026''. Text and NOT NULL so every row takes part in the unique constraint — a nullable tournament_id would repeat the NULL-is-not-NULL duplicate bug that hit league_ties.';
comment on column public.league_standings.pct_matches_won is
  'Whole percent as published: 75 means 75%.';
comment on column public.league_standings.tournament_id is
  'Null when upstream publishes standings for an event that has no importable detail page, and therefore no tournaments row.';

create index if not exists league_standings_season_scope_idx
  on public.league_standings (team_season_id, scope);

create index if not exists league_standings_event_idx
  on public.league_standings (event_key, scope);

alter table public.league_standings enable row level security;

drop policy if exists "league_standings are publicly readable" on public.league_standings;
create policy "league_standings are publicly readable"
  on public.league_standings for select
  using (true);

-- 20260922120000_ppl_league_foundations.sql
-- Schema for Pro Padel League coverage.
-- Spec: docs/superpowers/specs/2026-09-22-pro-padel-league-design.md
--
-- Three parts:
--   1. teams.brand_color        — PPL publishes a per-franchise hex
--   2. team_seasons.league      — a franchise runs TWO parallel seasons
--      + team_seasons.season_year  (PPL and PPL II). Real columns rather
--                                   than encoding the division in `label`,
--                                   so queries don't become LIKE '%PPL II%'.
--   3. league_ties              — a two-sided tie. `team_fixtures` is
--      + matches.tie_id            one-sided (opponent as free text), which
--                                  is right for SNP where only one club is
--                                  tracked. In PPL both sides are our own
--                                  teams, so a one-sided model would store
--                                  every tie twice and force score
--                                  reconciliation between the copies.
--
-- No change to `tournaments` is needed: `level` is plain nullable text with
-- no CHECK, so 'ppl' / 'ppl_ii' are already valid values.

-- 1. Franchise branding ------------------------------------------------------

alter table public.teams
  add column if not exists brand_color text;

comment on column public.teams.brand_color is
  'Franchise brand color as a CSS hex (e.g. "#0187d1"), sourced from the league. Null = fall back to the neutral team treatment.';

-- 2. Division and year on a team season --------------------------------------

alter table public.team_seasons
  add column if not exists league      text,
  add column if not exists season_year integer;

comment on column public.team_seasons.league is
  'Competition key within the team''s source (e.g. "ppl", "ppl-ii"). Null for single-competition sources such as SNP.';
comment on column public.team_seasons.season_year is
  'Calendar year of the season, for ordering and filtering without parsing `label`.';

create index if not exists team_seasons_league_year_idx
  on public.team_seasons (league, season_year)
  where league is not null;

-- 3. Two-sided ties ----------------------------------------------------------

create table if not exists public.league_ties (
  id                  uuid primary key default gen_random_uuid(),
  tournament_id       uuid not null references public.tournaments (id) on delete cascade,
  session_number      integer,
  stage               text not null,
  home_team_season_id uuid not null references public.team_seasons (id) on delete cascade,
  away_team_season_id uuid not null references public.team_seasons (id) on delete cascade,
  scheduled_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint league_ties_distinct_sides check (home_team_season_id <> away_team_season_id)
);

comment on table public.league_ties is
  'A team-vs-team confrontation in a franchise league. One tie produces multiple matches (PPL: one men''s + one women''s), linked via matches.tie_id and distinguished by matches.category.';
comment on column public.league_ties.stage is
  'Upstream stage label, e.g. "Group Stage", "Championship", "3rd Place".';
comment on column public.league_ties.session_number is
  'Upstream grouping for same-session matches. Null for knockout ties, which are identified by stage alone.';

-- Partial unique indexes rather than a table constraint: session_number is
-- null for podium ties, and NULL is not equal to itself in a UNIQUE
-- constraint, so a plain UNIQUE would let duplicate podium ties through.
create unique index if not exists league_ties_session_key
  on public.league_ties (tournament_id, session_number, stage)
  where session_number is not null;

create unique index if not exists league_ties_stage_key
  on public.league_ties (tournament_id, stage)
  where session_number is null;

create index if not exists league_ties_tournament_idx
  on public.league_ties (tournament_id);

alter table public.league_ties enable row level security;

drop policy if exists "league_ties are publicly readable" on public.league_ties;
create policy "league_ties are publicly readable"
  on public.league_ties for select
  using (true);

-- 4. Link matches to their tie -----------------------------------------------

alter table public.matches
  add column if not exists tie_id uuid references public.league_ties (id) on delete set null;

comment on column public.matches.tie_id is
  'The league tie this match belongs to. Null for every circuit match — only franchise-league matches are part of a tie.';

create index if not exists matches_tie_id_idx
  on public.matches (tie_id)
  where tie_id is not null;

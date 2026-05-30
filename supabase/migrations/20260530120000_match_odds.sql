-- supabase/migrations/20260530120000_match_odds.sql
-- Live win-probability + fair odds per match (latest) + append-only history.

create table if not exists public.match_odds (
  match_id        uuid primary key references public.matches(id) on delete cascade,
  pair1_win_prob  numeric(5,4) not null,
  pair2_win_prob  numeric(5,4) not null,
  pair1_fair_odds numeric(7,2) not null,
  pair2_fair_odds numeric(7,2) not null,
  confidence      text not null check (confidence in ('full','med','pre-match','thin')),
  model_version   text not null default 'v1',
  computed_at     timestamptz not null default now()
);

create table if not exists public.match_odds_snapshots (
  id             bigint generated always as identity primary key,
  match_id       uuid not null references public.matches(id) on delete cascade,
  pair1_win_prob numeric(5,4) not null,
  computed_at    timestamptz not null default now()
);
create index if not exists match_odds_snapshots_match_time_idx
  on public.match_odds_snapshots (match_id, computed_at desc);

-- RLS: anon may read (values are non-sensitive); writes are service-role only (bypasses RLS).
alter table public.match_odds enable row level security;
alter table public.match_odds_snapshots enable row level security;

drop policy if exists match_odds_read on public.match_odds;
create policy match_odds_read on public.match_odds for select to anon, authenticated using (true);

drop policy if exists match_odds_snapshots_read on public.match_odds_snapshots;
create policy match_odds_snapshots_read on public.match_odds_snapshots for select to anon, authenticated using (true);

-- Realtime: publish match_odds so the console receives live updates.
-- Tolerant: no-op if the table is already a member (e.g. a FOR ALL TABLES publication).
do $$
begin
  alter publication supabase_realtime add table public.match_odds;
exception
  when duplicate_object then null;  -- already published
  when undefined_object then null;  -- publication not present in this environment
end $$;

-- supabase/migrations/20260708120000_tournament_entries.sql
-- Resolved team rows for the tournament Entries tab. Populated pre-draw by
-- padelgod's fip-entry-list-populator from padelgod.entry_list_snapshots
-- (delete-then-insert per tournament+category). Public-readable (anon key);
-- writes are service-role only.

create table if not exists public.tournament_entries (
  id               uuid primary key default gen_random_uuid(),
  tournament_id    uuid not null references public.tournaments(id) on delete cascade,
  category         text not null check (category in ('men','women')),
  draw_type        text not null default 'main_draw'
                     check (draw_type in ('main_draw','qualifying')),  -- from padelgod.entry_list_snapshots

  seed             integer,
  marker           text,                             -- 'Q' for qualifying, else null
  player1_id       uuid references public.players(id) on delete set null,
  player2_id       uuid references public.players(id) on delete set null,
  player1_name     text,
  player2_name     text,
  player1_country  text,
  player2_country  text,
  team_points      integer,
  captured_at      timestamptz not null,
  updated_at       timestamptz not null default now()
);

create index if not exists tournament_entries_tournament_idx
  on public.tournament_entries (tournament_id, category);

alter table public.tournament_entries enable row level security;
drop policy if exists tournament_entries_read on public.tournament_entries;
create policy tournament_entries_read
  on public.tournament_entries for select to anon, authenticated using (true);

-- Feature flag: OFF in prod, ON for localhost dev.
insert into public.feature_flags (key, enabled, enabled_local, label, description)
values (
  'entry_list_enabled',
  false,
  true,
  'Tournament · Entries tab',
  'Pre-draw entry list tab on the tournament page, fed by tournament_entries. OFF in prod.'
)
on conflict (key) do nothing;

-- supabase/migrations/20260531120000_match_live_odds.sql
-- Real-time (in-play) live odds: latest per live match + append-only history.
-- Anchored to the Elo model (model_predictions) or cold-start Elo for out-of-scope matches.

create table if not exists public.match_live_odds (
  match_id             uuid primary key references public.matches(id) on delete cascade,
  pair1_prob           numeric(5,4) not null,
  pair2_prob           numeric(5,4) not null,
  pair1_decimal_odds   numeric(8,3) not null,
  pair2_decimal_odds   numeric(8,3) not null,
  anchor_source        text not null check (anchor_source in ('model-prediction','cold-start-elo')),
  anchor_prediction_id uuid references public.model_predictions(id) on delete set null,
  coverage             text not null check (coverage in ('live-pbp','live-coarse')),
  model_version        text not null default 'inplay-v1',
  computed_at          timestamptz not null default now()
);

create table if not exists public.match_live_odds_snapshots (
  id          bigint generated always as identity primary key,
  match_id    uuid not null references public.matches(id) on delete cascade,
  pair1_prob  numeric(5,4) not null,
  computed_at timestamptz not null default now()
);
create index if not exists match_live_odds_snapshots_match_time_idx
  on public.match_live_odds_snapshots (match_id, computed_at desc);

-- RLS: anon may READ (the /odds "Live now" client island subscribes with the anon key);
-- writes are service-role only (the padelgod worker), which bypasses RLS.
alter table public.match_live_odds enable row level security;
alter table public.match_live_odds_snapshots enable row level security;
drop policy if exists match_live_odds_read on public.match_live_odds;
create policy match_live_odds_read on public.match_live_odds for select to anon, authenticated using (true);
drop policy if exists match_live_odds_snapshots_read on public.match_live_odds_snapshots;
create policy match_live_odds_snapshots_read on public.match_live_odds_snapshots for select to anon, authenticated using (true);

-- Realtime publish (tolerant of FOR ALL TABLES / already-member / no-publication setups).
do $$
begin
  alter publication supabase_realtime add table public.match_live_odds;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

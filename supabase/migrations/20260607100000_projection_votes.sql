-- supabase/migrations/20260607100000_projection_votes.sql
-- Fan agree/disagree votes on a pair's projected finish. Pair context is kept
-- for analysis, but only the GLOBAL agree/disagree tally is surfaced
-- ("agreement with our model"). One changeable vote per (pair, voter).
create table if not exists public.projection_votes (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  category text not null check (category in ('men','women')),
  pair_key text not null,
  voter_id text not null,                 -- device UUID (pn_device_id) or account id when logged in
  vote text not null check (vote in ('agree','disagree')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, category, pair_key, voter_id)
);
create index if not exists projection_votes_vote_idx on public.projection_votes (vote);
create index if not exists projection_votes_voter_idx on public.projection_votes (voter_id);

-- RLS on, no policies → anon/auth clients get nothing; all access is via the
-- server route using the service-role key (which bypasses RLS).
alter table public.projection_votes enable row level security;

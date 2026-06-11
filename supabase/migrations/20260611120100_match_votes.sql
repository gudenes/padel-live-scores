-- supabase/migrations/20260611120100_match_votes.sql
-- One-tap "who will win" fan votes per match. One changeable vote per
-- (match, voter) until the match starts. Mirrors projection_votes: RLS on
-- with NO policies, so all access is via the service-role API route.
create table if not exists public.match_votes (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  pair smallint not null check (pair in (1, 2)),
  voter_id text not null,                 -- device UUID (pn_device_id) or account id when logged in
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (match_id, voter_id)
);
create index if not exists match_votes_match_idx on public.match_votes (match_id);
create index if not exists match_votes_voter_idx on public.match_votes (voter_id);

alter table public.match_votes enable row level security;

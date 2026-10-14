-- Share only a sanitized analysis snapshot. No anonymous table access.
create table if not exists public.scouting_report_shares (
 token_hash text primary key,
 match_id uuid not null,
 created_by text not null,
 snapshot jsonb not null,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now() + interval '30 days'),
 revoked_at timestamptz
);
alter table public.scouting_report_shares enable row level security;
revoke all on public.scouting_report_shares from anon, authenticated;

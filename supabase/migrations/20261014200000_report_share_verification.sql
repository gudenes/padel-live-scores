create table public.report_share_codes (
 id uuid primary key,
 share_hash text not null references public.scouting_report_shares(token_hash) on delete cascade,
 email text not null,
 code_hash text not null,
 attempts integer not null default 0,
 expires_at timestamptz not null,
 consumed_at timestamptz,
 created_at timestamptz not null default now()
);
create table public.report_share_visitors (
 session_hash text primary key,
 share_hash text not null references public.scouting_report_shares(token_hash) on delete cascade,
 email text not null,
 expires_at timestamptz not null,
 created_at timestamptz not null default now()
);
create table public.report_share_activity (
 id bigint generated always as identity primary key,
 share_hash text not null references public.scouting_report_shares(token_hash) on delete cascade,
 email text,
 event text not null check(event in ('code_requested','code_sent','delivery_failed','verification_failed','verified','report_viewed')),
 ip_hash text,
 created_at timestamptz not null default now()
);
create index report_share_activity_lookup on public.report_share_activity(share_hash,created_at);
create index report_share_activity_rate on public.report_share_activity(ip_hash,created_at) where event='code_requested';
alter table public.report_share_codes enable row level security;
alter table public.report_share_visitors enable row level security;
alter table public.report_share_activity enable row level security;
revoke all on public.report_share_codes,public.report_share_visitors,public.report_share_activity from anon,authenticated;

create table if not exists public.lab_vision_workers (
 id uuid primary key, owner_user_id text not null, token_hash text not null unique,
 name text not null default 'My Mac', last_seen_at timestamptz, revoked_at timestamptz,
 created_at timestamptz not null default now()
);
create table if not exists public.lab_vision_jobs (
 id uuid primary key, video_id uuid not null references public.match_video_uploads(id),
 owner_user_id text not null, worker_id uuid references public.lab_vision_workers(id),
 setup jsonb not null, status text not null default 'queued' check(status in ('queued','running','complete','failed','cancelled')),
 stage text not null default 'waiting_for_mac', progress jsonb not null default '{}',
 lease_until timestamptz, attempt_id uuid, error text, result jsonb,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists lab_vision_one_active_video on public.lab_vision_jobs(video_id) where status in ('queued','running');
create index if not exists lab_vision_queue on public.lab_vision_jobs(owner_user_id,status,created_at);
alter table public.lab_vision_workers enable row level security;
alter table public.lab_vision_jobs enable row level security;
revoke all on public.lab_vision_workers,public.lab_vision_jobs from anon,authenticated;

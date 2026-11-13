-- Immutable training preparation artifacts. Application API is operator-only.
create table if not exists public.lab_vision_training_artifacts (
 id uuid primary key,
 kind text not null check (kind in ('snapshot','plan','evaluation')),
 created_by text not null,
 payload jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.lab_vision_training_artifacts enable row level security;
revoke all on public.lab_vision_training_artifacts from anon, authenticated;

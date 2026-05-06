-- supabase/migrations/20260506_padel_labs_v1_phase1.sql
-- Padel Labs v1 — Phase 1 tables.
-- Auth.js v5 stores users in a "users" table in the public schema (PostgresAdapter convention).
-- All Labs-specific tables are prefixed labs_* and have FKs to public.users.

------------------------------------------------------------
-- labs_subscriptions
------------------------------------------------------------
create table if not exists public.labs_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  tier text not null default 'free' check (tier in ('free','pro','power')),
  status text not null default 'active' check (status in ('active','past_due','canceled','incomplete')),
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create index if not exists idx_labs_subscriptions_user on public.labs_subscriptions(user_id);
create index if not exists idx_labs_subscriptions_stripe_sub on public.labs_subscriptions(stripe_subscription_id) where stripe_subscription_id is not null;

------------------------------------------------------------
-- labs_conversations
------------------------------------------------------------
create table if not exists public.labs_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text,
  locale text not null default 'en' check (locale in ('en','es','pt','it','fr')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_labs_conversations_user_recent on public.labs_conversations(user_id, updated_at desc);

------------------------------------------------------------
-- labs_messages
------------------------------------------------------------
create table if not exists public.labs_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.labs_conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  citations jsonb default '[]'::jsonb,
  cost_input_tokens integer default 0,
  cost_output_tokens integer default 0,
  cost_cached_tokens integer default 0,
  model text,
  created_at timestamptz not null default now()
);

create index if not exists idx_labs_messages_conversation on public.labs_messages(conversation_id, created_at);

------------------------------------------------------------
-- labs_saved_queries
------------------------------------------------------------
create table if not exists public.labs_saved_queries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  text text not null,
  params jsonb default '{}'::jsonb,
  last_run_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_labs_saved_queries_user on public.labs_saved_queries(user_id, created_at desc);

------------------------------------------------------------
-- labs_usage_events
------------------------------------------------------------
create table if not exists public.labs_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  ip_hash text,                 -- sha256 of IP for anonymous demo throttling
  kind text not null check (kind in ('chat','template','export','card')),
  cost_units integer not null default 1,
  metadata jsonb default '{}'::jsonb,
  at timestamptz not null default now()
);

create index if not exists idx_labs_usage_events_user_day on public.labs_usage_events(user_id, at) where user_id is not null;
create index if not exists idx_labs_usage_events_ip_day on public.labs_usage_events(ip_hash, at) where ip_hash is not null;

------------------------------------------------------------
-- labs_template_runs
------------------------------------------------------------
create table if not exists public.labs_template_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  template_slug text not null,
  params jsonb default '{}'::jsonb,
  output_kind text check (output_kind in ('table','png','csv','json')),
  at timestamptz not null default now()
);

create index if not exists idx_labs_template_runs_user on public.labs_template_runs(user_id, at desc);

------------------------------------------------------------
-- RLS — defense in depth.
-- Padel Labs uses Auth.js v5 with @auth/pg-adapter (database sessions),
-- NOT Supabase JWTs, so `auth.uid()` won't resolve to a meaningful value
-- in this context. All labs_* reads go through Next.js API routes using
-- the service key + app-layer auth (Auth.js session check).
--
-- We still ENABLE RLS so that if the anon key is ever accidentally used
-- to query labs_* tables, the read returns nothing rather than leaking
-- data. The service key bypasses RLS as designed.
--
-- If we later add direct browser → Supabase reads for labs_* data, we'll
-- ship a JWT bridge (Auth.js → custom Supabase JWT) and grant policies
-- in a follow-up migration.
------------------------------------------------------------
alter table public.labs_subscriptions enable row level security;
alter table public.labs_conversations enable row level security;
alter table public.labs_messages enable row level security;
alter table public.labs_saved_queries enable row level security;
alter table public.labs_template_runs enable row level security;
alter table public.labs_usage_events enable row level security;

------------------------------------------------------------
-- updated_at trigger for labs_subscriptions / labs_conversations
------------------------------------------------------------
create or replace function public.labs_set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_labs_subscriptions_updated_at on public.labs_subscriptions;
create trigger trg_labs_subscriptions_updated_at before update on public.labs_subscriptions
  for each row execute function public.labs_set_updated_at();

drop trigger if exists trg_labs_conversations_updated_at on public.labs_conversations;
create trigger trg_labs_conversations_updated_at before update on public.labs_conversations
  for each row execute function public.labs_set_updated_at();

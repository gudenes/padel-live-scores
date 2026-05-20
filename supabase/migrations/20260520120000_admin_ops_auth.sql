-- supabase/migrations/20260520120000_admin_ops_auth.sql
-- Admin Ops App — Phase 1 auth schema.
-- Adds:
--   - users.password_hash (nullable; OAuth-only users keep NULL)
--   - password_reset_tokens (single-use tokens for /forgot-password flow)
--   - operators (allow-list — only listed users may access the admin app)

-- 1. Password hash column on users
alter table public.users add column if not exists password_hash text;

comment on column public.users.password_hash is
  'bcryptjs cost 10. Nullable: OAuth-only users have NULL. Set via /reset-password flow.';

-- 2. Password reset tokens
create table if not exists public.password_reset_tokens (
  token_hash text primary key,                              -- SHA-256 of the raw token emailed to the user
  user_id uuid not null references public.users(id) on delete cascade,
  expires_at timestamptz not null,                          -- 30 min after creation
  used_at timestamptz                                       -- null until consumed
);

create index if not exists password_reset_tokens_user_idx
  on public.password_reset_tokens (user_id);
create index if not exists password_reset_tokens_expires_idx
  on public.password_reset_tokens (expires_at);

comment on table public.password_reset_tokens is
  'Single-use password reset tokens. Raw token sent via email; only the SHA-256 hash is stored.';

-- 3. Operator allow-list
create table if not exists public.operators (
  user_id uuid primary key references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  added_by uuid references public.users(id)
);

comment on table public.operators is
  'Allow-list for the admin app. Users with a row here can sign in to admin.padelnachos.com.';

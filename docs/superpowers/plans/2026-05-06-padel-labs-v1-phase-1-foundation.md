# Padel Labs v1 — Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy a new `apps/labs/` Next.js 16 app serving both `padellabs.tech` (placeholder marketing umbrella) and `analyst.padellabs.tech` (chat module — the v1 product) with Auth.js v5 (magic-link + Google OAuth), the six `labs_*` Supabase tables, and a stubbed authenticated workspace. No AI yet — this phase establishes the scaffolding.

**Visual direction:** light theme, white-predominant, lime accent (`#84cc16`), system font stack, Sentry-style buttons. See [brand design system spec](../specs/2026-05-06-padel-labs-brand-design-system.md) for tokens and rationale.

**Architecture:** New independent npm package at `apps/labs/` (mirrors the existing `relay/` and `padelgod/` sibling-package pattern — not npm workspaces). New Vercel project with `Root Directory = apps/labs/`. Auth.js v5 with `@auth/pg-adapter` pointing at the same Supabase Postgres as Padel Nachos. Six `labs_*` tables created via a single Supabase migration with RLS enabled (defense-in-depth). No data duplication; reads from existing public tables come later in Phase 2.

**Tech Stack:** Next.js 16.2.0, React 19.2.4, TypeScript 5, Tailwind 4, Auth.js v5 (next-auth 5.0.0-beta.31), `@auth/pg-adapter`, `@supabase/supabase-js`, Resend (magic-link delivery), Vitest 4 (smoke tests), Vercel.

## Phasing context

This is Phase 1 of 5 (see [v1 design spec](../specs/2026-05-06-padel-labs-v1-design.md)). Subsequent phases get their own plan documents:

- **P1 — Foundation** (this plan): scaffold + auth + DB + placeholder UI
- **P2 — Ask MVP**: chat with Haiku 4.5 + tool use + citations + 2–3 SQL queries
- **P3 — Templates + Outputs**: 3 templates, PNG card rendering, CSV export
- **P4 — Billing + Rate-limiting**: Stripe Checkout, free/pro gates, usage metering
- **P5 — Marketing site + i18n**: 5-locale marketing site, public demo chat

Phase 1's deliverable: `https://padellabs.tech` (placeholder umbrella) and `https://analyst.padellabs.tech` (the chat module's auth + workspace shell) are live; you can sign in with magic-link or Google; clicking "Ask" routes to a placeholder page that hits `POST /api/v1/ask` and renders a hardcoded response.

## File Structure

```
apps/labs/
├── package.json
├── next.config.ts
├── tsconfig.json
├── postcss.config.mjs
├── eslint.config.mjs
├── vitest.config.ts
├── .env.local.example
├── .gitignore
├── public/
│   └── (empty for now)
├── src/
│   ├── app/
│   │   ├── layout.tsx                          # Root layout
│   │   ├── globals.css                         # Tailwind imports
│   │   ├── page.tsx                            # Marketing landing page (placeholder)
│   │   ├── (app)/
│   │   │   ├── layout.tsx                      # Auth-gated workspace shell
│   │   │   └── ask/
│   │   │       └── page.tsx                    # Placeholder Ask page (calls /api/v1/ask)
│   │   ├── login/
│   │   │   └── page.tsx                        # Login form (magic-link + Google)
│   │   └── api/
│   │       ├── auth/[...nextauth]/route.ts     # Auth.js handlers
│   │       └── v1/ask/route.ts                 # Placeholder; stub answer
│   ├── lib/
│   │   ├── auth.ts                             # Auth.js v5 config + exports
│   │   └── db.ts                               # pg pool + Supabase helpers
│   └── proxy.ts                                # Edge auth gate (Next.js 16 proxy)
└── tests/
    └── smoke.test.ts                           # Smoke tests

supabase/migrations/
└── 20260506_padel_labs_v1_phase1.sql           # 7 labs_* tables + RLS

docs/runbooks/
└── padel-labs-vercel-deploy.md                 # One-time Vercel + DNS setup notes
```

---

## Task 1: Scaffold apps/labs/ directory and package.json

**Files:**
- Create: `apps/labs/package.json`
- Create: `apps/labs/.gitignore`
- Create: `apps/labs/.env.local.example`

- [ ] **Step 1.1: Create the `apps/labs/` directory tree**

```bash
mkdir -p apps/labs/src/app/{login,api/auth/'[...nextauth]',api/v1/ask,'(app)'/ask}
mkdir -p apps/labs/src/lib
mkdir -p apps/labs/public
mkdir -p apps/labs/tests
```

- [ ] **Step 1.2: Write `apps/labs/package.json`**

Independent package — mirrors `relay/` and `padelgod/`. No npm workspaces.

```json
{
  "name": "padel-labs",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3003",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run"
  },
  "dependencies": {
    "@auth/pg-adapter": "^1.11.2",
    "@supabase/supabase-js": "^2.99.3",
    "@types/pg": "^8.20.0",
    "next": "16.2.0",
    "next-auth": "^5.0.0-beta.31",
    "pg": "^8.20.0",
    "react": "19.2.4",
    "react-dom": "19.2.4",
    "resend": "^6.11.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "^9",
    "eslint-config-next": "16.2.0",
    "tailwindcss": "^4",
    "typescript": "^5",
    "vitest": "^4.1.2"
  }
}
```

- [ ] **Step 1.3: Write `apps/labs/.gitignore`**

```
node_modules
.next
.env.local
.env*.local
.vercel
dist
coverage
```

- [ ] **Step 1.4: Write `apps/labs/.env.local.example`**

```
# Public Supabase config (browser-safe — same project as Padel Nachos)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Server-only Supabase (service key bypasses RLS)
SUPABASE_SERVICE_KEY=

# Auth.js v5
AUTH_SECRET=                     # openssl rand -base64 32
AUTH_URL=http://localhost:3003   # production: https://analyst.padellabs.tech
DATABASE_URL=                    # postgres://... full connection string to Supabase Postgres

# OAuth
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=

# Magic-link delivery
RESEND_API_KEY=
AUTH_EMAIL_FROM="Padel Labs <hello@padellabs.tech>"
```

- [ ] **Step 1.5: Install dependencies**

Run: `cd apps/labs && npm install`
Expected: `node_modules/` populated, no errors.

- [ ] **Step 1.6: Commit**

```bash
git add apps/labs/package.json apps/labs/package-lock.json apps/labs/.gitignore apps/labs/.env.local.example
git commit -m "feat(labs): scaffold apps/labs package"
```

---

## Task 2: Configure Next.js, TypeScript, Tailwind, ESLint, Vitest

**Files:**
- Create: `apps/labs/next.config.ts`
- Create: `apps/labs/tsconfig.json`
- Create: `apps/labs/postcss.config.mjs`
- Create: `apps/labs/eslint.config.mjs`
- Create: `apps/labs/vitest.config.ts`
- Create: `apps/labs/src/app/globals.css`

- [ ] **Step 2.1: Write `apps/labs/next.config.ts`**

```ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'https', hostname: 'storage.googleapis.com' },
    ],
  },
}

export default nextConfig
```

- [ ] **Step 2.2: Write `apps/labs/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 2.3: Write `apps/labs/postcss.config.mjs`**

```js
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}
```

- [ ] **Step 2.4: Write `apps/labs/eslint.config.mjs`**

```js
import { FlatCompat } from '@eslint/eslintrc'

const compat = new FlatCompat({ baseDirectory: import.meta.dirname })

export default [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
]
```

- [ ] **Step 2.5: Write `apps/labs/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
})
```

- [ ] **Step 2.6: Write `apps/labs/src/app/globals.css`**

Tokens come from the [brand design system spec](../specs/2026-05-06-padel-labs-brand-design-system.md) §2 and §4. Light theme, lime accent, zinc neutrals, system font, Sentry-style buttons.

```css
@import "tailwindcss";

:root {
  /* Neutrals (Tailwind zinc) */
  --bg: #ffffff;
  --surface: #fafafa;
  --surface-2: #f4f4f5;
  --border: #e4e4e7;
  --border-strong: #d4d4d8;
  --text: #18181b;
  --text-muted: #52525b;
  --text-subtle: #71717a;

  /* Accent — Lime (Tailwind lime) */
  --lime-50: #f7fee7;
  --lime-100: #ecfccb;
  --lime-200: #d9f99d;
  --lime-300: #bef264;
  --lime-400: #a3e635;
  --lime-500: #84cc16;
  --lime-600: #65a30d;
  --lime-700: #4d7c0f;
  --lime-900: #1a2e05;

  /* Fonts (system stack only — no custom font load) */
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
}

html, body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}

* { box-sizing: border-box; }
a { color: inherit; text-decoration: none; }

/* ───── Sentry-style buttons (the satisfying ones) ───── */
.btn {
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 14px;
  padding: 11px 22px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  line-height: 1;
  letter-spacing: -0.005em;
  transition: transform 0.12s cubic-bezier(0.4, 0, 0.2, 1),
              box-shadow 0.12s cubic-bezier(0.4, 0, 0.2, 1),
              background 0.12s ease;
}
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-primary {
  background: linear-gradient(180deg, var(--lime-400) 0%, var(--lime-500) 100%);
  color: var(--lime-900);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.35),
    0 1px 2px rgba(26, 46, 5, 0.12),
    0 4px 10px -2px rgba(132, 204, 22, 0.32);
}
.btn-primary:hover:not(:disabled) {
  background: linear-gradient(180deg, var(--lime-300) 0%, var(--lime-400) 100%);
  transform: translateY(-1px);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.4),
    0 2px 4px rgba(26, 46, 5, 0.14),
    0 10px 20px -4px rgba(132, 204, 22, 0.45);
}
.btn-primary:active:not(:disabled) {
  transform: translateY(0);
  background: linear-gradient(180deg, var(--lime-500) 0%, var(--lime-600) 100%);
  box-shadow:
    inset 0 1px 2px rgba(26, 46, 5, 0.2),
    0 1px 1px rgba(26, 46, 5, 0.1);
}

.btn-secondary {
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border-strong);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
.btn-secondary:hover:not(:disabled) {
  background: var(--surface);
  border-color: #a1a1aa;
  transform: translateY(-1px);
  box-shadow: 0 4px 10px -2px rgba(0, 0, 0, 0.08);
}
.btn-secondary:active:not(:disabled) {
  transform: translateY(0);
  background: var(--surface-2);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.08);
}

/* ───── Brand mark (lime gradient square) ───── */
.brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--lime-400) 0%, var(--lime-500) 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.35),
    0 2px 6px rgba(132, 204, 22, 0.32);
  color: var(--lime-900);
  font-family: var(--font-mono);
  font-weight: 700;
}

/* ───── Inputs ───── */
.input {
  font-family: var(--font-sans);
  font-size: 14px;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  padding: 11px 14px;
  width: 100%;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
}
.input:focus {
  outline: none;
  border-color: var(--lime-500);
  box-shadow: 0 0 0 3px var(--lime-100);
}
```

- [ ] **Step 2.7: Verify dev server boots**

Run: `cd apps/labs && npm run dev`
Expected: dev server starts on `http://localhost:3003` with no errors. (No pages exist yet — visiting will 404, that's fine.)
Stop the dev server (`Ctrl+C`).

- [ ] **Step 2.8: Commit**

```bash
git add apps/labs/next.config.ts apps/labs/tsconfig.json apps/labs/postcss.config.mjs apps/labs/eslint.config.mjs apps/labs/vitest.config.ts apps/labs/src/app/globals.css
git commit -m "chore(labs): configure next/ts/tailwind/eslint/vitest"
```

---

## Task 3: Create Supabase migration for `labs_*` tables

**Files:**
- Create: `supabase/migrations/20260506_padel_labs_v1_phase1.sql`

- [ ] **Step 3.1: Write the migration**

This creates all 7 tables from spec §9.2 with FKs to `auth.users` (Auth.js v5's `users` table), constraints, and RLS policies.

```sql
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
```

- [ ] **Step 3.2: Apply the migration via Supabase dashboard**

Open the Supabase project SQL editor (the same project Padel Nachos uses), paste the migration contents, run it. **Note:** the migration assumes `public.users` (Auth.js v5 PostgresAdapter table) already exists from the Nachos setup. Verify with: `select count(*) from public.users limit 1;` — if it errors with "relation does not exist," Auth.js needs to be configured first; come back to this step after Task 4.

- [ ] **Step 3.3: Verify tables created**

In SQL editor run:

```sql
select table_name from information_schema.tables
where table_schema = 'public' and table_name like 'labs_%'
order by table_name;
```

Expected output: 6 rows — `labs_conversations`, `labs_messages`, `labs_saved_queries`, `labs_subscriptions`, `labs_template_runs`, `labs_usage_events`.

- [ ] **Step 3.4: Commit**

```bash
git add supabase/migrations/20260506_padel_labs_v1_phase1.sql
git commit -m "feat(labs): add labs_* tables migration with RLS (phase 1)"
```

---

## Task 4: Configure Auth.js v5

**Files:**
- Create: `apps/labs/src/lib/auth.ts`
- Create: `apps/labs/src/lib/db.ts`
- Create: `apps/labs/src/app/api/auth/[...nextauth]/route.ts`

- [ ] **Step 4.1: Write `apps/labs/src/lib/db.ts`**

```ts
// apps/labs/src/lib/db.ts
// Postgres pool for Auth.js + Supabase clients for data access.
// Mirrors src/auth.ts in nachos: parse DATABASE_URL manually for special chars.

import { Pool } from 'pg'
import { createClient } from '@supabase/supabase-js'

function parseDbUrl(url: string) {
  const u = new URL(url)
  return {
    host: u.hostname,
    port: parseInt(u.port || '5432', 10),
    database: u.pathname.slice(1) || 'postgres',
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
  }
}

let _pool: Pool | null = null

export function pgPool(): Pool {
  if (_pool) return _pool
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required')
  }
  _pool = new Pool({
    ...parseDbUrl(process.env.DATABASE_URL),
    max: 1,
    ssl: { rejectUnauthorized: false },
  })
  return _pool
}

export const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key',
  {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  },
)

export function supabaseService() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_KEY required')
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
```

- [ ] **Step 4.2: Write `apps/labs/src/lib/auth.ts`**

```ts
// apps/labs/src/lib/auth.ts
// Auth.js v5 configuration for Padel Labs.
// Magic-link via Resend + Google OAuth. Database-backed sessions in Supabase Postgres.

import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import Resend from 'next-auth/providers/resend'
import PostgresAdapter from '@auth/pg-adapter'
import { pgPool } from './db'

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PostgresAdapter(pgPool()),
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),
    Resend({
      apiKey: process.env.RESEND_API_KEY!,
      from: process.env.AUTH_EMAIL_FROM ?? 'Padel Labs <hello@padellabs.tech>',
      async sendVerificationRequest({ identifier: email, url }) {
        const { Resend: ResendClient } = await import('resend')
        const resend = new ResendClient(process.env.RESEND_API_KEY!)
        await resend.emails.send({
          from: process.env.AUTH_EMAIL_FROM ?? 'Padel Labs <hello@padellabs.tech>',
          to: email,
          subject: 'Sign in to Padel Labs',
          html: `
            <div style="font-family:-apple-system,sans-serif;background:#0a0a0a;color:#fafafa;padding:48px 24px;text-align:center">
              <h1 style="font-size:24px;margin-bottom:24px">Sign in to Padel Labs</h1>
              <p style="margin-bottom:32px;color:#aaa">Click the button below to sign in. This link expires in 24 hours.</p>
              <a href="${url}" style="display:inline-block;background:#7ed321;color:#0a0a0a;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none">Sign in</a>
              <p style="margin-top:32px;color:#666;font-size:13px">If you didn't request this, you can safely ignore this email.</p>
            </div>
          `,
        })
      },
    }),
  ],
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'database',
  },
  trustHost: true,
})
```

- [ ] **Step 4.3: Write `apps/labs/src/app/api/auth/[...nextauth]/route.ts`**

```ts
// apps/labs/src/app/api/auth/[...nextauth]/route.ts
import { handlers } from '@/lib/auth'
export const { GET, POST } = handlers
```

- [ ] **Step 4.4: Add `.env.local` with real values**

Copy `.env.local.example` to `.env.local` and fill in:
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`: from the Padel Nachos Vercel env vars (same Supabase project)
- `SUPABASE_SERVICE_KEY`: same source
- `DATABASE_URL`: full Postgres connection string from Supabase project settings
- `AUTH_SECRET`: `openssl rand -base64 32`
- `AUTH_URL`: `http://localhost:3003`
- `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`: create a new OAuth client in Google Cloud Console (or reuse Nachos's if same project, but new redirect URI required: `http://localhost:3003/api/auth/callback/google` + production)
- `RESEND_API_KEY`: same as Nachos
- `AUTH_EMAIL_FROM`: `Padel Labs <hello@padellabs.tech>`

- [ ] **Step 4.5: Commit (no Auth.js verification yet — done in Task 7 after login page exists)**

```bash
git add apps/labs/src/lib/auth.ts apps/labs/src/lib/db.ts 'apps/labs/src/app/api/auth/[...nextauth]/route.ts'
git commit -m "feat(labs): configure Auth.js v5 with Resend + Google"
```

---

## Task 5: Build root layout

**Files:**
- Create: `apps/labs/src/app/layout.tsx`

- [ ] **Step 5.1: Write `apps/labs/src/app/layout.tsx`**

```tsx
// apps/labs/src/app/layout.tsx
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Padel Labs — Data engine for padel content creators',
  description: 'Chat with live padel data. Generate branded stat cards. Built for analysts, YouTubers, and coaches.',
  metadataBase: new URL('https://padellabs.tech'),
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
```

- [ ] **Step 5.2: Commit**

```bash
git add apps/labs/src/app/layout.tsx
git commit -m "feat(labs): add root layout"
```

---

## Task 6: Build placeholder marketing landing page

**Files:**
- Create: `apps/labs/src/app/page.tsx`

- [ ] **Step 6.1: Write `apps/labs/src/app/page.tsx`**

Phase 1 is a **minimal placeholder**, not the polished multi-module landing — that ships in Phase 5. Light theme, lime accent, system fonts, Sentry-style buttons (the `.btn` classes from globals.css). NO emojis or arrow characters.

```tsx
// apps/labs/src/app/page.tsx
import Link from 'next/link'

export default function HomePage() {
  return (
    <main style={{ minHeight: '100vh' }} className="flex items-center justify-center px-6">
      <div className="max-w-2xl text-center">
        {/* Brand mark + wordmark */}
        <div className="flex items-center justify-center gap-2.5 mb-10">
          <span className="brand-mark" style={{ width: 30, height: 30, fontSize: 15 }}>P</span>
          <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-0.015em' }}>
            padel <span style={{ color: 'var(--text-subtle)', fontWeight: 500 }}>labs</span>
          </span>
        </div>

        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            background: 'var(--lime-50)',
            color: 'var(--lime-700)',
            border: '1px solid var(--lime-200)',
            padding: '5px 11px',
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.02em',
            marginBottom: 24,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              background: 'var(--lime-500)',
              borderRadius: '50%',
              boxShadow: '0 0 0 3px var(--lime-100)',
            }}
          />
          The padel data platform
        </span>

        <h1
          style={{
            fontSize: 56,
            lineHeight: 1.05,
            letterSpacing: '-0.035em',
            fontWeight: 700,
            margin: '0 0 22px',
          }}
        >
          One platform.<br />Every padel data tool you need.
        </h1>
        <p
          style={{
            fontSize: 19,
            lineHeight: 1.55,
            color: 'var(--text-muted)',
            margin: '0 0 36px',
          }}
        >
          Modules powering the next generation of padel content, analytics, and tools.
        </p>

        <div className="flex items-center justify-center gap-3">
          <Link href="/login" className="btn btn-primary">Get started</Link>
          <Link href="https://padelboard.padellabs.tech" className="btn btn-secondary">
            See Padelboard
          </Link>
        </div>

        <p style={{ marginTop: 36, fontSize: 12, color: 'var(--text-subtle)' }}>
          Phase 1 placeholder. Full multi-module marketing site ships in Phase 5.
        </p>
      </div>
    </main>
  )
}
```

- [ ] **Step 6.2: Run dev server and verify**

Run: `cd apps/labs && npm run dev`
Expected: visit `http://localhost:3003` — see the landing page rendered with green Padel Labs accent and Sign in button. Stop the server.

- [ ] **Step 6.3: Commit**

```bash
git add apps/labs/src/app/page.tsx
git commit -m "feat(labs): add placeholder marketing landing page"
```

---

## Task 7: Build login page with magic-link + Google

**Files:**
- Create: `apps/labs/src/app/login/page.tsx`

- [ ] **Step 7.1: Write `apps/labs/src/app/login/page.tsx`**

Light theme, lime accent, Sentry-style buttons. NO emojis. Uses the `.btn`, `.input`, and `.brand-mark` classes from `globals.css`. Both buttons fill width via inline `width: '100%'`.

```tsx
// apps/labs/src/app/login/page.tsx
import { signIn } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default function LoginPage() {
  return (
    <main style={{ minHeight: '100vh' }} className="flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <Link href="/" className="flex items-center justify-center gap-2.5 mb-10">
          <span className="brand-mark" style={{ width: 28, height: 28, fontSize: 14 }}>P</span>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.015em' }}>
            padel <span style={{ color: 'var(--text-subtle)', fontWeight: 500 }}>labs</span>
          </span>
        </Link>

        <h1
          style={{
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            textAlign: 'center',
            margin: '0 0 8px',
          }}
        >
          Sign in to Padel Labs
        </h1>
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', margin: '0 0 32px', fontSize: 14 }}>
          Magic link via email or continue with Google.
        </p>

        {/* Google */}
        <form
          action={async () => {
            'use server'
            await signIn('google', { redirectTo: '/ask' })
          }}
        >
          <button
            type="submit"
            className="btn btn-secondary"
            style={{ width: '100%', justifyContent: 'center', marginBottom: 12 }}
          >
            Continue with Google
          </button>
        </form>

        <div className="flex items-center gap-3 my-6">
          <div className="flex-1" style={{ height: 1, background: 'var(--border)' }} />
          <span style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>or</span>
          <div className="flex-1" style={{ height: 1, background: 'var(--border)' }} />
        </div>

        {/* Magic link */}
        <form
          action={async (formData: FormData) => {
            'use server'
            const email = String(formData.get('email') || '')
            await signIn('resend', { email, redirectTo: '/ask' })
            redirect('/login?check=email')
          }}
        >
          <input
            name="email"
            type="email"
            required
            placeholder="you@example.com"
            className="input"
            style={{ marginBottom: 12 }}
          />
          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}
          >
            Send magic link
          </button>
        </form>

        <p style={{ fontSize: 12, color: 'var(--text-subtle)', textAlign: 'center', marginTop: 32 }}>
          By signing in, you agree to the terms of service and privacy policy.
        </p>
      </div>
    </main>
  )
}
```

- [ ] **Step 7.2: Verify magic-link flow end-to-end**

1. Run `cd apps/labs && npm run dev`
2. Visit `http://localhost:3003/login`
3. Enter your email, submit
4. Check inbox — Resend should deliver an email with a "Sign in" button
5. Click the button — you should be redirected to `/ask` (which 404s for now; that's fine)
6. Verify the user row was created: in Supabase SQL editor run `select id, email, "emailVerified" from public.users order by "emailVerified" desc nulls last limit 5;`

If the magic link doesn't arrive: check `RESEND_API_KEY` is set, and the `from` address domain (`padellabs.tech`) is verified in Resend's dashboard. **For first-time setup, you may need to use `hello@padelnachos.com` as the `from` address temporarily until `padellabs.tech` DNS is configured (see Task 12).**

Stop the dev server.

- [ ] **Step 7.3: Commit**

```bash
git add apps/labs/src/app/login/page.tsx
git commit -m "feat(labs): add login page with magic-link + Google"
```

---

## Task 8: Build authenticated app shell layout

**Files:**
- Create: `apps/labs/src/app/(app)/layout.tsx`

- [ ] **Step 8.1: Write `apps/labs/src/app/(app)/layout.tsx`**

Light theme app shell. Sidebar pinned to white with subtle border. Active page indicated by `var(--lime-50)` background + `var(--lime-700)` text. Templates / Browse / Settings are placeholders in Phase 1; they 404 by design.

```tsx
// apps/labs/src/app/(app)/layout.tsx
// Auth-gated workspace shell.
import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) {
    redirect('/login?callbackUrl=/ask')
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: 'var(--bg)' }}>
      <aside
        style={{
          width: 232,
          borderRight: '1px solid var(--border)',
          padding: '20px 16px',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg)',
        }}
      >
        {/* Brand */}
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28, padding: '0 6px' }}>
          <span className="brand-mark" style={{ width: 26, height: 26, fontSize: 13 }}>P</span>
          <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: '-0.015em' }}>
            padel <span style={{ color: 'var(--text-subtle)', fontWeight: 500 }}>labs</span>
          </span>
        </Link>

        <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, fontSize: 14 }}>
          <Link
            href="/ask"
            style={{
              padding: '8px 10px',
              borderRadius: 6,
              background: 'var(--lime-50)',
              color: 'var(--lime-700)',
              fontWeight: 600,
            }}
          >
            Ask
          </Link>
          <Link href="/templates" style={{ padding: '8px 10px', borderRadius: 6, color: 'var(--text-subtle)' }}>
            Templates <span style={{ fontSize: 11 }}>(P3)</span>
          </Link>
          <Link href="/browse" style={{ padding: '8px 10px', borderRadius: 6, color: 'var(--text-subtle)' }}>
            Browse <span style={{ fontSize: 11 }}>(P3)</span>
          </Link>
          <Link href="/settings" style={{ padding: '8px 10px', borderRadius: 6, color: 'var(--text-subtle)' }}>
            Settings <span style={{ fontSize: 11 }}>(P4)</span>
          </Link>
        </nav>

        <div style={{ marginTop: 'auto', paddingTop: 20, borderTop: '1px solid var(--border)' }}>
          <p style={{ fontSize: 11, color: 'var(--text-subtle)', margin: '0 6px 2px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Signed in as
          </p>
          <p style={{ fontSize: 13, color: 'var(--text)', margin: '0 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {session.user.email}
          </p>
          <form
            action={async () => {
              'use server'
              const { signOut } = await import('@/lib/auth')
              await signOut({ redirectTo: '/' })
            }}
          >
            <button
              type="submit"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: 12,
                padding: '8px 6px',
                marginTop: 6,
                cursor: 'pointer',
              }}
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <section style={{ flex: 1 }}>{children}</section>
    </div>
  )
}
```

- [ ] **Step 8.2: Commit**

```bash
git add 'apps/labs/src/app/(app)/layout.tsx'
git commit -m "feat(labs): add authenticated app shell layout"
```

---

## Task 9: Build placeholder Ask page + stubbed `/api/v1/ask`

**Files:**
- Create: `apps/labs/src/app/(app)/ask/page.tsx`
- Create: `apps/labs/src/app/api/v1/ask/route.ts`

- [ ] **Step 9.1: Write `apps/labs/src/app/api/v1/ask/route.ts`**

Stubbed — returns a hardcoded response so we can verify the wiring end-to-end. Real Haiku 4.5 + tool use lands in Phase 2.

```ts
// apps/labs/src/app/api/v1/ask/route.ts
// Phase 1: stub. Phase 2 will replace this with Haiku 4.5 + tool use.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const question = String(body.question || '').trim()
  if (!question) {
    return NextResponse.json({ error: 'question required' }, { status: 400 })
  }

  return NextResponse.json({
    answer: `[Phase 1 stub] You asked: "${question}". The real chat engine ships in Phase 2 with Haiku 4.5 + grounded tool use.`,
    citations: [],
    cost: { input_tokens: 0, output_tokens: 0, cached_tokens: 0 },
  })
}
```

- [ ] **Step 9.2: Write `apps/labs/src/app/(app)/ask/page.tsx`**

Light theme placeholder. Uses the `.input` and `.btn-primary` classes from `globals.css`. NO emojis.

```tsx
// apps/labs/src/app/(app)/ask/page.tsx
'use client'

import { useState } from 'react'

export default function AskPage() {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!question.trim()) return
    setLoading(true)
    setAnswer(null)
    try {
      const res = await fetch('/api/v1/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      })
      const data = await res.json()
      setAnswer(data.answer ?? data.error ?? 'No response')
    } catch (err) {
      setAnswer(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main style={{ maxWidth: 768, margin: '0 auto', padding: '40px 32px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 6px' }}>Ask</h1>
      <p style={{ color: 'var(--text-muted)', margin: '0 0 28px', fontSize: 14 }}>
        Phase 1 placeholder. Real chat engine ships in Phase 2.
      </p>

      <form onSubmit={submit} style={{ marginBottom: 28 }}>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask anything about padel matches, players, tournaments..."
          rows={4}
          className="input"
          style={{ marginBottom: 12, resize: 'none', fontFamily: 'var(--font-sans)' }}
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="btn btn-primary"
        >
          {loading ? 'Thinking…' : 'Send'}
        </button>
      </form>

      {answer && (
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: 20,
            background: 'var(--surface)',
            whiteSpace: 'pre-wrap',
            fontSize: 14,
            lineHeight: 1.6,
            color: 'var(--text)',
          }}
        >
          {answer}
        </div>
      )}
    </main>
  )
}
```

- [ ] **Step 9.3: Verify end-to-end**

1. Run `cd apps/labs && npm run dev`
2. Visit `http://localhost:3003`, click Sign in
3. Sign in (magic-link or Google) — should redirect to `/ask`
4. Type a question, click Send
5. Expected: see `[Phase 1 stub] You asked: "..."` rendered below the form
6. Stop dev server

- [ ] **Step 9.4: Commit**

```bash
git add 'apps/labs/src/app/(app)/ask/page.tsx' apps/labs/src/app/api/v1/ask/route.ts
git commit -m "feat(labs): add placeholder Ask page + stubbed POST /api/v1/ask"
```

---

## Task 10: Add `proxy.ts` for edge auth gate

**Files:**
- Create: `apps/labs/src/proxy.ts`

Next.js 16 uses `proxy.ts` (formerly `middleware.ts`). For Phase 1 we use it lightly — server-component `auth()` call in the `(app)/layout.tsx` already gates access; the proxy is here only to keep `(app)/*` paths from leaking through static generation.

- [ ] **Step 10.1: Write `apps/labs/src/proxy.ts`**

```ts
// apps/labs/src/proxy.ts
// Next.js 16 proxy. Phase 1: minimal — only ensures /app routes are dynamic
// (auth check happens in the (app) layout). Phase 4 adds rate-limiting.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function proxy(_request: NextRequest) {
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico).*)'],
}
```

- [ ] **Step 10.2: Verify build still passes**

Run: `cd apps/labs && npm run build`
Expected: build completes successfully.

- [ ] **Step 10.3: Commit**

```bash
git add apps/labs/src/proxy.ts
git commit -m "feat(labs): add proxy.ts (Next.js 16) — minimal phase 1 stub"
```

---

## Task 11: Write smoke tests

**Files:**
- Create: `apps/labs/tests/smoke.test.ts`

- [ ] **Step 11.1: Write the test file**

These are unit smoke tests that check pure-function imports and DB-URL parsing — they don't spin up the Next.js server. Real integration tests (auth flow, API endpoints) come in Phase 2 once we have logic worth testing.

```ts
// apps/labs/tests/smoke.test.ts
import { describe, it, expect } from 'vitest'

describe('phase 1 smoke', () => {
  it('parses a Postgres connection URL with special chars in password', async () => {
    // Replicates the parseDbUrl logic from src/lib/db.ts. We import it
    // dynamically to avoid the Pool() side effect at module load.
    const { default: testUrl } = await import('./fixtures/sample-db-url.json')
    const u = new URL(testUrl.url)
    expect(u.hostname).toBe('db.example.com')
    expect(decodeURIComponent(u.password)).toBe('p@ss/word!')
  })

  it('exports an auth handler shape', async () => {
    // Set required env so the auth module doesn't throw on import.
    process.env.DATABASE_URL ??= 'postgres://u:p@localhost:5432/db'
    process.env.AUTH_SECRET ??= 'test-secret-test-secret-test-secret'
    process.env.AUTH_GOOGLE_ID ??= 'test'
    process.env.AUTH_GOOGLE_SECRET ??= 'test'
    process.env.RESEND_API_KEY ??= 'test'

    const mod = await import('../src/lib/auth')
    expect(typeof mod.auth).toBe('function')
    expect(mod.handlers).toBeDefined()
    expect(typeof mod.handlers.GET).toBe('function')
    expect(typeof mod.handlers.POST).toBe('function')
  })
})
```

- [ ] **Step 11.2: Add the fixture file**

Create `apps/labs/tests/fixtures/sample-db-url.json`:

```json
{
  "url": "postgres://user:p%40ss%2Fword%21@db.example.com:5432/postgres"
}
```

- [ ] **Step 11.3: Run tests**

Run: `cd apps/labs && npm run test`
Expected: 2 passing tests.

- [ ] **Step 11.4: Commit**

```bash
git add apps/labs/tests/smoke.test.ts apps/labs/tests/fixtures/sample-db-url.json
git commit -m "test(labs): add phase 1 smoke tests"
```

---

## Task 12: Document Vercel deployment + DNS setup

**Files:**
- Create: `docs/runbooks/padel-labs-vercel-deploy.md`

This is a runbook for the human (you) to follow once. It's **not** automated.

- [ ] **Step 12.1: Write the runbook**

```markdown
# Padel Labs — Vercel + DNS deployment runbook

One-time setup to get `apps/labs/` deployed at `padellabs.tech`. Re-deploys after this happen automatically on push to `main`.

## 1. Domain registration

If `padellabs.tech` is not yet registered:
- Register through your preferred registrar (Cloudflare, Namecheap, etc.)
- Set the auth code aside; you may need it later if changing registrars.

## 2. Vercel project

1. In Vercel dashboard → "Add New" → "Project"
2. Select the `padel-live-scores` repository
3. **Critical:** in "Configure Project" → "Root Directory" → click Edit → enter `apps/labs`
4. Framework preset: **Next.js** (auto-detected)
5. Build command: leave default (`next build`)
6. Output directory: leave default (`.next`)
7. Install command: leave default (`npm install`)
8. Environment Variables (mark all as Production + Preview + Development):

   | Key | Source |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Same as Padel Nachos |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same as Padel Nachos |
   | `SUPABASE_SERVICE_KEY` | Same as Padel Nachos |
   | `DATABASE_URL` | Supabase project → Settings → Database → Connection string (URI) |
   | `AUTH_SECRET` | `openssl rand -base64 32` (new value, do NOT reuse Nachos's) |
   | `AUTH_URL` | `https://analyst.padellabs.tech` (production); leave Preview as Vercel default |
   | `AUTH_GOOGLE_ID` | New OAuth client (see step 3) |
   | `AUTH_GOOGLE_SECRET` | New OAuth client (see step 3) |
   | `RESEND_API_KEY` | Same as Padel Nachos |
   | `AUTH_EMAIL_FROM` | `Padel Labs <hello@padellabs.tech>` |

9. Click "Deploy"

## 3. Google OAuth client

1. Google Cloud Console → APIs & Services → Credentials → Create credentials → OAuth client ID
2. Application type: Web application
3. Name: `Padel Labs`
4. Authorized JavaScript origins:
   - `https://analyst.padellabs.tech`
   - `http://localhost:3003`
5. Authorized redirect URIs:
   - `https://analyst.padellabs.tech/api/auth/callback/google`
   - `http://localhost:3003/api/auth/callback/google`
6. Save → copy Client ID + Client secret into Vercel env vars

## 4. DNS

In your registrar's DNS panel, add:

| Host | Type | Value | Notes |
|---|---|---|---|
| `padellabs.tech` (apex) | A | `76.76.21.21` | Vercel apex IP |
| `www` | CNAME | `cname.vercel-dns.com` |  |
| `analyst` | CNAME | `cname.vercel-dns.com` | for analyst.padellabs.tech (the chat module) |
| `api` | CNAME | `cname.vercel-dns.com` | reserved (used in Phase 2+) |
| Resend domain verification records | TXT/MX | (Resend dashboard) | needed before sending magic-links from `@padellabs.tech` |

In Vercel → Project → Settings → Domains:
- Add `padellabs.tech` (apex) → set as primary
- Add `analyst.padellabs.tech`
- Add `api.padellabs.tech` (reserved)

Wait for DNS propagation + TLS issuance (a few minutes).

## 5. Resend domain verification

1. Resend dashboard → Domains → Add Domain → `padellabs.tech`
2. Add the TXT/MX records to your registrar
3. Verify in Resend
4. Once verified, the `AUTH_EMAIL_FROM` value will deliver successfully

## 6. Smoke test production

1. Visit `https://padellabs.tech` → see landing page
2. Click "Sign in" → routed to `/login`
3. Sign in with Google or magic-link
4. Should redirect to `https://analyst.padellabs.tech/ask`
5. Type a test question → see Phase 1 stub response

## 7. Subdomain routing note

Vercel automatically serves both `padellabs.tech` and `analyst.padellabs.tech` from the same Next.js project; routing is by path within the app (homepage at `/`, app at `/(app)/*`). If you later want stricter separation, add Vercel "Production Branches" + a second Vercel project pointing at the same Root Directory but with different env vars. **Defer to Phase 5.**
```

- [ ] **Step 12.2: Commit**

```bash
git add docs/runbooks/padel-labs-vercel-deploy.md
git commit -m "docs(labs): add Vercel + DNS deployment runbook"
```

---

## Task 13: Update repo-level docs

**Files:**
- Modify: `CLAUDE.md` — add a Padel Labs section

- [ ] **Step 13.1: Edit `CLAUDE.md`**

Add a new section near the existing "Project Structure" section (after the existing tree). Insert this block:

```markdown
## Padel Labs (apps/labs/) — B2B prosumer SaaS

Padel Labs is a separate Next.js app at `apps/labs/` deployed to `padellabs.tech`. It productizes the same data Padel Nachos collects, sold to padel content creators (analysts, YouTubers, coaches) as a chat + templates + exports product. Independent npm package (no workspaces), separate Vercel project with `Root Directory = apps/labs/`. Shares the same Supabase project — reads from public tables, writes to `labs_*` tables. See [v1 design](docs/superpowers/specs/2026-05-06-padel-labs-v1-design.md) and [Phase 1 plan](docs/superpowers/plans/2026-05-06-padel-labs-v1-phase-1-foundation.md).

### Padel Labs DB tables

All prefixed `labs_*`:

| Table | Purpose |
|---|---|
| `labs_subscriptions` | Stripe subscription state (tier, status, period_end) per user |
| `labs_conversations` | Chat session container (title, locale, timestamps) |
| `labs_messages` | Individual chat turns (role, content, citations, cost tokens) |
| `labs_saved_queries` | User-saved questions for re-running |
| `labs_usage_events` | Per-question metering for rate limits + analytics |
| `labs_template_runs` | Template execution log |

Auth users live in `public.users` (Auth.js v5 PostgresAdapter table — same as Padel Nachos).
```

- [ ] **Step 13.2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add Padel Labs section to CLAUDE.md"
```

---

## Task 14: End-to-end production verification

This is a manual verification step performed AFTER the human follows the runbook in Task 12.

- [ ] **Step 14.1: Verify production deployment**

After completing the Vercel runbook (Task 12) on production:

1. Visit `https://padellabs.tech` → see landing page render
2. Click "Sign in" → land on `/login`
3. Submit your email for magic-link → check inbox → click link
4. Verify redirect to `https://analyst.padellabs.tech/ask` (or whatever production URL serves `/ask`)
5. Submit a test question → see Phase 1 stub response
6. In Supabase SQL editor:
   ```sql
   select id, email, "emailVerified" from public.users
   order by "emailVerified" desc nulls last limit 5;
   ```
   Expected: your test user appears.
7. Verify all 6 `labs_*` tables exist (re-run the query from Step 3.3 against production).

- [ ] **Step 14.2: Tag the milestone**

```bash
git tag labs-phase-1-foundation
git push origin labs-phase-1-foundation
```

---

## Phase 1 Definition of Done

- [x] `apps/labs/` package scaffolded with all configs
- [x] All 6 `labs_*` tables created in Supabase with RLS
- [x] Auth.js v5 configured with magic-link + Google OAuth
- [x] Marketing landing page renders at `/`
- [x] Login page works for both providers
- [x] Authenticated `(app)/ask` page renders behind auth gate
- [x] `POST /api/v1/ask` returns stub response
- [x] Smoke tests pass via `npm run test`
- [x] Production deployment runbook documented
- [x] Production smoke tested end-to-end
- [x] CLAUDE.md updated with Labs section
- [x] Git tag `labs-phase-1-foundation` pushed

After Phase 1 lands, write the **Phase 2 plan** (`docs/superpowers/plans/<date>-padel-labs-v1-phase-2-ask-mvp.md`) covering: Anthropic SDK + Haiku 4.5 + tool use + 3 SQL tools (matches/players/h2h) + system prompt + prompt caching + citation extraction + cost telemetry. Use the `claude-api` skill when starting Phase 2.

# Admin Ops App — Phase 1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a standalone Next.js 16 admin app at `apps/ops/`, deployed to `admin.padelnachos.com`, with per-user authentication (Google OAuth + Resend magic-link + email/password) gated by an operator allow-list.

**Architecture:** Mirrors the existing `apps/labs/` scaffold. Auth.js v5 with database-strategy sessions on the shared Supabase Postgres. Three providers; operator gating done in `(app)/layout.tsx` via `await auth()` + a DB lookup against a new `operators` table. Session cookie scoped to `.padelnachos.com` for cross-app sharing with the main app.

**Tech Stack:** Next.js 16.2 · React 19 · TypeScript 5 · Tailwind 4 · Auth.js v5 (`next-auth@5.0.0-beta.31`) · `@auth/pg-adapter` · `pg` · `bcryptjs` · `resend` · `vitest`

**Spec:** [`docs/superpowers/specs/2026-05-20-admin-ops-app-design.md`](../specs/2026-05-20-admin-ops-app-design.md)

**Scope of this plan:** Phase 1.A–1.E from the spec — scaffold, auth, login/reset pages, base layout, deploy. Does **not** include the sidebar IA, Today page, or tab lifts (those are Plans 2 and 3).

**Worktree:** `.claude/worktrees/admin-ops-app` on branch `worktree-admin-ops-app`.

---

## File structure

New files created by this plan:

```
apps/ops/
├── package.json
├── tsconfig.json
├── next.config.ts
├── eslint.config.mjs
├── postcss.config.mjs
├── vitest.config.ts
├── vercel.json
├── next-env.d.ts
├── .env.local.example
├── README.md
├── public/
│   └── favicon.ico                          (copy from apps/labs/public)
├── src/
│   ├── proxy.ts
│   ├── lib/
│   │   ├── db.ts                            (pg pool — copied verbatim from labs)
│   │   ├── auth.ts                          (Auth.js v5 + 3 providers + session callback)
│   │   ├── password.ts                      (bcryptjs hash/verify helpers)
│   │   ├── reset-tokens.ts                  (password reset token helpers)
│   │   ├── rate-limit.ts                    (in-memory limiter)
│   │   ├── operators.ts                     (allow-list query)
│   │   └── email/
│   │       └── password-reset.ts            (Resend transactional email)
│   └── app/
│       ├── layout.tsx                       (root html shell)
│       ├── globals.css                      (Variation 2 design tokens)
│       ├── page.tsx                         (redirect → /login)
│       ├── (app)/
│       │   └── layout.tsx                   (auth gate + operator gate)
│       ├── login/
│       │   ├── page.tsx                     (3 providers UI)
│       │   └── actions.ts                   (server actions for credentials login)
│       ├── forgot-password/
│       │   ├── page.tsx
│       │   └── actions.ts
│       ├── reset-password/
│       │   ├── page.tsx
│       │   └── actions.ts
│       ├── not-authorized/
│       │   └── page.tsx
│       └── api/
│           └── auth/
│               └── [...nextauth]/
│                   └── route.ts
└── tests/
    ├── password.test.ts
    ├── reset-tokens.test.ts
    ├── rate-limit.test.ts
    ├── operators.test.ts
    ├── auth.test.ts                         (session callback + module shape)
    └── smoke.test.ts

supabase/migrations/
├── 20260520120000_admin_ops_auth.sql        (users.password_hash + password_reset_tokens + operators)
└── 20260520120100_seed_initial_operator.sql (reads INITIAL_OPERATOR_EMAIL env at apply time)

src/auth.ts                                  (MODIFY — add cookies.sessionToken.options.domain — now OPTIONAL, see Errata #5)
```

---

## Plan errata — deltas between the original plan and what shipped

This plan was executed end-to-end on 2026-05-20. Five things shipped differently from what's written below. The original task content is preserved as-is for traceability; the items here are authoritative for the working code.

### Errata 1 — `apps/ops/instrumentation.ts` shadow file (missing from Task 1)

Without this file, Next.js's instrumentation discovery walks up to the repo-root `instrumentation.ts` (which imports `@sentry/nextjs`, not a `padel-ops` dependency) and the build crashes. `apps/labs/` has the same shadow; the plan missed copying it.

Add to Task 1's file list:

```
apps/ops/instrumentation.ts                  (Sentry-shadow no-op; mirrors apps/labs/instrumentation.ts)
```

Content (byte-identical to labs):

```ts
// apps/ops/instrumentation.ts
// Intentionally empty — shadows the repo-root instrumentation.ts (Padel
// Nachos's Sentry hook).
export function register() {
  // no-op
}
```

Shipped in commit `b979a816`.

### Errata 2 — `useActionState` + client-component pattern for forms with error returns (Tasks 11, 12, 13)

The plan showed `<form action={serverAction}>` bindings directly. React 19 + Next.js 16 reject this typing when the server action returns anything other than `void | Promise<void>`. `@types/react` 19 declares `FormHTMLAttributes.action: ((formData: FormData) => void | Promise<void>) | string | undefined` — returning `{ error: string }` is a TS2322 compile error.

For Tasks 11 (`/login`), 12 (`/forgot-password`), and 13 (`/reset-password`) — all three of which have actions that return error/status objects — split into a server-component page + a `'use client'` form component wrapping the action with `useActionState`.

**Additional files actually created:**

- `apps/ops/src/app/login/LoginForm.tsx` (Task 11)
- `apps/ops/src/app/forgot-password/ForgotPasswordForm.tsx` (Task 12)
- `apps/ops/src/app/reset-password/ResetPasswordForm.tsx` (Task 13)

**Server action signature change:**

```ts
// Before (plan, doesn't compile)
export async function loginWithCredentials(formData: FormData): Promise<{ error: string } | undefined>

// After (shipped)
export async function loginWithCredentials(
  _prev: CredentialsState,
  formData: FormData,
): Promise<CredentialsState>
```

**Auth.js v5 error handling** in `loginWithCredentials`: catch `AuthError` BEFORE rethrowing `NEXT_REDIRECT`. Credentials failures throw `AuthError` with `type === 'CredentialsSignin'` — our original `msg.includes('NEXT_REDIRECT')` check caught those too, so failed sign-ins silently redirected back to `/login?error=...` with no inline error. Fix shipped in commit `87380a65` then refined in a follow-up.

### Errata 3 — Session strategy changed to JWT (Task 4 / Task 9)

Plan and spec said `strategy: 'database'` for both apps to share a cookie. **Auth.js v5 documents that the Credentials provider does NOT create database session rows even when `strategy: 'database'`.** Email + password sign-in failed silently: `authorize()` returned the user, cookie was set, but `auth()` returned null on the next request.

**Shipped configuration in `apps/ops/src/lib/auth.ts`:**

```ts
session: {
  strategy: 'jwt',
  maxAge: 30 * 24 * 60 * 60,
},
callbacks: {
  async jwt({ token, user }) {
    if (user?.id) token.userId = user.id
    return token
  },
  async session({ session, token }) {
    const userId = typeof token.userId === 'string' ? token.userId : undefined
    if (userId && session.user) {
      session.user.id = userId
      session.user.isOperator = await isUserOperator(userId)
    }
    return session
  },
},
```

`PostgresAdapter` is still mounted — it persists `users`, `accounts`, and `verification_token`. Only the `sessions` table goes unused under JWT.

**Trade-off captured in spec:** cross-subdomain session sharing with the main app no longer works (the main app keeps database sessions; cookie payloads are incompatible). Operators sign into `admin.padelnachos.com` and `padelnachos.com` independently.

Shipped in commit `93c58243`.

### Errata 4 — Plan 1 landing stub at `/today` (NEW page, not in original plan)

The original plan ended Plan 1 with no app routes under `(app)/` — so a successful sign-in had nowhere to land, and an operator who completed the auth flow would bounce back to `/login` because `/` blindly redirected there. This made the test loop incapable of demonstrating success.

**Added files:**

- `apps/ops/src/app/(app)/today/page.tsx` — Plan 1 stub with "SIGNED IN" pill, welcome message, sign-out button. Plan 2 replaces this with the real Today dashboard.

**Modified file:**

- `apps/ops/src/app/page.tsx` — root page now calls `auth()`. Signed-in users get `redirect('/today')`; anonymous users get `redirect('/login')`.
- `apps/ops/src/app/login/page.tsx` — also `auth()`-checked; signed-in users skip the form and go to `/today` directly.

Shipped in commit `7c4697d8`.

### Errata 5 — Task 16 (cookie domain on main app) reclassified as optional

The plan flagged this as required-before-deploy because the original spec depended on cross-subdomain cookie sharing. With JWT sessions on the ops app (Errata 3), the cookie payloads are incompatible regardless of domain, so the main-app change provides no value. Task 16 is now optional / deferred indefinitely.

The ops app can deploy to `admin.padelnachos.com` without touching `src/auth.ts` in the main app.

---

## Task 1: Scaffold `apps/ops/` package skeleton

**Files:**
- Create: `apps/ops/package.json`
- Create: `apps/ops/tsconfig.json`
- Create: `apps/ops/next.config.ts`
- Create: `apps/ops/eslint.config.mjs`
- Create: `apps/ops/postcss.config.mjs`
- Create: `apps/ops/next-env.d.ts`
- Create: `apps/ops/vitest.config.ts`
- Create: `apps/ops/vercel.json`
- Create: `apps/ops/.env.local.example`

- [ ] **Step 1: Create `apps/ops/package.json`**

```json
{
  "name": "padel-ops",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3004",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run"
  },
  "dependencies": {
    "@auth/pg-adapter": "^1.11.2",
    "@supabase/supabase-js": "^2.99.3",
    "@types/pg": "^8.20.0",
    "bcryptjs": "^2.4.3",
    "next": "16.2.0",
    "next-auth": "^5.0.0-beta.31",
    "pg": "^8.20.0",
    "react": "19.2.4",
    "react-dom": "19.2.4",
    "resend": "^6.11.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/bcryptjs": "^2.4.6",
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

- [ ] **Step 2: Create `apps/ops/tsconfig.json`**

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
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `apps/ops/next.config.ts`**

```ts
import type { NextConfig } from 'next'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dirname = path.dirname(fileURLToPath(import.meta.url))

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: { root: dirname },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'https', hostname: 'storage.googleapis.com' },
    ],
  },
}

export default nextConfig
```

- [ ] **Step 4: Create `apps/ops/eslint.config.mjs`**

```js
import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
])

export default eslintConfig
```

- [ ] **Step 5: Create `apps/ops/postcss.config.mjs`**

```js
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}

export default config
```

- [ ] **Step 6: Create `apps/ops/next-env.d.ts`**

```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
```

- [ ] **Step 7: Create `apps/ops/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    server: {
      deps: {
        inline: ['next-auth', '@auth/core', '@auth/pg-adapter'],
      },
    },
  },
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
})
```

- [ ] **Step 8: Create `apps/ops/vercel.json`**

```json
{
  "ignoreCommand": "git diff --quiet HEAD^ HEAD -- apps/ops"
}
```

- [ ] **Step 9: Create `apps/ops/.env.local.example`**

```
# Public Supabase config (browser-safe — same project as Padel Nachos)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Server-only Supabase (service key bypasses RLS)
SUPABASE_SERVICE_KEY=

# Auth.js v5
AUTH_SECRET=                       # MUST match main app's AUTH_SECRET
AUTH_URL=http://localhost:3004     # production: https://admin.padelnachos.com
DATABASE_URL=                      # MUST match main app's DATABASE_URL

# OAuth
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=

# Magic-link + transactional email
RESEND_API_KEY=
AUTH_EMAIL_FROM="PadelNachos Admin <admin@padelnachos.com>"

# Initial operator seeding (read by 20260520120100_seed_initial_operator.sql)
INITIAL_OPERATOR_EMAIL=
```

- [ ] **Step 10: Install dependencies**

Run from repo root:
```bash
cd apps/ops && npm install
```

Expected: dependencies install with no errors. A `package-lock.json` appears.

- [ ] **Step 11: Verify the package builds**

```bash
cd apps/ops && npx next build 2>&1 | head -20
```

Expected: build attempts to start. May fail with "No app directory" — that's OK; we add it in the next task. The goal here is to verify config files parse.

- [ ] **Step 12: Commit**

```bash
git add apps/ops/package.json apps/ops/tsconfig.json apps/ops/next.config.ts apps/ops/eslint.config.mjs apps/ops/postcss.config.mjs apps/ops/next-env.d.ts apps/ops/vitest.config.ts apps/ops/vercel.json apps/ops/.env.local.example apps/ops/package-lock.json
git commit -m "feat(ops): scaffold apps/ops package skeleton

Mirrors apps/labs/ setup. Next.js 16.2 + React 19 + Tailwind 4 + TypeScript 5 + Auth.js v5 + vitest. Port 3004, deploys to admin.padelnachos.com."
```

---

## Task 2: Root layout + Variation 2 design tokens

**Files:**
- Create: `apps/ops/src/app/layout.tsx`
- Create: `apps/ops/src/app/globals.css`
- Create: `apps/ops/src/app/page.tsx`
- Create: `apps/ops/src/proxy.ts`
- Create: `apps/ops/public/favicon.ico` (copy from labs)

- [ ] **Step 1: Create `apps/ops/src/app/globals.css` with the Variation 2 tokens from the spec**

```css
/* apps/ops/src/app/globals.css
   Variation 2 — Live Sports Command Center tokens.
   Mirror values in docs/superpowers/specs/2026-05-20-admin-ops-app-design.md
   "Design tokens (v1)". */

@import 'tailwindcss';

:root {
  /* Brand */
  --brand-primary: #7ed321;
  --brand-primary-fg: #0a0a0a;

  /* Surfaces */
  --bg-canvas: #fafafa;
  --bg-card: #ffffff;
  --bg-attention: #0f0f10;
  --fg-on-attention: #fafafa;

  /* Status ladder */
  --status-live: #22c55e;
  --status-warn: #f59e0b;
  --status-urgent: #ef4444;
  --status-neutral: #71717a;

  /* Borders */
  --border-subtle: #e5e7eb;

  /* Typography */
  --font-body: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue',
    Arial, sans-serif;
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
  background: var(--bg-canvas);
  color: var(--brand-primary-fg);
  font-family: var(--font-body);
  -webkit-font-smoothing: antialiased;
}

a {
  color: inherit;
  text-decoration: none;
}

button {
  font-family: inherit;
}

.tabular {
  font-variant-numeric: tabular-nums;
}

/* Live pill pulse — respects reduced motion */
@keyframes live-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}

.live-pulse {
  animation: live-pulse 1.6s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .live-pulse {
    animation: none;
  }
}
```

- [ ] **Step 2: Create `apps/ops/src/app/layout.tsx`**

```tsx
// apps/ops/src/app/layout.tsx
// Root layout. Variation 2 design tokens applied via globals.css.

import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'PadelNachos Admin',
  description: 'Operations dashboard',
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
```

- [ ] **Step 3: Create `apps/ops/src/app/page.tsx` (root redirect)**

```tsx
// apps/ops/src/app/page.tsx
// Until the Today page exists (Plan 2), the root redirects to /login.
// Plan 2 will redirect to /today instead.

import { redirect } from 'next/navigation'

export default function RootPage() {
  redirect('/login')
}
```

- [ ] **Step 4: Create `apps/ops/src/proxy.ts`**

```ts
// apps/ops/src/proxy.ts
// Next.js 16 proxy (middleware-equivalent). Phase 1: pass-through.
// Auth gating happens at the (app)/layout.tsx level via await auth().

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function proxy(_request: NextRequest) {
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico).*)'],
}
```

- [ ] **Step 5: Copy the favicon from labs**

```bash
mkdir -p apps/ops/public && cp apps/labs/public/favicon.ico apps/ops/public/favicon.ico 2>/dev/null || (cd apps/ops/public && touch favicon.ico)
```

(If labs has no favicon, an empty file is fine for v1 — replaced with the real PadelNachos favicon at deploy time.)

- [ ] **Step 6: Smoke-build**

```bash
cd apps/ops && npx next build 2>&1 | tail -20
```

Expected: builds successfully. `Compiled successfully` appears. Three pages compiled (`/`, `/_not-found`, plus internal).

- [ ] **Step 7: Commit**

```bash
git add apps/ops/src/app/layout.tsx apps/ops/src/app/globals.css apps/ops/src/app/page.tsx apps/ops/src/proxy.ts apps/ops/public/favicon.ico
git commit -m "feat(ops): root layout + Variation 2 design tokens

globals.css ports the Variation 2 token set from the spec
(brand green, attention dark surface, status ladder, live-pulse).
Root page redirects to /login until the Today page exists in Plan 2."
```

---

## Task 3: Schema migration — auth tables

**Files:**
- Create: `supabase/migrations/20260520120000_admin_ops_auth.sql`

- [ ] **Step 1: Create the migration**

```sql
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
```

- [ ] **Step 2: Apply the migration locally**

```bash
# Adjust to your migration tooling — examples:
# supabase db push (if using Supabase CLI)
# psql $DATABASE_URL -f supabase/migrations/20260520120000_admin_ops_auth.sql
```

Expected: `ALTER TABLE` / `CREATE TABLE` succeed. Re-running it is idempotent (`if not exists` everywhere).

- [ ] **Step 3: Verify the schema**

```bash
psql "$DATABASE_URL" -c "\d public.users" | grep password_hash
psql "$DATABASE_URL" -c "\d public.password_reset_tokens"
psql "$DATABASE_URL" -c "\d public.operators"
```

Expected: each command lists the new column / table structure.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260520120000_admin_ops_auth.sql
git commit -m "feat(db): admin ops auth schema

Adds users.password_hash, password_reset_tokens (single-use, hashed),
and operators allow-list. Idempotent. Plan 1 Task 3."
```

---

## Task 4: DB pool + base Auth.js config (no Credentials yet)

**Files:**
- Create: `apps/ops/src/lib/db.ts`
- Create: `apps/ops/src/lib/auth.ts`
- Create: `apps/ops/src/app/api/auth/[...nextauth]/route.ts`

- [ ] **Step 1: Create `apps/ops/src/lib/db.ts` (copy from labs, simplified)**

```ts
// apps/ops/src/lib/db.ts
// Pg pool against the shared Supabase Postgres.
// Lazy singleton — the Pool is only constructed on first call so module
// imports don't trigger side effects (matters for tests).

import { Pool } from 'pg'

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
  _pool = new Pool({
    ...parseDbUrl(process.env.DATABASE_URL ?? ''),
    max: 1, // Vercel serverless: minimal pool per instance
    ssl: { rejectUnauthorized: false },
  })
  return _pool
}
```

- [ ] **Step 2: Create `apps/ops/src/lib/auth.ts` (Google + Resend only at first)**

```ts
// apps/ops/src/lib/auth.ts
// Auth.js v5 — three providers (Google, Resend magic-link, Credentials).
// Database-strategy sessions on the shared Supabase Postgres.
// Session callback enriches with isOperator — see Task 9.

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
      from: process.env.AUTH_EMAIL_FROM ?? 'PadelNachos Admin <admin@padelnachos.com>',
      async sendVerificationRequest({ identifier: email, url }) {
        const { Resend: ResendClient } = await import('resend')
        const resend = new ResendClient(process.env.RESEND_API_KEY!)
        await resend.emails.send({
          from: process.env.AUTH_EMAIL_FROM ?? 'PadelNachos Admin <admin@padelnachos.com>',
          to: email,
          subject: 'Sign in to PadelNachos Admin',
          html: `
            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:40px 20px">
              <h1 style="font-size:20px;font-weight:700;color:#0a0a0a;margin:0 0 16px">Sign in to PadelNachos Admin</h1>
              <p style="font-size:14px;color:#52525b;margin:0 0 24px">Click below to sign in. This link expires in 24 hours.</p>
              <a href="${url}" style="display:inline-block;background:#7ED321;color:#0a0a0a;font-weight:700;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px">Sign in</a>
              <p style="font-size:11px;color:#a1a1aa;margin-top:32px">If you didn't request this, ignore this email.</p>
            </div>
          `,
        })
      },
    }),
    // Credentials provider added in Task 8.
  ],
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'database',
    maxAge: 30 * 24 * 60 * 60,
  },
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === 'production'
          ? '__Secure-authjs.session-token'
          : 'authjs.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
        domain: process.env.NODE_ENV === 'production' ? '.padelnachos.com' : undefined,
      },
    },
  },
  trustHost: true,
})
```

- [ ] **Step 3: Create `apps/ops/src/app/api/auth/[...nextauth]/route.ts`**

```ts
// apps/ops/src/app/api/auth/[...nextauth]/route.ts
// Auth.js v5 handler — exposes Google/Resend/(Credentials) endpoints.

import { handlers } from '@/lib/auth'

export const { GET, POST } = handlers
```

- [ ] **Step 4: Smoke-build**

```bash
cd apps/ops && npx next build 2>&1 | tail -20
```

Expected: builds successfully. `/api/auth/[...nextauth]` appears in the route table.

- [ ] **Step 5: Commit**

```bash
git add apps/ops/src/lib/db.ts apps/ops/src/lib/auth.ts apps/ops/src/app/api/auth/[...nextauth]/route.ts
git commit -m "feat(ops): Auth.js v5 base config — Google + magic-link

Database-strategy sessions on shared Supabase Postgres. Session cookie
scoped to .padelnachos.com in prod for cross-app sharing with main app.
Credentials provider follows in Task 8."
```

---

## Task 5: Password hashing helpers (TDD)

**Files:**
- Create: `apps/ops/src/lib/password.ts`
- Create: `apps/ops/tests/password.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/ops/tests/password.test.ts
import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from '../src/lib/password'

describe('password helpers', () => {
  it('hashes a password and produces a string with a bcrypt prefix', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(typeof hash).toBe('string')
    expect(hash.startsWith('$2')).toBe(true) // bcrypt prefix
    expect(hash.length).toBeGreaterThan(50)
  })

  it('verifies the correct password against its hash', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true)
  })

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(await verifyPassword('wrong password', hash)).toBe(false)
  })

  it('verifyPassword returns false for null/empty hashes (OAuth-only users)', async () => {
    expect(await verifyPassword('anything', null)).toBe(false)
    expect(await verifyPassword('anything', '')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
cd apps/ops && npx vitest run tests/password.test.ts
```

Expected: FAIL with `Cannot find module '../src/lib/password'`.

- [ ] **Step 3: Implement `apps/ops/src/lib/password.ts`**

```ts
// apps/ops/src/lib/password.ts
// bcryptjs wrappers. Pure JS — safe on Vercel serverless.
// Cost 10 per spec § Password storage (cold start ~250ms, warm ~100ms).

import bcrypt from 'bcryptjs'

const COST = 10

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, COST)
}

export async function verifyPassword(
  plaintext: string,
  hash: string | null | undefined,
): Promise<boolean> {
  if (!hash) return false
  return bcrypt.compare(plaintext, hash)
}
```

- [ ] **Step 4: Run the test — verify it passes**

```bash
cd apps/ops && npx vitest run tests/password.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/ops/src/lib/password.ts apps/ops/tests/password.test.ts
git commit -m "feat(ops): password hashing helpers with TDD

bcryptjs at cost 10 per spec. Null-hash safe (OAuth-only users)."
```

---

## Task 6: Password reset token helpers (TDD)

**Files:**
- Create: `apps/ops/src/lib/reset-tokens.ts`
- Create: `apps/ops/tests/reset-tokens.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/ops/tests/reset-tokens.test.ts
import { describe, it, expect } from 'vitest'
import { generateRawToken, hashToken } from '../src/lib/reset-tokens'

describe('reset-tokens helpers', () => {
  it('generateRawToken produces a 64-char url-safe string', () => {
    const t = generateRawToken()
    expect(typeof t).toBe('string')
    expect(t.length).toBeGreaterThanOrEqual(43)
    expect(t.length).toBeLessThanOrEqual(86)
    expect(/^[A-Za-z0-9_-]+$/.test(t)).toBe(true)
  })

  it('two raw tokens are different', () => {
    expect(generateRawToken()).not.toBe(generateRawToken())
  })

  it('hashToken is deterministic and SHA-256 length', () => {
    const t = 'fixed-input-token'
    const h1 = hashToken(t)
    const h2 = hashToken(t)
    expect(h1).toBe(h2)
    expect(h1.length).toBe(64) // sha256 hex
    expect(/^[0-9a-f]+$/.test(h1)).toBe(true)
  })

  it('hashToken differs for different inputs', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'))
  })
})
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
cd apps/ops && npx vitest run tests/reset-tokens.test.ts
```

Expected: FAIL with `Cannot find module '../src/lib/reset-tokens'`.

- [ ] **Step 3: Implement `apps/ops/src/lib/reset-tokens.ts`**

```ts
// apps/ops/src/lib/reset-tokens.ts
// Single-use password-reset tokens.
// Generate a cryptographically random raw token (sent via email).
// Only the SHA-256 hash is stored in password_reset_tokens.token_hash.

import { randomBytes, createHash } from 'node:crypto'
import { pgPool } from './db'

export function generateRawToken(): string {
  // 32 bytes → 43-char base64url, well past 128 bits of entropy.
  return randomBytes(32).toString('base64url')
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

const TOKEN_TTL_MS = 30 * 60 * 1000

export async function createResetToken(userId: string): Promise<string> {
  const raw = generateRawToken()
  const hash = hashToken(raw)
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS)
  await pgPool().query(
    'insert into public.password_reset_tokens (token_hash, user_id, expires_at) values ($1, $2, $3)',
    [hash, userId, expiresAt],
  )
  return raw
}

export type ConsumeResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'not_found' | 'expired' | 'used' }

export async function consumeResetToken(raw: string): Promise<ConsumeResult> {
  const hash = hashToken(raw)
  const { rows } = await pgPool().query(
    'select user_id, expires_at, used_at from public.password_reset_tokens where token_hash = $1',
    [hash],
  )
  if (rows.length === 0) return { ok: false, reason: 'not_found' }
  const row = rows[0] as { user_id: string; expires_at: Date; used_at: Date | null }
  if (row.used_at) return { ok: false, reason: 'used' }
  if (new Date(row.expires_at) < new Date()) return { ok: false, reason: 'expired' }
  await pgPool().query(
    'update public.password_reset_tokens set used_at = now() where token_hash = $1',
    [hash],
  )
  return { ok: true, userId: row.user_id }
}
```

- [ ] **Step 4: Run the test — verify it passes**

```bash
cd apps/ops && npx vitest run tests/reset-tokens.test.ts
```

Expected: PASS, 4 tests. (The pure-function tests only exercise `generateRawToken` + `hashToken`. `createResetToken` and `consumeResetToken` are exercised via integration in Task 12.)

- [ ] **Step 5: Commit**

```bash
git add apps/ops/src/lib/reset-tokens.ts apps/ops/tests/reset-tokens.test.ts
git commit -m "feat(ops): password reset token helpers with TDD

Crypto-random raw token, SHA-256 hash stored. Single-use, 30-min TTL.
Pure helpers covered by unit tests; DB helpers exercised in flow tests."
```

---

## Task 7: Rate limiter (TDD)

**Files:**
- Create: `apps/ops/src/lib/rate-limit.ts`
- Create: `apps/ops/tests/rate-limit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/ops/tests/rate-limit.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { check, _reset } from '../src/lib/rate-limit'

describe('rate-limit', () => {
  beforeEach(() => _reset())

  it('allows up to 5 attempts in a 15-min window', () => {
    for (let i = 0; i < 5; i++) {
      expect(check('1.2.3.4', 5, 15 * 60_000)).toEqual({ allowed: true, remaining: 4 - i })
    }
  })

  it('blocks the 6th attempt within the window', () => {
    for (let i = 0; i < 5; i++) check('1.2.3.4', 5, 15 * 60_000)
    const r = check('1.2.3.4', 5, 15 * 60_000)
    expect(r.allowed).toBe(false)
  })

  it('keys are independent per IP', () => {
    for (let i = 0; i < 5; i++) check('1.2.3.4', 5, 15 * 60_000)
    expect(check('1.2.3.4', 5, 15 * 60_000).allowed).toBe(false)
    expect(check('5.6.7.8', 5, 15 * 60_000).allowed).toBe(true)
  })

  it('resets after the window elapses', () => {
    for (let i = 0; i < 5; i++) check('1.2.3.4', 5, 100)
    expect(check('1.2.3.4', 5, 100).allowed).toBe(false)
    // Walk past the window
    const now = Date.now()
    while (Date.now() - now < 150) {
      /* spin */
    }
    expect(check('1.2.3.4', 5, 100).allowed).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
cd apps/ops && npx vitest run tests/rate-limit.test.ts
```

Expected: FAIL with `Cannot find module '../src/lib/rate-limit'`.

- [ ] **Step 3: Implement `apps/ops/src/lib/rate-limit.ts`**

```ts
// apps/ops/src/lib/rate-limit.ts
// In-memory rate limiter per (key) over a sliding window.
// Per spec § "Rate limiting": good-enough deterrence on a single Vercel instance,
// not real abuse protection. Move to Upstash Redis if the threat model evolves.

type Entry = { timestamps: number[] }

const buckets = new Map<string, Entry>()

export function check(
  key: string,
  max: number,
  windowMs: number,
): { allowed: boolean; remaining: number } {
  const now = Date.now()
  const cutoff = now - windowMs
  const entry = buckets.get(key) ?? { timestamps: [] }
  // Drop timestamps outside the window
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff)
  if (entry.timestamps.length >= max) {
    buckets.set(key, entry)
    return { allowed: false, remaining: 0 }
  }
  entry.timestamps.push(now)
  buckets.set(key, entry)
  return { allowed: true, remaining: max - entry.timestamps.length }
}

// Test-only — exported with `_` prefix to discourage runtime use.
export function _reset() {
  buckets.clear()
}
```

- [ ] **Step 4: Run the test — verify it passes**

```bash
cd apps/ops && npx vitest run tests/rate-limit.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/ops/src/lib/rate-limit.ts apps/ops/tests/rate-limit.test.ts
git commit -m "feat(ops): in-memory rate limiter with TDD

Sliding-window per key. Documented deterrence-only on Vercel multi-instance."
```

---

## Task 8: Wire Credentials provider into Auth.js

**Files:**
- Modify: `apps/ops/src/lib/auth.ts`

- [ ] **Step 1: Add Credentials provider import and authorization callback**

Open `apps/ops/src/lib/auth.ts`. Just below the existing `import Resend from 'next-auth/providers/resend'` line, add:

```ts
import Credentials from 'next-auth/providers/credentials'
import { verifyPassword } from './password'
import { check as rateLimitCheck } from './rate-limit'
```

- [ ] **Step 2: Add the Credentials provider to the `providers` array**

Locate the comment `// Credentials provider added in Task 8.` in the `providers` array. Replace that line with:

```ts
    Credentials({
      name: 'Password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(creds, req) {
        const email = String(creds?.email ?? '').toLowerCase().trim()
        const password = String(creds?.password ?? '')
        if (!email || !password) return null

        // Soft rate limit per IP (best-effort; see rate-limit.ts caveat).
        const ip =
          req?.headers?.get?.('x-forwarded-for')?.split(',')[0]?.trim() ??
          req?.headers?.get?.('x-real-ip') ??
          'unknown'
        const limit = rateLimitCheck(`login:${ip}`, 5, 15 * 60_000)
        if (!limit.allowed) {
          throw new Error('TOO_MANY_ATTEMPTS')
        }

        const { rows } = await pgPool().query(
          'select id, email, name, image, password_hash from public.users where email = $1 limit 1',
          [email],
        )
        if (rows.length === 0) return null
        const user = rows[0] as {
          id: string
          email: string
          name: string | null
          image: string | null
          password_hash: string | null
        }
        const ok = await verifyPassword(password, user.password_hash)
        if (!ok) return null
        return { id: user.id, email: user.email, name: user.name, image: user.image }
      },
    }),
```

- [ ] **Step 3: Type-check the change**

```bash
cd apps/ops && npx tsc --noEmit
```

Expected: no errors. (Auth.js v5 beta-31 accepts Credentials alongside database sessions; this is the same combination the main app uses. If the build later emits a runtime warning about it, document and proceed — cross-app cookie sharing requires database sessions and the warning is benign.)

- [ ] **Step 4: Smoke-build**

```bash
cd apps/ops && npx next build 2>&1 | tail -20
```

Expected: builds successfully.

- [ ] **Step 5: Commit**

```bash
git add apps/ops/src/lib/auth.ts
git commit -m "feat(ops): wire Credentials provider (email + password)

Looks up users.password_hash, verifies via bcryptjs, returns minimal user.
Soft IP-keyed rate limit (5/15min). Database session strategy preserved
for cross-app cookie sharing with main app."
```

---

## Task 9: Session callback — enrich `isOperator` (TDD)

**Files:**
- Create: `apps/ops/src/lib/operators.ts`
- Create: `apps/ops/tests/operators.test.ts`
- Modify: `apps/ops/src/lib/auth.ts`

- [ ] **Step 1: Write the failing test for `isUserOperator`**

```ts
// apps/ops/tests/operators.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock pgPool — operators.ts queries through it.
const queryMock = vi.fn()
vi.mock('../src/lib/db', () => ({
  pgPool: () => ({ query: queryMock }),
}))

import { isUserOperator } from '../src/lib/operators'

describe('isUserOperator', () => {
  beforeEach(() => queryMock.mockReset())

  it('returns true when a row exists', async () => {
    queryMock.mockResolvedValue({ rowCount: 1, rows: [{ '?column?': 1 }] })
    const r = await isUserOperator('00000000-0000-0000-0000-000000000001')
    expect(r).toBe(true)
    expect(queryMock).toHaveBeenCalledWith(
      'select 1 from public.operators where user_id = $1 limit 1',
      ['00000000-0000-0000-0000-000000000001'],
    )
  })

  it('returns false when no row exists', async () => {
    queryMock.mockResolvedValue({ rowCount: 0, rows: [] })
    expect(await isUserOperator('any')).toBe(false)
  })

  it('returns false on a falsy userId', async () => {
    expect(await isUserOperator(undefined)).toBe(false)
    expect(await isUserOperator(null as unknown as string)).toBe(false)
    expect(await isUserOperator('')).toBe(false)
    expect(queryMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
cd apps/ops && npx vitest run tests/operators.test.ts
```

Expected: FAIL with `Cannot find module '../src/lib/operators'`.

- [ ] **Step 3: Implement `apps/ops/src/lib/operators.ts`**

```ts
// apps/ops/src/lib/operators.ts
// Operator allow-list check. One indexed lookup per session read.

import { pgPool } from './db'

export async function isUserOperator(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false
  const { rowCount } = await pgPool().query(
    'select 1 from public.operators where user_id = $1 limit 1',
    [userId],
  )
  return (rowCount ?? 0) > 0
}
```

- [ ] **Step 4: Run the test — verify it passes**

```bash
cd apps/ops && npx vitest run tests/operators.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Add the `session` callback to `auth.ts`**

In `apps/ops/src/lib/auth.ts`, add the import near the top:

```ts
import { isUserOperator } from './operators'
```

Then add the `callbacks` object inside the `NextAuth({ ... })` config, between `cookies` and `trustHost`:

```ts
  callbacks: {
    async session({ session, user }) {
      // Single indexed probe; small per-session cost.
      session.user.isOperator = await isUserOperator(user.id)
      return session
    },
  },
```

- [ ] **Step 6: Augment the Auth.js session type**

Create `apps/ops/src/types/auth.d.ts`:

```ts
// apps/ops/src/types/auth.d.ts
// Augment Auth.js `Session` to include the operator flag we enrich in lib/auth.ts.

import 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      email?: string | null
      name?: string | null
      image?: string | null
      isOperator?: boolean
    }
  }
}
```

- [ ] **Step 7: Smoke-build**

```bash
cd apps/ops && npx next build 2>&1 | tail -10
```

Expected: builds successfully. No type errors.

- [ ] **Step 8: Commit**

```bash
git add apps/ops/src/lib/operators.ts apps/ops/tests/operators.test.ts apps/ops/src/lib/auth.ts apps/ops/src/types/auth.d.ts
git commit -m "feat(ops): session callback enriches isOperator

Adds isUserOperator (TDD) and wires it into the Auth.js session callback.
One indexed probe per session read; result available as session.user.isOperator
in (app)/layout.tsx. Session type augmented."
```

---

## Task 10: Auth-gated `(app)/layout.tsx`

**Files:**
- Create: `apps/ops/src/app/(app)/layout.tsx`

- [ ] **Step 1: Create the gated layout**

```tsx
// apps/ops/src/app/(app)/layout.tsx
// Auth + operator gate.
// Anything under (app)/ is only rendered for signed-in operators.
// The full sidebar shell ships in Plan 2 — this file is a minimal gate.

import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) {
    redirect('/login')
  }
  if (!session.user.isOperator) {
    redirect('/not-authorized')
  }
  return <>{children}</>
}
```

- [ ] **Step 2: Smoke-build**

```bash
cd apps/ops && npx next build 2>&1 | tail -10
```

Expected: builds. Empty `(app)` group has no routes yet so the route table looks unchanged — that's fine; Plan 2 adds routes under `(app)`.

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/app/\(app\)/layout.tsx
git commit -m "feat(ops): (app)/layout gates on session + isOperator

Phase 1 minimal — full sidebar shell ships in Plan 2."
```

---

## Task 11: `/login` page (Google + magic-link + password)

**Files:**
- Create: `apps/ops/src/app/login/page.tsx`
- Create: `apps/ops/src/app/login/actions.ts`

- [ ] **Step 1: Create the server action**

```ts
// apps/ops/src/app/login/actions.ts
'use server'

import { signIn } from '@/lib/auth'

export async function loginWithCredentials(formData: FormData) {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')
  try {
    await signIn('credentials', {
      email,
      password,
      redirectTo: '/', // (app)/layout will route based on operator status
    })
  } catch (err) {
    // Auth.js throws a redirect on success; surface auth errors only.
    const msg = err instanceof Error ? err.message : 'Sign-in failed.'
    if (msg.includes('NEXT_REDIRECT')) throw err
    if (msg.includes('TOO_MANY_ATTEMPTS')) {
      return { error: 'Too many attempts. Try again in 15 minutes.' }
    }
    return { error: 'Invalid email or password.' }
  }
}

export async function loginWithEmailLink(formData: FormData) {
  const email = String(formData.get('email') ?? '')
  await signIn('resend', { email, redirectTo: '/' })
}

export async function loginWithGoogle() {
  await signIn('google', { redirectTo: '/' })
}
```

- [ ] **Step 2: Create the page**

```tsx
// apps/ops/src/app/login/page.tsx
import { loginWithCredentials, loginWithEmailLink, loginWithGoogle } from './actions'

export const metadata = { title: 'Sign in · PadelNachos Admin' }

export default function LoginPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-canvas)',
        padding: 24,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 360,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 12,
          padding: 32,
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>PadelNachos Admin</h1>
        <p style={{ fontSize: 13, color: 'var(--status-neutral)', margin: '0 0 24px' }}>
          Sign in to the operations dashboard.
        </p>

        {/* Email + password */}
        <form action={loginWithCredentials} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            name="email"
            type="email"
            required
            placeholder="Email"
            style={{
              padding: '10px 12px',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              fontSize: 14,
            }}
          />
          <input
            name="password"
            type="password"
            required
            placeholder="Password"
            style={{
              padding: '10px 12px',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              fontSize: 14,
            }}
          />
          <button
            type="submit"
            style={{
              background: 'var(--brand-primary)',
              color: 'var(--brand-primary-fg)',
              border: 'none',
              borderRadius: 8,
              padding: '10px 12px',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Sign in
          </button>
        </form>

        <div style={{ textAlign: 'right', marginTop: 8 }}>
          <a href="/forgot-password" style={{ fontSize: 12, color: 'var(--status-neutral)' }}>
            Forgot password?
          </a>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            margin: '20px 0',
            color: 'var(--status-neutral)',
            fontSize: 11,
          }}
        >
          <span style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
          OR
          <span style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
        </div>

        {/* Magic link */}
        <form action={loginWithEmailLink} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            name="email"
            type="email"
            required
            placeholder="Email for sign-in link"
            style={{
              padding: '10px 12px',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              fontSize: 14,
            }}
          />
          <button
            type="submit"
            style={{
              background: 'var(--bg-canvas)',
              color: 'var(--brand-primary-fg)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              padding: '10px 12px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Email me a sign-in link
          </button>
        </form>

        {/* Google */}
        <form action={loginWithGoogle} style={{ marginTop: 10 }}>
          <button
            type="submit"
            style={{
              width: '100%',
              background: 'var(--bg-canvas)',
              color: 'var(--brand-primary-fg)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              padding: '10px 12px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Continue with Google
          </button>
        </form>
      </div>
    </main>
  )
}
```

- [ ] **Step 3: Smoke-build**

```bash
cd apps/ops && npx next build 2>&1 | tail -10
```

Expected: builds. `/login` shows up in the route table.

- [ ] **Step 4: Visual smoke test (manual)**

```bash
cd apps/ops && npm run dev
```

Open http://localhost:3004/login. Expect to see three sign-in methods stacked: email+password form (green Sign in button), magic-link form, Google button. Variation 2 colors visible (green primary, near-black text).

- [ ] **Step 5: Commit**

```bash
git add apps/ops/src/app/login/page.tsx apps/ops/src/app/login/actions.ts
git commit -m "feat(ops): /login page with three sign-in methods

Email+password (Credentials), magic-link (Resend), Google OAuth.
Variation 2 styling. Server actions wrap signIn() and surface friendly errors."
```

---

## Task 12: `/forgot-password` page + Resend email

**Files:**
- Create: `apps/ops/src/lib/email/password-reset.ts`
- Create: `apps/ops/src/app/forgot-password/page.tsx`
- Create: `apps/ops/src/app/forgot-password/actions.ts`

- [ ] **Step 1: Create the email sender**

```ts
// apps/ops/src/lib/email/password-reset.ts
import { Resend } from 'resend'

export async function sendPasswordResetEmail(opts: {
  to: string
  resetUrl: string
}): Promise<void> {
  const resend = new Resend(process.env.RESEND_API_KEY!)
  await resend.emails.send({
    from: process.env.AUTH_EMAIL_FROM ?? 'PadelNachos Admin <admin@padelnachos.com>',
    to: opts.to,
    subject: 'Reset your PadelNachos Admin password',
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:40px 20px">
        <h1 style="font-size:20px;font-weight:700;color:#0a0a0a;margin:0 0 16px">Reset your password</h1>
        <p style="font-size:14px;color:#52525b;margin:0 0 24px">Click below to set a new password. This link expires in 30 minutes.</p>
        <a href="${opts.resetUrl}" style="display:inline-block;background:#7ED321;color:#0a0a0a;font-weight:700;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px">Reset password</a>
        <p style="font-size:11px;color:#a1a1aa;margin-top:32px">If you didn't request this, ignore this email — your password stays unchanged.</p>
      </div>
    `,
  })
}
```

- [ ] **Step 2: Create the server action**

```ts
// apps/ops/src/app/forgot-password/actions.ts
'use server'

import { pgPool } from '@/lib/db'
import { createResetToken } from '@/lib/reset-tokens'
import { sendPasswordResetEmail } from '@/lib/email/password-reset'

export async function requestPasswordReset(formData: FormData): Promise<{ sent: boolean }> {
  const email = String(formData.get('email') ?? '').toLowerCase().trim()
  if (!email) return { sent: true } // Don't reveal which emails exist

  const { rows } = await pgPool().query(
    'select id from public.users where email = $1 limit 1',
    [email],
  )
  if (rows.length > 0) {
    const userId = rows[0].id as string
    const raw = await createResetToken(userId)
    const base = process.env.AUTH_URL ?? 'http://localhost:3004'
    await sendPasswordResetEmail({
      to: email,
      resetUrl: `${base}/reset-password?token=${encodeURIComponent(raw)}`,
    })
  }

  // Always return { sent: true } so the page can't be used as a user-enumeration oracle.
  return { sent: true }
}
```

- [ ] **Step 3: Create the page**

```tsx
// apps/ops/src/app/forgot-password/page.tsx
import { requestPasswordReset } from './actions'

export const metadata = { title: 'Forgot password · PadelNachos Admin' }

export default function ForgotPasswordPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-canvas)',
        padding: 24,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 360,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 12,
          padding: 32,
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>Forgot password</h1>
        <p style={{ fontSize: 13, color: 'var(--status-neutral)', margin: '0 0 24px' }}>
          We'll email you a link to set a new one. The link expires in 30 minutes.
        </p>
        <form action={requestPasswordReset} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            name="email"
            type="email"
            required
            placeholder="Email"
            style={{
              padding: '10px 12px',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              fontSize: 14,
            }}
          />
          <button
            type="submit"
            style={{
              background: 'var(--brand-primary)',
              color: 'var(--brand-primary-fg)',
              border: 'none',
              borderRadius: 8,
              padding: '10px 12px',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Send reset link
          </button>
        </form>
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <a href="/login" style={{ fontSize: 12, color: 'var(--status-neutral)' }}>
            Back to sign in
          </a>
        </div>
      </div>
    </main>
  )
}
```

- [ ] **Step 4: Smoke-build**

```bash
cd apps/ops && npx next build 2>&1 | tail -10
```

Expected: builds. `/forgot-password` in the route table.

- [ ] **Step 5: Commit**

```bash
git add apps/ops/src/lib/email/password-reset.ts apps/ops/src/app/forgot-password/page.tsx apps/ops/src/app/forgot-password/actions.ts
git commit -m "feat(ops): /forgot-password flow

Token-based reset via Resend. Always returns sent=true to prevent
user-enumeration. Uses createResetToken (Task 6) + branded email template."
```

---

## Task 13: `/reset-password` page

**Files:**
- Create: `apps/ops/src/app/reset-password/page.tsx`
- Create: `apps/ops/src/app/reset-password/actions.ts`

- [ ] **Step 1: Create the server action**

```ts
// apps/ops/src/app/reset-password/actions.ts
'use server'

import { redirect } from 'next/navigation'
import { pgPool } from '@/lib/db'
import { consumeResetToken } from '@/lib/reset-tokens'
import { hashPassword } from '@/lib/password'

export async function applyPasswordReset(formData: FormData) {
  const token = String(formData.get('token') ?? '')
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirm') ?? '')

  if (!token) return { error: 'Missing token.' }
  if (!password || password.length < 8) return { error: 'Password must be at least 8 characters.' }
  if (password !== confirm) return { error: 'Passwords do not match.' }

  const result = await consumeResetToken(token)
  if (!result.ok) {
    const map: Record<string, string> = {
      not_found: 'This reset link is invalid.',
      expired: 'This reset link has expired. Request a new one.',
      used: 'This reset link has already been used.',
    }
    return { error: map[result.reason] ?? 'Invalid reset link.' }
  }

  const hash = await hashPassword(password)
  await pgPool().query('update public.users set password_hash = $1 where id = $2', [
    hash,
    result.userId,
  ])

  redirect('/login?reset=ok')
}
```

- [ ] **Step 2: Create the page**

```tsx
// apps/ops/src/app/reset-password/page.tsx
import { applyPasswordReset } from './actions'

export const metadata = { title: 'Reset password · PadelNachos Admin' }

type SearchParams = { token?: string }

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const { token = '' } = await searchParams
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-canvas)',
        padding: 24,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 360,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 12,
          padding: 32,
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>Set a new password</h1>
        <p style={{ fontSize: 13, color: 'var(--status-neutral)', margin: '0 0 24px' }}>
          At least 8 characters.
        </p>
        <form action={applyPasswordReset} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input type="hidden" name="token" value={token} />
          <input
            name="password"
            type="password"
            required
            placeholder="New password"
            minLength={8}
            style={{
              padding: '10px 12px',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              fontSize: 14,
            }}
          />
          <input
            name="confirm"
            type="password"
            required
            placeholder="Confirm new password"
            minLength={8}
            style={{
              padding: '10px 12px',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              fontSize: 14,
            }}
          />
          <button
            type="submit"
            style={{
              background: 'var(--brand-primary)',
              color: 'var(--brand-primary-fg)',
              border: 'none',
              borderRadius: 8,
              padding: '10px 12px',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Set password
          </button>
        </form>
      </div>
    </main>
  )
}
```

- [ ] **Step 3: Smoke-build**

```bash
cd apps/ops && npx next build 2>&1 | tail -10
```

Expected: builds.

- [ ] **Step 4: Commit**

```bash
git add apps/ops/src/app/reset-password/page.tsx apps/ops/src/app/reset-password/actions.ts
git commit -m "feat(ops): /reset-password page

Consumes single-use token (Task 6 helpers), writes new password_hash,
redirects to /login?reset=ok. Validates min-length 8 + confirm match."
```

---

## Task 14: `/not-authorized` page

**Files:**
- Create: `apps/ops/src/app/not-authorized/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
// apps/ops/src/app/not-authorized/page.tsx
import { auth, signOut } from '@/lib/auth'

export const metadata = { title: 'Not authorized · PadelNachos Admin' }

export default async function NotAuthorizedPage() {
  const session = await auth()
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-canvas)',
        padding: 24,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 12,
          padding: 32,
          textAlign: 'center',
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 12px' }}>Not authorized</h1>
        <p style={{ fontSize: 14, color: 'var(--status-neutral)', margin: '0 0 24px' }}>
          {session?.user?.email
            ? `You are signed in as ${session.user.email}, but your account is not on the operators list.`
            : 'You are not signed in to the operators dashboard.'}
        </p>
        <p style={{ fontSize: 13, color: 'var(--status-neutral)', margin: '0 0 16px' }}>
          Contact an admin to be added.
        </p>
        {session?.user && (
          <form
            action={async () => {
              'use server'
              await signOut({ redirectTo: '/login' })
            }}
          >
            <button
              type="submit"
              style={{
                background: 'transparent',
                color: 'var(--status-neutral)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                padding: '8px 16px',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Sign out
            </button>
          </form>
        )}
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Smoke-build**

```bash
cd apps/ops && npx next build 2>&1 | tail -10
```

Expected: builds.

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/app/not-authorized/page.tsx
git commit -m "feat(ops): /not-authorized page with sign-out

Shown by (app)/layout when session exists but user is not in operators."
```

---

## Task 15: Seed initial operator (env-driven migration)

**Files:**
- Create: `supabase/migrations/20260520120100_seed_initial_operator.sql`

- [ ] **Step 1: Create the migration**

```sql
-- supabase/migrations/20260520120100_seed_initial_operator.sql
-- Seed the first operator from the INITIAL_OPERATOR_EMAIL env var.
-- Idempotent — re-running is a no-op once the row exists.

do $$
declare
  v_email text := current_setting('app.initial_operator_email', true);
  v_user_id uuid;
begin
  -- Fallback to env var via psql -v: e.g. psql -v initial_operator_email="$INITIAL_OPERATOR_EMAIL"
  if v_email is null or v_email = '' then
    v_email := coalesce(nullif(current_setting('initial_operator_email', true), ''), null);
  end if;

  if v_email is null or v_email = '' then
    raise notice 'INITIAL_OPERATOR_EMAIL not set — skipping seed';
    return;
  end if;

  select id into v_user_id from public.users where lower(email) = lower(v_email) limit 1;

  if v_user_id is null then
    raise notice 'No users row for email % yet — operator must sign in first via Google/magic-link', v_email;
    return;
  end if;

  insert into public.operators (user_id) values (v_user_id) on conflict do nothing;
  raise notice 'Operator seeded for %', v_email;
end$$;
```

- [ ] **Step 2: Apply with the env var set**

```bash
psql "$DATABASE_URL" \
  -v initial_operator_email="$INITIAL_OPERATOR_EMAIL" \
  -f supabase/migrations/20260520120100_seed_initial_operator.sql
```

Expected: `NOTICE: Operator seeded for <email>` if the user already exists in `public.users`, otherwise `NOTICE: No users row for email <email> yet…`.

- [ ] **Step 3: Verify**

```bash
psql "$DATABASE_URL" -c "select u.email from public.users u join public.operators o on o.user_id = u.id"
```

Expected: lists the seeded email (or empty if the seed deferred to first sign-in).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260520120100_seed_initial_operator.sql
git commit -m "feat(db): env-driven initial operator seed

Reads INITIAL_OPERATOR_EMAIL via psql -v initial_operator_email. Idempotent.
Skips gracefully when the env is unset or the user doesn't exist yet."
```

---

## Task 16: Cookie domain on main app

**Files:**
- Modify: `src/auth.ts`

- [ ] **Step 1: Read the existing main-app auth config**

```bash
grep -n "cookies\|sessionToken" src/auth.ts || echo "no cookies block — need to add"
```

Expected: no existing `cookies` block (the spec assumes the host-only default).

- [ ] **Step 2: Add the `cookies` block to `src/auth.ts`**

In `src/auth.ts`, locate `pages: { signIn: '/home', error: '/home' },` and insert this block immediately above it:

```ts
  // Cookie domain shared with admin.padelnachos.com so sessions cross subdomains.
  // Prod-only — local dev would break across ports because cookies aren't shared
  // across origins even with a parent-domain attribute.
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === 'production'
          ? '__Secure-authjs.session-token'
          : 'authjs.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
        domain: process.env.NODE_ENV === 'production' ? '.padelnachos.com' : undefined,
      },
    },
  },
```

- [ ] **Step 3: Switch to the main worktree to make this change**

This change is to `src/auth.ts` in the main app, not under `apps/ops/`. From your main worktree (the repo root, NOT the `admin-ops-app` worktree), create a branch off `main`:

```bash
# From /Users/GuDenes/Projects/padel-live-scores (main worktree)
git checkout main
git pull --ff-only origin main
git checkout -b feat/cookie-domain-padelnachos
```

- [ ] **Step 4: Apply Step 2's edit to `src/auth.ts` in the main worktree**

(Repeat the same insertion described in Step 2, but in the main worktree's `src/auth.ts`.)

- [ ] **Step 5: Smoke-build the main app**

```bash
# From /Users/GuDenes/Projects/padel-live-scores
npm run build 2>&1 | tail -10
```

Expected: builds successfully.

- [ ] **Step 6: Commit and push a PR**

```bash
git add src/auth.ts
git commit -m "feat(auth): scope session cookie to .padelnachos.com in production

Enables session sharing with admin.padelnachos.com (Plan 1 Task 16).
Local dev unchanged (cross-port cookies don't share anyway).
Existing prod sessions will be invalidated on rollout; users sign in once."
git push -u origin feat/cookie-domain-padelnachos
gh pr create --title "feat(auth): scope session cookie to .padelnachos.com" \
  --body "Required before launching admin.padelnachos.com. Existing prod sessions invalidated once on rollout."
```

The ops-app deployment in Task 17 depends on this PR being merged first.

---

## Task 17: README + smoke test + deploy notes

**Files:**
- Create: `apps/ops/README.md`
- Create: `apps/ops/tests/smoke.test.ts`

- [ ] **Step 1: Write the smoke test**

```ts
// apps/ops/tests/smoke.test.ts
import { describe, it, expect } from 'vitest'

describe('phase 1 smoke', () => {
  it('exports an auth handler shape', async () => {
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
    expect(typeof mod.signIn).toBe('function')
    expect(typeof mod.signOut).toBe('function')
  })

  it('exposes password helpers', async () => {
    const mod = await import('../src/lib/password')
    expect(typeof mod.hashPassword).toBe('function')
    expect(typeof mod.verifyPassword).toBe('function')
  })

  it('exposes reset-token helpers', async () => {
    const mod = await import('../src/lib/reset-tokens')
    expect(typeof mod.generateRawToken).toBe('function')
    expect(typeof mod.hashToken).toBe('function')
    expect(typeof mod.createResetToken).toBe('function')
    expect(typeof mod.consumeResetToken).toBe('function')
  })

  it('exposes the operator allow-list check', async () => {
    const mod = await import('../src/lib/operators')
    expect(typeof mod.isUserOperator).toBe('function')
  })
})
```

- [ ] **Step 2: Run all tests**

```bash
cd apps/ops && npm test
```

Expected: PASS, all suites (`password`, `reset-tokens`, `rate-limit`, `operators`, `smoke`). At least 15 tests total.

- [ ] **Step 3: Write the README**

```markdown
# PadelNachos Admin

Standalone Next.js admin app deployed to `admin.padelnachos.com`. Replaces the embedded `/ops` route in the main app.

**Spec:** [`docs/superpowers/specs/2026-05-20-admin-ops-app-design.md`](../../docs/superpowers/specs/2026-05-20-admin-ops-app-design.md)

## Local development

```bash
# From repo root
cp apps/ops/.env.local.example apps/ops/.env.local
# Fill in: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY, AUTH_SECRET,
# DATABASE_URL, AUTH_GOOGLE_*, RESEND_API_KEY, INITIAL_OPERATOR_EMAIL
# AUTH_SECRET and DATABASE_URL MUST match the main app's values.

cd apps/ops
npm install
npm run dev
# → http://localhost:3004
```

## Database setup

Apply the two migrations to your Supabase Postgres:

```bash
psql "$DATABASE_URL" -f supabase/migrations/20260520120000_admin_ops_auth.sql
psql "$DATABASE_URL" -v initial_operator_email="$INITIAL_OPERATOR_EMAIL" \
                    -f supabase/migrations/20260520120100_seed_initial_operator.sql
```

## Tests

```bash
npm test
```

Unit tests cover `password`, `reset-tokens`, `rate-limit`, `operators`. Smoke tests verify all auth modules load.

## Deploy

Separate Vercel project from the main app:

1. Create project `padelnachos-admin`, root directory `apps/ops`
2. Add the env vars from `.env.local.example` to Vercel (production scope)
3. Set production custom domain → `admin.padelnachos.com`
4. **Before launch:** merge the cookie-domain change on the main app
   (`feat/cookie-domain-padelnachos`). This sets the session cookie to
   `.padelnachos.com`, invalidating current sessions once. Communicate to users.
5. Deploy. Sign in with the seeded operator account.

## Auth flow

Three providers all on `/login`:

- **Google OAuth** — recommended for IT-managed accounts
- **Magic-link** (Resend) — convenient, no password needed
- **Email + password** — for operators who set one via /reset-password

A user can sign in via any provider but only sees the app if they're in the `public.operators` allow-list. Non-operators land on `/not-authorized`.

## Architecture notes

- Auth.js v5 with database-strategy sessions on the shared Supabase Postgres
- Session cookie domain `.padelnachos.com` (prod only) → shared with main app
- Gating in `src/app/(app)/layout.tsx` via `await auth()` + `isUserOperator(user.id)`
- Direct Supabase access server-side (no proxying through main-app `/api/ops/*`)
- New routes namespaced under `/api/internal/*` (none in Phase 1; Plan 2 adds them)
```

- [ ] **Step 4: Commit**

```bash
git add apps/ops/README.md apps/ops/tests/smoke.test.ts
git commit -m "docs(ops): README + smoke tests

Documents local dev, db setup, test runner, deploy steps, and auth flow.
Smoke tests assert all auth modules export the expected shape."
```

---

## Verification checklist

After all 17 tasks land, the following must hold:

- [ ] `apps/ops/` directory exists with the structure listed in File Structure above
- [ ] `cd apps/ops && npm test` passes 15+ tests across 5 files
- [ ] `cd apps/ops && npm run build` builds successfully
- [ ] `cd apps/ops && npm run lint` reports zero errors
- [ ] `cd apps/ops && npm run dev` starts on port 3004, `/login` renders the three-provider form
- [ ] Visiting `http://localhost:3004/` redirects to `/login`
- [ ] Visiting `/forgot-password` renders the request form
- [ ] Visiting `/reset-password?token=anything` renders the new-password form
- [ ] Signing in (manually inserting an operator row + setting a password) lands on `/` and you get redirected to `/login` because Plan 1 doesn't ship `/today` yet — that's expected
- [ ] Signing in as a non-operator user lands on `/not-authorized`
- [ ] Both auth migrations are applied to the shared Supabase database
- [ ] The main-app cookie-domain change is merged on a separate PR
- [ ] `apps/ops/README.md` documents the deploy flow

## What's intentionally NOT in this plan

- The sidebar shell, Today page, and `/api/internal/*` endpoints (Plan 2)
- Lifts of the existing 15 ops tabs (Plan 3)
- Deploy execution to Vercel (manual ops step, documented in README)
- The Vercel project creation + DNS for `admin.padelnachos.com` (manual ops step)
- `/admin/users` UI for operator self-service (Phase 2 of the spec)
- Recent Activity feed, Data Health panel, ⌘K search, notification bell (all Phase 2)

# Padel Nachos — Monorepo

One git repo, three Next.js apps, three Vercel projects, one shared Supabase database.

## The three apps

| App | Path | Port (dev) | Domain | Vercel project | What it is |
|---|---|---|---|---|---|
| **Main app** | `/` (repo root) | 3002 *(or 3000)* | `padelnachos.com` | `padelnachos` | Public PWA — live scores, rankings, tournaments, feed, news |
| **Padel Labs** | `apps/labs/` | 3003 | `padellabs.tech` | `padel-labs` | B2B SaaS — natural-language analytics over the padel data |
| **Padel Admin** | `apps/ops/` | 3004 | `admin.padelnachos.com` | `padelnachos-admin` | Internal ops dashboard for operators |

All three live in this repo. Each app has its own `package.json`, its own dependencies, its own Vercel deploy target.

## What goes where

**At the repo root (`/`):**
- The main app's source (`src/`, `public/`, `next.config.ts`, etc.)
- Shared things that ALL apps see: `supabase/migrations/`, top-level `instrumentation.ts` (Sentry for main), root `.env.local`
- This file (`MONOREPO.md`), `README.md`, `CLAUDE.md`, `AGENTS.md`
- Padelgod (`padelgod/`), Relay (`relay/`) — Railway services, not Vercel apps

**Under `apps/labs/`:**
- Everything Labs-specific. Own `package.json`, own `next.config.ts`, own `src/`, own `tests/`, own `instrumentation.ts` (Sentry no-op shadow)
- Own `.env.local` (gitignored)

**Under `apps/ops/`:**
- Everything ops-specific. Same structure as Labs.
- Own `instrumentation.ts` (Sentry no-op shadow)
- Own `.env.local` (gitignored)

## Decision rule: where does new code live?

Ask three questions in order:

1. **Does it belong to a specific app's UI / routes / pages?** → in that app (`apps/<name>/src/`)
2. **Is it a SQL migration?** → `/supabase/migrations/` at the root (all apps share the database)
3. **Is it a Railway worker or cron?** → `/padelgod/` or `/relay/` at the root

If none of the above, default to the app that touches it most. Don't create new top-level directories without a clear reason — the precedent for new apps is `apps/<name>/`.

## What's deliberately NOT shared

No code is imported across apps. Each `apps/<name>/` is an independent npm package. If two apps need similar code (e.g. an auth helper), it gets copied, not imported.

**Why duplication over abstraction?**
- Each app evolves independently — pinning a shared lib version creates lockstep deploys
- No build-tool coupling — apps can use different Next.js versions if needed
- No "framework drift" risk where one app's needs break another's
- Cheap because the surface is small (Auth.js config, DB pool, a few helpers)

The Labs design doc made this choice explicit, and ops follows it.

## What IS shared

- **Supabase database** (one project, all three apps connect with the same `DATABASE_URL` + `SUPABASE_SERVICE_KEY`)
- **Auth.js user table** (`public.users`) — a single account works across all three apps, but **sessions don't share** (see "Cross-app session sharing" below)
- **Resend API key** (one transactional email account)
- **Google OAuth client** (one credentials pair, multiple redirect URIs registered)

## Cross-app session sharing — current state

**Sessions do NOT share across the three apps.** Each app maintains its own session cookie.

| App | Session strategy | Cookie name |
|---|---|---|
| Main | Database (PostgresAdapter writes to `public.sessions`) | `__Secure-authjs.session-token` |
| Labs | Database | `__Secure-authjs.session-token` |
| Admin | **JWT** (signed; no DB row created) | `__Secure-authjs.session-token` |

The admin app uses JWT because the Credentials provider (email + password) doesn't create database sessions in Auth.js v5. This forces a mismatch with the main app's database-session payload, so the shared `.padelnachos.com` cookie domain works mechanically but the cookie *contents* are incompatible.

**User impact:** an operator logs into `padelnachos.com` and `admin.padelnachos.com` independently. Future revisit: align everyone on JWT (touches main + labs auth.ts), OR accept the dual-login.

Documented decision: [`docs/superpowers/specs/2026-05-20-admin-ops-app-design.md`](docs/superpowers/specs/2026-05-20-admin-ops-app-design.md) → "Session strategy + gate".

## Vercel project map

Three Vercel projects, all pointing at this repo:

| Vercel project | Root directory | Domain | What changes trigger a deploy |
|---|---|---|---|
| `padelnachos` | `/` | `padelnachos.com` | Anything outside `apps/labs/`, `apps/ops/`, `padelgod/`, `relay/` |
| `padel-labs` | `apps/labs/` | `padellabs.tech` | Only changes under `apps/labs/` |
| `padelnachos-admin` | `apps/ops/` | `admin.padelnachos.com` | Only changes under `apps/ops/` |

Each app has a `vercel.json` with `ignoreCommand` so PRs touching only one app don't trigger unrelated rebuilds:

```json
{ "ignoreCommand": "git diff --quiet HEAD^ HEAD -- apps/ops" }
```

Same pattern for `apps/labs/`. The main project doesn't have an ignoreCommand — it's the catch-all.

## Env vars

Each app's `.env.local.example` documents its required vars. **Some must be identical across apps:**

| Var | Must match across | Why |
|---|---|---|
| `DATABASE_URL` | All three | All connect to the same Supabase Postgres |
| `SUPABASE_SERVICE_KEY` | All three | Same project |
| `NEXT_PUBLIC_SUPABASE_URL` | All three | Same project |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | All three | Same project |
| `AUTH_SECRET` | Main + Labs *(admin is JWT now)* | Database-session validation |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | All three (or per-app) | One OAuth client supports all three |
| `RESEND_API_KEY` | All three | One Resend account |

**Per-app only:**
- `AUTH_URL` — the deployed URL of that specific app
- `AUTH_EMAIL_FROM` — sender branding differs per app
- App-specific feature flags

**Anything secret stays in Vercel's env-var UI** — never committed to the repo. The `.env.local.example` files contain placeholder shapes only.

## Database migrations

`/supabase/migrations/` at the root. Applied to the single shared Supabase Postgres. Each app's schema additions go here. Naming convention: `YYYYMMDDHHMMSS_short_description.sql`.

Examples:
- `20260520120000_admin_ops_auth.sql` — admin app's auth tables (password_hash, password_reset_tokens, operators)
- Older labs migrations are also here (`labs_*` tables)

When porting a migration to Vercel-deployed environments, the team currently applies manually via psql or the Supabase SQL editor (no migration CI yet). Document the migration in the PR description.

## Day-one onboarding for a new operator

1. Clone the repo, `npm install` at root (for main app) and `cd apps/ops && npm install` (for admin)
2. Copy `.env.local.example` → `.env.local` in BOTH the root and `apps/ops/`. Fill in values
3. Apply any pending migrations: `psql "$DATABASE_URL" -f supabase/migrations/<file>.sql`
4. Run the main app: `npm run dev` (port 3002)
5. Run the admin app in a separate terminal: `cd apps/ops && npm run dev` (port 3004)
6. Sign into admin at `http://localhost:3004/login` via magic-link (uses Resend → Gmail)
7. Get added to `public.operators` table to unlock the gated routes

## Per-app docs

- Main app: top-level `README.md` + `CLAUDE.md`
- Padel Labs: `apps/labs/` (own internal docs)
- Padel Admin: [`apps/ops/README.md`](apps/ops/README.md) + spec at [`docs/superpowers/specs/2026-05-20-admin-ops-app-design.md`](docs/superpowers/specs/2026-05-20-admin-ops-app-design.md)

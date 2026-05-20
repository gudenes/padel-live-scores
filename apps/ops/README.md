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

- Auth.js v5 with JWT-strategy sessions (the original spec proposed database
  sessions but the Credentials provider doesn't create them in v5 — see Plan 1
  errata for the full reasoning)
- PostgresAdapter still mounted for `users`, `accounts`, `verification_token`
  persistence; the `sessions` table goes unused under JWT
- Cookie domain `.padelnachos.com` in prod (parent-domain scoping — harmless
  under JWT; cross-subdomain session sharing was deferred indefinitely)
- Auth + operator gate in `src/app/(app)/layout.tsx` via `await auth()` and
  `session.user.isOperator` (enriched by the session callback)
- Direct Supabase access server-side; admin routes namespaced under
  `/api/internal/*` to avoid colliding with the main app's `/api/admin/*`

## Routes

| Path | Description |
|---|---|
| `/` | Root — redirects to `/today` (signed in) or `/login` (anonymous) |
| `/login` | Three providers: email+password, magic-link, Google |
| `/forgot-password` | Anti-enumeration reset request |
| `/reset-password?token=…` | Token consumer + new password form |
| `/not-authorized` | Shown when a session exists but isOperator is false |
| `/today` | Daily-driver dashboard (KPIs, LIVE NOW, REQUIRES ATTENTION, schedule) |
| `/tournament-explorer`, `/entry-lists`, `/needs-review`, `/simulator` | Tournament Ops tabs (stubs until Plan 3) |
| `/players`, `/brands`, `/streams` | Catalog tabs (stubs until Plan 3) |
| `/news`, `/highlights` | Content tabs (stubs until Plan 3) |
| `/system/*` | Diagnostics tabs (stubs until Plan 3) |
| `/api/internal/today` | GET → full Today payload |
| `/api/internal/needs-review/counts` | GET → `{ duplicates: number }` |
| `/api/auth/[...nextauth]` | Auth.js handler |

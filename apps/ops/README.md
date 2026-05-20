# PadelNachos Admin

Standalone Next.js admin app deployed to `admin.padelnachos.com`. Replaces the embedded `/ops` route in the main app.

**Spec:** [`docs/superpowers/specs/2026-05-20-admin-ops-app-design.md`](../../docs/superpowers/specs/2026-05-20-admin-ops-app-design.md)

**Phase 1 status:** Plan 1 (foundation) + Plan 2 (sidebar + Today) + Plan 3a (Players + Tournament Explorer) shipped. Plan 3b (remaining 12 tabs) is the next milestone.

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

## Deploy to `admin.padelnachos.com`

A separate Vercel project, in the same Vercel team as `padelnachos.com`. No additional Vercel cost (projects are free; only usage matters — see [`MONOREPO.md`](../../MONOREPO.md)).

### 1. Push the branch + open a PR

```bash
# From the admin-ops-app worktree
git push -u origin worktree-admin-ops-app
gh pr create --title "Admin ops app — Phase 1 (foundation + sidebar + Today)" --body "$(cat <<'EOF'
Adds apps/ops/ — standalone Next.js admin app at admin.padelnachos.com.

Phase 1 delivers:
- Auth: Google OAuth + magic-link + email/password (Auth.js v5, JWT sessions)
- Operator allow-list gate via public.operators table
- Sidebar IA: 5 nav groups, 14 destinations
- Today dashboard: KPIs, LIVE NOW, REQUIRES ATTENTION, schedule, status pill
- Two internal endpoints: /api/internal/today, /api/internal/needs-review/counts

Plan 3 (tab lifts) is the next chunk — 14 stub pages stand in for now.

DB migrations applied to prod Supabase: 20260520120000_admin_ops_auth.sql + 20260520120100_seed_initial_operator.sql.
EOF
)"
```

### 2. Create the Vercel project

In the Vercel dashboard:

1. **Add New… → Project** → pick the `padel-live-scores` repo
2. **Project Name:** `padelnachos-admin`
3. **Root Directory:** click "Edit" → set to `apps/ops` (NOT the repo root)
4. **Framework Preset:** Next.js (auto-detected)
5. **Build & Output settings:** leave defaults — Vercel will use `npm run build` from `apps/ops/`
6. **Don't deploy yet** — env vars first.

### 3. Add env vars (Production + Preview scope)

Paste these in Vercel → Project → Settings → Environment Variables. Values come from your local `.env.local` (which I populated earlier).

| Var | Value source | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | from main app | identical |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from main app | identical |
| `SUPABASE_SERVICE_KEY` | from main app | identical |
| `DATABASE_URL` | from main app | identical |
| `AUTH_SECRET` | from main app | identical |
| `AUTH_URL` | `https://admin.padelnachos.com` | **NEW — admin-specific** |
| `AUTH_GOOGLE_ID` | from main app | shared client (add redirect URI in step 5) |
| `AUTH_GOOGLE_SECRET` | from main app | identical |
| `RESEND_API_KEY` | from main app | identical |
| `AUTH_EMAIL_FROM` | `PadelNachos Admin <admin@padelnachos.com>` | admin-specific |
| `INITIAL_OPERATOR_EMAIL` | your email | one-off; you can remove after seed |

Tip: Vercel's UI has a "copy from another project" button that handles the duplicates in one shot.

### 4. Trigger first deploy + add the custom domain

1. **Deployments → click "Redeploy"** on the latest commit (or push a no-op commit). First deploy will land on the Vercel-generated URL like `padelnachos-admin-xxx.vercel.app`.
2. Open that URL → confirm `/login` renders.
3. **Settings → Domains → Add** `admin.padelnachos.com`. Vercel shows the DNS record you need to add.

### 5. Configure DNS

Wherever you manage `padelnachos.com` DNS (likely Cloudflare, Namecheap, or your registrar):

- **Type:** CNAME
- **Name:** `admin`
- **Target:** `cname.vercel-dns.com` (or whatever Vercel showed you in step 4)
- **TTL:** Auto / 300

Propagation usually takes 1–5 minutes. Once Vercel detects the DNS, the SSL cert auto-provisions.

### 6. Add the production redirect URI to Google OAuth

The Google OAuth client only allows the redirect URIs you've registered. Add the production callback for the admin app:

1. Open [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)
2. Click the OAuth 2.0 Client ID used by `AUTH_GOOGLE_ID`
3. Under **Authorized redirect URIs**, add:
   - `https://admin.padelnachos.com/api/auth/callback/google`
4. (Optional, for previews) also add `https://padelnachos-admin-*.vercel.app/api/auth/callback/google` — Vercel preview URLs follow this pattern; Google supports wildcards on subdomains.
5. Save.

### 7. Smoke-test the deploy

1. Open `https://admin.padelnachos.com/login`
2. Sign in via magic-link (simplest path — works without any per-domain Google config)
3. You should land on `/today` (you're already in the `operators` table from local testing)
4. Visit a few sidebar items — confirm stubs render
5. Open `https://admin.padelnachos.com/api/internal/today` — should return JSON

### What you do NOT need

- ❌ The Task 16 cookie-domain change on the main app — abandoned indefinitely (the JWT switch made it unnecessary; see Plan 1 errata)
- ❌ Touching the main app's Vercel project at all
- ❌ A new Supabase project — admin shares the existing one
- ❌ DB migrations on Vercel — they're already applied to prod Supabase via the SQL we ran during testing

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
| `/players` | Player catalog (search, edit, merge, dedup) |
| `/tournament-explorer` | Per-tournament management (matches, draws, schedule review, entry lists) |
| `/entry-lists`, `/needs-review`, `/simulator` | Tournament Ops tabs (stubs until Plan 3b) |
| `/brands`, `/streams` | Catalog tabs (stubs until Plan 3b) |
| `/news`, `/highlights` | Content tabs (stubs until Plan 3) |
| `/system/*` | Diagnostics tabs (stubs until Plan 3) |
| `/api/internal/today` | GET → full Today payload |
| `/api/internal/needs-review/counts` | GET → `{ duplicates: number }` |
| `/api/internal/players` | GET list / PATCH edit |
| `/api/internal/players/merge` | POST merge two players |
| `/api/internal/search-players` | GET search by name + filters |
| `/api/internal/duplicate-scan` | GET cluster detection (AI-assisted) |
| `/api/internal/tournament-explorer` | GET tournament list |
| `/api/internal/refresh-tournament` | POST trigger padelgod re-sync |
| `/api/internal/tournament-prize` | PATCH prize money |
| `/api/internal/schedule-review` | GET pending / PATCH apply OOP changes |
| `/api/internal/tournament-draw` | GET tournament draw |
| `/api/internal/tournament-matches` | GET tournament matches |
| `/api/auth/[...nextauth]` | Auth.js handler |

# Admin Ops App — Design

**Date:** 2026-05-16
**Author:** brainstorming session
**Status:** design approved, awaiting implementation plan

## Summary

Build a standalone Next.js app at `apps/ops/`, deployed to `admin.padelnachos.com`, that replaces the embedded `/ops` route in the main public app. Reorganizes the current 15 ops tabs around three operator-centric lenses (triage / lifecycle / catalogs) instead of the current system-centric grouping (`Padelgod`, `Data Management`). Adds proper per-user authentication including email + password, behind an operator allow-list.

## Goals

- A daily-driver dashboard an operator can open at 9 AM and immediately understand the state of the platform
- Per-user authentication replacing the current shared `ops_token` cookie
- An information architecture organized by *what the operator is doing*, not by which backend stores the data
- A foundation for a unified "Needs Review" inbox that absorbs future exception queues without sidebar bloat
- Operational isolation from the public app: separate deploy, separate trust boundary, no admin JS bundled into the public bundle

## Non-goals (v1)

- Retrofitting email+password onto the main public app (`padelnachos.com` keeps Google + magic-link only)
- A shared workspace package between `apps/labs/`, `apps/ops/`, and the root app (intentional — matches the Labs precedent of duplication over abstraction)
- i18n on the admin app (operators read English)
- Per-operator audit logging
- Cutover from the existing `/ops` route — both run in parallel during v1

## Architecture

### Standalone app, parallel to Labs

```
padel-live-scores/
├── src/                   # main public app (unchanged)
├── apps/
│   ├── labs/              # existing standalone B2B app
│   └── ops/               # NEW — admin.padelnachos.com
└── supabase/migrations/   # shared
```

`apps/ops/` is an independent npm package: own `package.json`, own `next.config.ts`, own deploy. Next.js 16.2, React 19, Tailwind 4 — matching the main app and Labs.

**Reuse strategy:** components are copied from `src/app/ops/` into `apps/ops/src/`, not imported across packages. Modernize as you copy. Existing `/api/ops/*` and `/api/admin/*` routes in the main app stay where they are; `apps/ops/` calls them server-side or directly hits Supabase.

### Subdomain + cookie domain

- Deploy: separate Vercel project named `padelnachos-admin`, custom domain `admin.padelnachos.com`
- Auth.js session cookie scoped to `.padelnachos.com` (parent domain) — logging into either app keeps you logged in on both. Same config added to both apps' `auth.ts`.

### Shared data layer

Same Supabase project. Same `users` / `accounts` / `sessions` tables (Auth.js v5 PostgresAdapter). Same RLS posture (the admin app uses the service key server-side; nothing changes about how data is read or written).

## Information architecture

The current sidebar groups tabs by *backend system* (`Padelgod`, `Data Management`). The new sidebar groups them by *what the operator is trying to do*, modeled on the patterns we found at Sofascore Editor (lifecycle: create → lineup → results) and Sportradar (triage-first dashboards that surface only what needs attention).

### New sidebar

```
HOME
  · Today                        (new)

TOURNAMENT OPS
  · Tournament Explorer
  · Entry Lists
  · Needs Review
  · Simulator

CATALOGS
  · Players
  · Brands & Equipment
  · Streams

CONTENT
  · News
  · Highlights

SYSTEM   (collapsed by default)
  · Integration Health
  · Data Quality
  · Padelgod Health
  · Shadow Mode
  · Architecture
```

### Mapping from current tabs

| Current tab | New location | Type |
|---|---|---|
| Ongoing Events | HOME → Today | refactor — becomes one panel of a richer overview |
| Integration Health | SYSTEM → Integration Health | extract from `OpsClient.tsx` inline (~L748) |
| Data Quality | SYSTEM → Data Quality | extract from `OpsClient.tsx` inline (~L888) |
| Simulator | TOURNAMENT OPS → Simulator | lift `SimulatorTab.tsx` |
| Tournament Explorer | TOURNAMENT OPS → Tournament Explorer | lift `TournamentExplorerTab.tsx` (Phase 2 refactor) |
| Tournament Dedup | TOURNAMENT OPS → Needs Review | rename; broadens in Phase 2 |
| Padelgod Health | SYSTEM → Padelgod Health | lift `PadelgodHealthTab.tsx` |
| Shadow Mode | SYSTEM → Shadow Mode | lift `PadelgodShadowTab.tsx` |
| Entry Lists | TOURNAMENT OPS → Entry Lists | lift `PadelgodEntryListTab.tsx` |
| Players | CATALOGS → Players | lift `PlayersTab.tsx` + `players/*` subdirectory |
| Brands & Equipment | CATALOGS → Brands & Equipment | lift `BrandsTab.tsx` |
| FIP Streams | CATALOGS → Streams | lift `FipStreamsTab.tsx`, drop "FIP" from UI |
| News | CONTENT → News | lift `NewsTab.tsx` |
| Highlight Picker | CONTENT → Highlights | lift `HighlightPickerTab.tsx`, rename |
| Architecture | SYSTEM → Architecture | lift `ArchitectureTab.tsx` |

### The "Today" page (new)

The daily-driver homepage. Composed of seven regions:

1. **KPI strip (4 tiles)** — Live Matches · Needs Review · OOP Pending · Streams Live. Each shows a delta from yesterday and a 7-day sparkline.
2. **LIVE NOW** — table of currently-live matches with court, score, last-update age. Links into match detail.
3. **REQUIRES ATTENTION** — top items from Needs Review by queue type. Click-through goes to filtered inbox.
4. **TODAY'S SCHEDULE** — upcoming matches by hour bucket. Aggregates across all live tournaments.
5. **RECENT ACTIVITY** *(Phase 2)* — feed of operator actions and system events
6. **DATA HEALTH** *(Phase 2)* — compact bars for Overall Score / Matches / Players / Streams / News & Highlights coverage
7. **All Systems Operational** footer pill — green/yellow/red roll-up of the SYSTEM group's health

**Data source:** new endpoint `POST /api/admin/today` returning all regions in one payload. Internally it fans out to existing dashboard data (`/api/ops/dashboard`), launch-monitor data, and a new Needs Review aggregator.

### Needs Review inbox

**Phase 1:** `TournamentDedupTab` renamed to `Needs Review`. Same UI, same behavior. Sidebar badge shows the dedup queue count.

**Phase 2:** Becomes a typed inbox.

- Filter chips: All · Duplicate Matches · Unresolved Players · OOP Changes · Stream Mapping
- Each row has a `type`, a summary, a timestamp, and a "Review" action
- Clicking Review opens a typed drawer specific to the queue (the existing UIs become drawer content)
- New endpoint `GET /api/admin/needs-review?type=...` aggregates across queues with consistent shape

This abstraction matters because every new exception queue (match stats unresolved, future stat enrichment failures, etc.) lands as a new chip rather than a new sidebar entry.

## Authentication

### Providers

Auth.js v5 with three providers offered on `/login`:

1. **Email + password (new)** — Credentials provider
2. **Google OAuth** — same as main app, allows IT-managed Workspace accounts
3. **Email magic-link** — same as main app, Resend transport

### Password storage

```sql
alter table users add column password_hash text;
-- nullable: OAuth-only users have NULL
```

Hashing: `bcryptjs` cost 12. Pure JS, no native bindings — safe on Vercel.

### Password reset

```sql
create table password_reset_tokens (
  token_hash text primary key,        -- SHA-256 of token sent in email
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,    -- 30 min after creation
  used_at timestamptz
);
create index on password_reset_tokens (user_id);
create index on password_reset_tokens (expires_at);
```

Flow: `/forgot-password` → enter email → token hash stored, raw token emailed via Resend → `/reset-password?token=...` → user picks new password → `used_at` stamped, hash updated.

### Rate limiting

Failed login attempts: 5 per IP per 15 min. In-memory ring buffer keyed on IP. Acceptable for ops scale (small fixed user set); revisit with Redis if abuse becomes real.

### Session cookie sharing

```ts
// In both apps/ops/src/auth.ts AND src/auth.ts
cookies: {
  sessionToken: {
    options: {
      domain: process.env.NODE_ENV === 'production' ? '.padelnachos.com' : undefined,
      sameSite: 'lax',
      path: '/',
      secure: true,
    },
  },
}
```

Logging into either app sets the cookie on `.padelnachos.com`, valid for both.

## Role gating

### Operator allow-list

```sql
create table operators (
  user_id uuid primary key references users(id) on delete cascade,
  created_at timestamptz default now(),
  added_by uuid references users(id)
);
```

A separate table (not a `users.role` column) because:
- Operators are a sparse subset of all users
- Easy to grep: `select email from operators o join users u on u.id = o.user_id`
- No risk of `role='admin'` leaking via accidental client-side reads of the users table

### Middleware

`apps/ops/src/middleware.ts`:

1. If path is in `PUBLIC_PATHS` (`/login`, `/forgot-password`, `/reset-password`, `/api/auth/*`, `/_next/*`) → pass
2. Get Auth.js session
3. If no session → redirect to `/login?from=${path}`
4. Query `operators` table for `session.user.id` (cached in JWT claim after first lookup to avoid DB round-trip per request)
5. If not in `operators` → render `/not-authorized` page with sign-out link
6. Otherwise → pass

The operator check is added to the session JWT via the `jwt` callback so it survives across requests without per-request DB lookups.

### First-operator seeding

SQL migration `2026XXXX_seed_initial_operator.sql` inserts the founder's user ID (or email-lookup) into `operators`. Subsequent operators added by direct DB insert until the Phase 2 `/admin/users` page exists.

## Routing surface

```
apps/ops/src/app/
├── (auth)/
│   ├── login/page.tsx
│   ├── forgot-password/page.tsx
│   └── reset-password/page.tsx
├── (app)/
│   ├── layout.tsx              # sidebar + middleware-gated
│   ├── today/page.tsx
│   ├── tournament-explorer/
│   ├── entry-lists/
│   ├── needs-review/
│   ├── simulator/
│   ├── players/
│   ├── brands/
│   ├── streams/
│   ├── news/
│   ├── highlights/
│   └── system/
│       ├── integration-health/
│       ├── data-quality/
│       ├── padelgod-health/
│       ├── shadow-mode/
│       └── architecture/
├── api/
│   ├── auth/[...nextauth]/     # Auth.js handler
│   ├── admin/
│   │   ├── today/route.ts      # new — Today page aggregator
│   │   └── needs-review/...    # Phase 2
├── auth.ts                     # Auth.js v5 config
└── middleware.ts
```

URL examples: `admin.padelnachos.com/today`, `admin.padelnachos.com/needs-review`, `admin.padelnachos.com/system/architecture`.

## Phasing

### Phase 1 — the new app stands up

1. Scaffold `apps/ops/` matching `apps/labs/` setup
2. Auth: providers + operator allow-list + middleware
3. Login / forgot-password / reset-password pages
4. Sidebar with full IA
5. Today page: KPI strip + LIVE NOW + TODAY'S SCHEDULE + system status footer (no Recent Activity, no Data Health panel yet)
6. All existing tabs lifted into their new locations — functionally identical to current `/ops`
7. Tournament Explorer kept as a single tab (no list/detail refactor)
8. Needs Review is the renamed dedup tab, single queue
9. Deploy to `admin.padelnachos.com`
10. Old `/ops` in the main app stays alive

Done when: an operator can log in via email+password, navigate the new sidebar, and every workflow they did in `/ops` works identically in the new app.

### Phase 2 — deliver the mockup vision

- Tournament Explorer list→detail refactor with `/tournament-explorer/[id]` detail page
- Unified Needs Review inbox with typed drawers for Duplicate Matches / Unresolved Players / OOP Changes / Stream Mapping
- Recent Activity feed (new `ops_activity` table or derived from cron health + signed operator actions)
- DATA HEALTH compact panel on Today
- Global ⌘K search across tournaments / players / matches
- Notification bell with operator-targeted system alerts
- `/admin/users` UI for adding operators without SQL
- Cutover: redirect `/ops/*` from main app → `admin.padelnachos.com`

## Migration & rollout

1. **During Phase 1 build:** both apps run in parallel. Operators continue using `/ops` via the cookie token.
2. **Phase 1 ship:** seed the operator allow-list with all current ops users. Email them with their `admin.padelnachos.com` credentials (or magic-link them in once). Both apps coexist.
3. **End of Phase 2:** verify zero traffic on `/ops` for a week, then add a redirect from `padelnachos.com/ops/*` → `admin.padelnachos.com/$1`, and delete the embedded ops code from the main app.

## Schema changes

```sql
-- 2026XXXX_admin_ops_app_auth.sql
alter table users add column password_hash text;

create table password_reset_tokens (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz
);
create index on password_reset_tokens (user_id);
create index on password_reset_tokens (expires_at);

create table operators (
  user_id uuid primary key references users(id) on delete cascade,
  created_at timestamptz default now(),
  added_by uuid references users(id)
);

-- 2026XXXX_seed_initial_operator.sql (separate migration, kept out of public history)
insert into operators (user_id)
select id from users where email = '<founder email>'
on conflict do nothing;
```

## Open questions deferred to Phase 2

- **Recent Activity source:** new `ops_activity` audit table vs. derive from `ops_events` + signed operator actions. Decision deferred until Phase 2 brainstorm.
- **Notification bell payload model:** what triggers a notification (new review item? system alert? cron failure?). Defer.
- **DATA HEALTH metrics:** the four bars (Overall / Matches / Players / Streams / News & Highlights) need clear formulas. Defer.
- **Operator self-service:** `/admin/users` page UI — adding, removing, listing operators. Defer.

## Risks

- **Cookie domain change** on the main app needs careful rollout. Setting `domain=.padelnachos.com` on a cookie that was previously host-only invalidates existing sessions for users on `www.padelnachos.com`. Mitigate by shipping the cookie-domain change on the main app *before* the ops app launches, and accepting that users will need to sign in once.
- **Bcrypt cost on Vercel cold start:** cost 12 takes ~250ms in Node. Acceptable for login (rare) but adds latency. If Vercel cold-start times feel bad, drop to cost 10 (~60ms).
- **Operator allow-list staleness:** if the cached JWT claim says someone is an operator but you've since removed them from the table, they retain access until session expires. Mitigation: in Phase 2 also check the DB on session refresh (15 min) instead of trusting the JWT for the full 30-day session.

# Admin Ops App — Design

**Date:** 2026-05-20
**Author:** brainstorming session
**Status:** design approved (post-review pass), awaiting implementation plan

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

**Reuse strategy:**

- **Components** are copied from `src/app/ops/` into `apps/ops/src/`, not imported across packages. Modernize as you copy.
- **Data access** is direct to Supabase server-side, using the service key. The admin app does **not** call the main app's `/api/ops/*` or `/api/admin/*` routes — those are gated by the legacy `ops_token` cookie and cross-origin calls would require either CORS or duplicating that cookie. Cleaner to let the admin app own its data path.
- **Server routes** specific to the admin app (e.g., the Today aggregator) live under `apps/ops/src/app/api/internal/*`. We deliberately avoid the `/api/admin/*` namespace because the main app already owns it.
- **Existing `/api/ops/*` and `/api/admin/*` routes** in the main app stay where they are during Phase 1. They're deprecated alongside the `/ops` page at Phase 2 cutover.

### Subdomain + cookie domain

- Deploy: separate Vercel project named `padelnachos-admin`, custom domain `admin.padelnachos.com`
- Auth.js session cookie scoped to `.padelnachos.com` (parent domain) so signing into one keeps you signed in on the other. Same config added to both apps' `auth.ts`.
- **Scope:** main app (`padelnachos.com`) ↔ admin app (`admin.padelnachos.com`). Labs (`padellabs.tech`) is a different registrable domain and is unaffected.

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

**Data source:** new endpoint `GET /api/internal/today` (under the admin app, no auth other than the standard operator middleware) returning all regions in one payload. Internally it queries Supabase directly — reusing the SQL/logic from the main app's `/api/ops/launch-monitor` and `/api/ops/dashboard` routes by copying it into `apps/ops/src/lib/today-aggregator.ts`. It does **not** call the main app's routes over HTTP.

### Needs Review inbox

**Phase 1:** `TournamentDedupTab` renamed to `Needs Review`. Same UI, same behavior. Sidebar badge shows the dedup queue count.

To populate the sidebar badge without opening the tab, Phase 1 adds a thin counts endpoint:

```
GET /api/internal/needs-review/counts
→ { duplicates: 3 }
```

The sidebar polls this every 60s. Phase 2 widens the response shape (`{ duplicates, unresolvedPlayers, oopChanges, streamMapping }`) without breaking the sidebar.

**Phase 2:** Becomes a typed inbox.

- Filter chips: All · Duplicate Matches · Unresolved Players · OOP Changes · Stream Mapping
- Each row has a `type`, a summary, a timestamp, and a "Review" action
- Clicking Review opens a typed drawer specific to the queue (the existing UIs become drawer content)
- New endpoint `GET /api/internal/needs-review?type=...` aggregates across queues with consistent shape

This abstraction matters because every new exception queue (match stats unresolved, future stat enrichment failures, etc.) lands as a new chip rather than a new sidebar entry.

## Visual reference (mockups)

A reference mockup of five core screens was produced during brainstorming. The image is reserved at:

```
docs/superpowers/specs/assets/2026-05-20-admin-ops-mockup.png
```

Once the file is dropped at that path it can be embedded inline below by uncommenting:

```markdown
<!-- ![Admin ops app mockup — five core screens](assets/2026-05-20-admin-ops-mockup.png) -->
```

The text descriptions below capture the design intent so it survives even if the image is ever lost. Treat the descriptions as canonical; treat the image as an illustration.

### Screen 1 — Today (HOME)

Header: title `Today — Overview`, subtitle `Your live operations command center`, top-right `Customize` button, `Last updated 10:24:30` timestamp.

**KPI strip — 4 tiles in a row across the top:**

| Tile | Value | Delta | Notes |
|---|---|---|---|
| Live Matches | 23 | 6 in progress | Sparkline |
| Needs Review | 18 | 5 vs yesterday | Sparkline |
| OOP Pending | 7 | 2 vs yesterday | Sparkline |
| Streams Live | 23 | No change | Sparkline |

**Two-column middle section:**

- **LIVE NOW** (left, ~⅔ width) — table of currently-live matches, one row per court. Columns: court, pair 1 / pair 2, set scores (current set highlighted), `LIVE` pill, elapsed time. Sample rows from mockup:
  - Court 1 · A. Tapia / A. Coello vs M. Galán / J. Lebrón · 6-3, 4-0 · 32m
  - Court 2 · M. Ortega / F. Alonso vs J. Ruiz / A. Arroyo · 4-2, 1-5, 1-6 · 28m
  - Court 3 · B. González / J. García vs C. Gutiérrez / J. Momo · 1-0, 6-3, 0-1 · 18m
  - Footer: `View all matches →`

- **REQUIRES ATTENTION** (right, ~⅓ width) — vertical list of queue summaries, each row a `Needs Review` filter:
  - Duplicate Matches · 5
  - Unresolved Players · 8
  - OOP Changes Pending · 3
  - Awaiting Stream Mapping · 2
  - Footer: `View all →`

**TODAY'S SCHEDULE** (full width, below) — hour buckets with match count and round label:
- 09:00 · Round of 16 · 6 matches
- 11:00 · Quarter Finals · 4 matches
- 14:00 · Semi Finals · 2 matches
- 17:00 · Finals · 2 matches
- Footer: `View full schedule →`

**Two-column bottom section:**

- **RECENT ACTIVITY** (left) — reverse-chrono feed of operator + system events. Sample rows:
  - 10:24 · Score updated · Court 2 · M. Ortega / F. Alonso vs J. Ruiz / A. Arroyo
  - 10:18 · Player updated · Court 3 · J. Lebrón
  - 10:12 · Stream connected · Court 3
  - 10:05 · OOP change applied · Court 1 · A. Tapia / A. Coello
  - Footer: `View all activity →`

- **DATA HEALTH** (right) — labeled progress bars:
  - Overall Score · 98%
  - Matches · 99%
  - Players · 97%
  - Streams · 96%
  - News & Highlights · 100%

Sidebar bottom (sticky): `All Systems / Operational` green pill.

*Phase scoping reminder:* in Phase 1 ship KPI strip + LIVE NOW + REQUIRES ATTENTION + TODAY'S SCHEDULE + status pill. RECENT ACTIVITY and DATA HEALTH are Phase 2.

### Screen 2 — Tournament Explorer (TOURNAMENT OPS)

Header: title `Tournament Explorer`, subtitle `Discover and manage tournament data`, top-right `+ Add Tournament` button.

Toolbar: search input · `All Status` dropdown · `All Circuits` dropdown · `All Countries` dropdown · date-range picker (`May 12 — May 26, 2025`) · `Filters` button.

Filter chips below toolbar with counts: `All 24 · Live 6 · Upcoming 8 · Completed 10 · Drafts 2`.

Tournament list table:

| # | TOURNAMENT | STATUS | DATES | LOCATION | MATCHES | PROGRESS |
|---|---|---|---|---|---|---|
| 1 | Qatar Major 2025 *(Premier Padel)* | LIVE | May 19 – May 25 | Doha, Qatar | 42/56 | 75% bar |
| 2 | Brussels P2 *(Premier Padel)* | LIVE | May 19 – May 25 | Brussels, Belgium | 28/48 | 58% bar |
| 3 | Italy Major *(Premier Padel)* | LIVE | May 12 – May 18 | Rome, Italy | 52/64 | 100% bar |
| 4 | Santiago P1 *(Premier Padel)* | UPCOMING | May 26 – Jun 1 | Santiago, Chile | 0/56 | 0% bar |
| 5 | Valladolid P2 *(Premier Padel)* | UPCOMING | May 26 – Jun 1 | Valladolid, Spain | 0/48 | 0% bar |

Footer: `Showing 1 to 5 of 24 tournaments` · pagination `1 2 3 4 5 …`.

Each row clicks through to the per-tournament detail page (Phase 2 routing change). In Phase 1 click expands inline / opens drawer using the existing TournamentExplorerTab internals.

### Screen 3 — Needs Review (TOURNAMENT OPS)

Header: title `Needs Review`, subtitle `Items that require human attention`, top-right `Mark all as reviewed` button.

Filter chips with counts: `All 18 · Duplicate Matches 5 · Unresolved Players 8 · OOP Changes 3 · Stream Mapping 2`.

Search input · `Sort: Newest` dropdown.

Typed inbox table:

| TYPE | ITEM | DETAILS | ADDED | ACTIONS |
|---|---|---|---|---|
| Duplicate Match | A. Tapia / A. Coello vs M. Galán / J. Lebrón | Qatar Major 2025 | 10:24 | `Review` |
| Unresolved Player | Juan Martín Di Nenno | Missing nationality | 10:18 | `Review` |
| OOP Change | Court 1 – Match 12 | Player swapped positions | 10:12 | `Review` |
| Duplicate Match | B. González / J. García vs C. Gutiérrez / J. Momo | | 10:05 | `Review` |
| Unresolved Player | Leo Godallier | Missing ranking | 09:58 | `Review` |
| Stream Mapping | Court 3 – QF | Stream not mapped | 09:45 | `Review` |

Each row's `Review` action opens a typed drawer specific to the queue (Phase 2). In Phase 1 the table only shows Duplicate Match rows; the other filter chips render an empty state with "coming soon" copy.

Footer: `Showing 1 to 6 of 18 items` · pagination.

### Screen 4 — Entry Lists (TOURNAMENT OPS)

Header: title `Entry Lists`, subtitle `Manage tournament entries and pairs`, top-right `Download` + `+ Add Entry` buttons.

Tournament selector dropdown: `Qatar Major 2025` · `All Categories` · `All Status`.

Category sub-tabs with counts: `Men 32 · Women 24 · Qualifying Men 16 · Qualifying Women 12`.

Entry table:

| # | PAIR / PLAYER | RANK | STATUS | POINTS |
|---|---|---|---|---|
| 1 | A. Tapia / A. Coello | 1 | Confirmed | 18,680 |
| 2 | M. Galán / J. Lebrón | 2 | Confirmed | 15,420 |
| 3 | F. Chingotto / A. Galán | 3 | Confirmed | 13,980 |
| 4 | J. Garrido / M. Yanguas | 4 | Confirmed | 9,850 |
| 5 | M. Ortega / F. Alonso | 5 | Confirmed | 8,720 |
| 6 | J. Rico / Á. Ruiz | 6 | On Hold | 7,650 |

Footer: `Showing 1 to 6 of 32 entries` · pagination.

### Screen 5 — Players (CATALOGS)

Header: title `Players`, subtitle `Browse and manage player profiles`, top-right `+ Add Player` button + `Filters` button.

Toolbar: search input · `All Countries` dropdown.

Players table:

| # | PLAYER | COUNTRY | RANK | POINTS | MATCHES | STATUS |
|---|---|---|---|---|---|---|
| 1 | Agustín Tapia | ARG | 1 | 9,560 | 24 | Active |
| 2 | Arturo Coello | ESP | 2 | 9,120 | 25 | Active |
| 3 | Alejandro Galán | ESP | 3 | 7,840 | 24 | Active |
| 4 | Federico Chingotto | ARG | 4 | 7,380 | 24 | Active |
| 5 | Juan Lebrón | ESP | 5 | 6,300 | 23 | Active |
| 6 | Martín Di Nenno | ARG | 6 | 5,980 | 22 | Active |

Footer: `Showing 1 to 6 of 2,456 players` · pagination up to page 410.

### Common chrome (all screens)

- **Sidebar** (left, ~220px) — collapsed shows ~44px icon strip. Groups: HOME · TOURNAMENT OPS · CATALOGS · CONTENT · SYSTEM (collapsed by default). Badge on `Needs Review` shows total queue count.
- **Top bar** — global search input with ⌘K hint (Phase 2) · notification bell with red-dot indicator (Phase 2) · user avatar + initials.
- **Footer** — `All Systems / Operational` green pill (or yellow / red roll-up).

### Cross-screen patterns

- Tables use sentence case for headers, monospace for IDs / scores, status pills for booleans, hover state highlights the row
- Action buttons are right-aligned in the page header (`+ Add Tournament`, `+ Add Player`, etc.)
- Filter chips sit below the toolbar with counts in monospaced superscripts
- Drawers (Review, edit player, edit pair) slide in from the right at ~480px wide
- All tables paginate at 10 rows by default

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

Hashing: `bcryptjs` cost **10**. Pure JS, no native bindings — safe on Vercel serverless. Cost 10 in bcryptjs runs ~80–120ms on a warm Vercel instance and 200-300ms cold. Going to cost 12 triples those numbers (`bcryptjs` is 2-3× slower than native `bcrypt`); not worth the latency for an internal tool with a small operator set. Revisit if compromised-password risk model changes.

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

### Operator onboarding — how a new operator first signs in

The `operators` allow-list controls *who can access*; the providers above control *how they authenticate*. A new operator needs both: a row in `operators` AND a way to authenticate.

**Happy path:**

1. Admin inserts a row into `operators` for the new operator's email (matching their existing `users.id`, or creating it if absent — see below)
2. New operator visits `admin.padelnachos.com/login` and signs in with **Google OAuth** (or **email magic-link** if no Google account). On first sign-in, Auth.js creates the `users` row if one doesn't already exist
3. Middleware sees a valid session + allow-listed user → grants access
4. *(Optional)* From a profile page (Phase 2), the operator sets a password. Their `users.password_hash` is populated. Future logins can use email + password.

**Fallback path (forgot or never set):**

- Operator visits `/forgot-password`, enters their (allow-listed) email
- Token-based reset email sent → they pick a password → ready to log in via email + password

**Pre-creating users for invitees:**

For Phase 1 we don't pre-create `users` rows — the operator's first sign-in via Google/magic-link creates them. The `operators` row references by email lookup (`operators_user_id = (select id from users where email = ?)`) executed at insert time. If the email doesn't yet exist in `users`, the admin can still insert a placeholder row using a pending `users` row, or wait for the operator's first sign-in. Phase 2's `/admin/users` UI will manage this end-to-end.

### Rate limiting

Failed login attempts: 5 per IP per 15 min. In-memory ring buffer keyed on IP, stored on each serverless instance.

**Honest about the trade-off:** Vercel serverless functions scale across many instances, each with isolated memory. A determined attacker bypasses an in-memory limiter by hitting different instances. This is good-enough deterrence against accidental brute-force / typos / stuck scripts, but not real abuse protection.

If the threat model ever moves beyond "operator typo," move to Upstash Redis (already common in Vercel projects) — a `~10 LoC` swap to centralized counters. Not worth it for v1 given the tiny user surface.

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

### Session strategy + middleware

The main app uses Auth.js v5 with **database-strategy sessions** (PostgresAdapter writes to `sessions`). The admin app uses the same strategy — both apps must agree on session shape for the shared cookie to validate.

Database sessions don't fire the `jwt` callback (there's no JWT to embed claims in). Instead, the operator check is enriched via the `session` callback in `auth.ts`:

```ts
callbacks: {
  async session({ session, user }) {
    // Single LEFT JOIN to operators on every session read.
    // Auth.js already touches the sessions/users rows here, so this is one extra round-trip
    // per session lookup (which is itself cached for the duration of an RSC render via React's request scope).
    const result = await pool.query(
      'select 1 from operators where user_id = $1 limit 1',
      [user.id],
    )
    session.user.isOperator = result.rowCount > 0
    return session
  },
}
```

**Middleware** (`apps/ops/src/middleware.ts`):

1. If path is in `PUBLIC_PATHS` (`/login`, `/forgot-password`, `/reset-password`, `/api/auth/*`, `/_next/*`) → pass
2. Call `auth()` to get the session (Auth.js handles cookie validation + the `session` callback above)
3. If no session → redirect to `/login?from=${path}`
4. If `session.user.isOperator !== true` → render `/not-authorized` page with sign-out link
5. Otherwise → pass

The `session` callback is the single source of truth for "is this user an operator?" — no JWT-claim drift, no stale-by-30-days problem. Removing someone from `operators` takes effect on their next session read.

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
│   └── internal/               # admin-app-only server routes
│       ├── today/route.ts            # Today page aggregator (Phase 1)
│       └── needs-review/
│           └── counts/route.ts       # sidebar badge counts (Phase 1)
│           # more queue endpoints (Phase 2)
├── auth.ts                     # Auth.js v5 config
└── middleware.ts
```

URL examples: `admin.padelnachos.com/today`, `admin.padelnachos.com/needs-review`, `admin.padelnachos.com/system/architecture`.

## Local development

| App | Port | URL |
|---|---|---|
| Main public app | 3002 | http://localhost:3002 |
| Labs | 3003 | http://localhost:3003 |
| **Admin (new)** | **3004** | **http://localhost:3004** |

`apps/ops/package.json` scripts:

```json
{ "scripts": { "dev": "next dev -p 3004", "build": "next build", "start": "next start" } }
```

### Environment variables

Same `.env.local` schema as the main app + Labs, **plus**:

- `AUTH_URL=http://localhost:3004` (or the prod admin URL when deployed)
- `INITIAL_OPERATOR_EMAIL=<your-email>` — read by the seed migration so we don't hard-code emails into version control

**Critical:** `AUTH_SECRET` and `DATABASE_URL` MUST be identical between the main app's `.env` and the admin app's `.env`. If they differ, session cookies from one app won't validate on the other.

### Cross-domain session sharing in dev

Browsers don't share cookies across `localhost:3002` and `localhost:3004` even with a parent-domain cookie config — they're different ports on the same host, but each port is its own origin for cookie purposes. The shared-session feature is **production-only**.

In dev, each app has its own independent session. To test the cross-domain flow locally, either:

- Use [Caddy](https://caddyserver.com/) or `dnsmasq` to map `app.padelnachos.test` → `:3002` and `admin.padelnachos.test` → `:3004`, then set the cookie domain to `.padelnachos.test`
- Or just deploy the admin app to a Vercel preview URL and test session sharing against a staging main app

Not worth blocking the v1 build on this — operators will be using the deployed admin URL.

## Phasing

### Phase 1 — the new app stands up

1. Scaffold `apps/ops/` matching `apps/labs/` setup (port 3004, own `package.json`, own `next.config.ts`)
2. Auth: three providers + operator allow-list + middleware + session callback enrichment
3. Login / forgot-password / reset-password pages
4. Sidebar with full IA (groups + sidebar-badge polling)
5. Today page: KPI strip + LIVE NOW + TODAY'S SCHEDULE + system status footer (no Recent Activity, no Data Health panel yet)
6. Internal endpoints: `GET /api/internal/today`, `GET /api/internal/needs-review/counts`
7. All existing tabs lifted into their new locations — functionally identical to current `/ops`
8. Tournament Explorer kept as a single tab (no list/detail refactor)
9. Needs Review is the renamed dedup tab, single queue
10. Deploy to `admin.padelnachos.com`
11. Old `/ops` in the main app stays alive

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

- **Cookie domain change** on the main app needs careful rollout. Setting `domain=.padelnachos.com` on a cookie that was previously host-only invalidates existing sessions for users on `www.padelnachos.com`. Mitigate by shipping the cookie-domain change on the main app *before* the admin app launches, and accepting that users will need to sign in once. Communicate via banner or release notes.
- **Bcrypt cost on Vercel cold start:** at cost 10 in `bcryptjs`, expect 200-300ms on a cold instance. Acceptable for login (rare). Going higher (cost 12) triples that — not worth it for an internal tool.
- **`/operators` query on every session read:** the `session` callback adds one DB round-trip per session lookup. In practice each RSC render reads the session once and Auth.js caches within the request via React's request scope. If we see hot-path latency, add a 60s in-process cache keyed on `user.id` — but ship without it first.
- **Cross-app session cookie in dev:** doesn't work on `localhost:3002` vs `localhost:3004` because they're different origins. Documented in Local development; not a release blocker.

## Appendix A — per-tab lift inventory

What each tab actually requires to lift cleanly. Verified against `src/app/ops/` and `src/app/api/ops/` on 2026-05-20.

| Tab | Component file | Sub-files | API routes consumed | Notes |
|---|---|---|---|---|
| **Today** *(new)* | new | — | `GET /api/internal/today` | Aggregator reads Supabase directly. Reuses SQL from `/api/ops/launch-monitor` + dashboard data |
| **Tournament Explorer** | `TournamentExplorerTab.tsx` | `tournament/CalendarView.tsx`, `tournament/ScheduleReviewPanel.tsx`, `tournament/TournamentDrawSubtab.tsx`, `tournament/TournamentMatchesSubtab.tsx` | `/api/ops/tournament-explorer`, `/api/ops/refresh-tournament`, `/api/ops/tournament-prize`, `/api/ops/schedule-review`, `/api/ops/tournament-draw`, `/api/ops/tournament-matches` | Biggest lift. ~1,300 lines + 4 sub-files + 6 API routes. Phase 1 lifts as-is; Phase 2 splits list/detail |
| **Entry Lists** | `PadelgodEntryListTab.tsx` | — | `/api/ops/padelgod-entry-list`, `/api/ops/seed-fip-entry-list`, `/api/ops/link-fip-id`, `/api/ops/tournament-fip-twin` | |
| **Needs Review** *(rename)* | `TournamentDedupTab.tsx` | — | `/api/ops/tournament-dedup`, `/api/ops/duplicate-scan` *(shared with Players)* | Plus new `/api/internal/needs-review/counts` for sidebar badge |
| **Simulator** | `SimulatorTab.tsx` | — | `/api/ops/simulator` | Self-contained |
| **Players** | `PlayersTab.tsx` | `players/BulkActionsBar.tsx`, `players/FilterChips.tsx`, `players/PlayerDrawer.tsx`, `players/PlayersTable.tsx`, `players/types.ts` | `/api/ops/players`, `/api/ops/search-players`, `/api/ops/duplicate-scan` | 5 sub-files; cleanest decomposition in the existing codebase |
| **Brands & Equipment** | `BrandsTab.tsx` | — | `/api/ops/brands`, `/api/ops/rackets`, `/api/ops/extract-racket`, `/api/ops/upload-equipment-image` | The extract-racket route hits Anthropic; carry over env vars |
| **Streams** *(rename)* | `FipStreamsTab.tsx` | — | `/api/ops/fip-streams`, `/api/ops/seed-entry-list` | |
| **News** | `NewsTab.tsx` | — | `/api/ops/news` | Self-contained |
| **Highlights** *(rename)* | `HighlightPickerTab.tsx` | — | `/api/ops/highlight-picker` | Self-contained |
| **Integration Health** | inline in `OpsClient.tsx` ~L748 | — | `/api/ops/dashboard` *(implicit, via DashboardData)* | Must extract into its own file before lift |
| **Data Quality** | inline in `OpsClient.tsx` ~L888 | — | `/api/ops/dashboard` *(implicit)* | Must extract into its own file before lift |
| **Padelgod Health** | `PadelgodHealthTab.tsx` | — | `/api/ops/padelgod-health` | Self-contained |
| **Shadow Mode** | `PadelgodShadowTab.tsx` | — | `/api/ops/padelgod-shadow` | Self-contained |
| **Architecture** | `ArchitectureTab.tsx` | — | none (static SVG) | Pure lift |

**Important per Reuse Strategy:** the `/api/ops/*` routes listed are existing main-app routes. The admin app does **not** call them cross-origin. Each route's server-side logic is copied into `apps/ops/src/app/api/internal/...` (or directly inlined as a React Server Component data fetch) during the lift. Phase 2 deletes the duplicated `/api/ops/*` routes from the main app at cutover.

**Bundle size check:** Tournament Explorer is the only file > 1,000 lines. All others are independently sized. No single-tab lift should require coordinated changes across more than 6 files.

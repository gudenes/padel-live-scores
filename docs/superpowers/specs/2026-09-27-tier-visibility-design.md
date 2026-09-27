# Tier Visibility — admin-controlled hiding of tournament tiers

**Date:** 2026-09-27
**Branch:** `feat/tier-visibility`
**Worktree:** `/Volumes/Crucial/dev/padel-tier-visibility`
**Status:** design approved, not implemented

## Problem

Some tournament tiers don't belong on padelnachos.com. FIP Promises is the
motivating case: 125 tournaments (106 in the last 120 days), 4,874 matches —
our **#3 tier by event count and #2 by match count** — and it's low-stakes
content that dilutes the product.

Today there is a switch, but it is hardcoded and mostly cosmetic.
`src/components/home/shared.tsx:329` holds:

```ts
export const HIDDEN_TOURNAMENT_LEVELS = ['fip_promises', 'fip_beyond']
export const isHiddenLevel = (level?: string | null) =>
  !!level && HIDDEN_TOURNAMENT_LEVELS.includes(level)
```

Its comment claims the tier is "hidden from user-facing tournament/event
surfaces" and that emptying the array "re-enables them everywhere". Neither is
true. It is wired into exactly **four** call sites:

| Site | What it covers |
|---|---|
| `src/app/[locale]/(app)/home/page.tsx:404` | home Live Now |
| `src/app/[locale]/(app)/home/page.tsx:417` | home Live Tournaments carousel |
| `src/components/home/TournamentsView.tsx:215` | `/tournaments` FIP tab allow-list |
| `src/components/home/TournamentsView.tsx:600` | `/tournaments` FIP subtier chips |

Everything else leaks. So this work has two goals, and the second is the one
that actually changes what users see:

1. Make tier visibility **operator-controlled** — flip a tier off or back on
   from the admin, no deploy.
2. Make hiding **actually complete** — close the ~14 surfaces that leak today.

### What leaks today

Audited across `src/` (admin/ops/cron paths excluded).

| Surface | Leak | `level` in query? |
|---|---|---|
| `/matches/[date]` + `/api/matches/by-date` | Primary match list. SSR'd, CDN-cached, emits `SportsEvent` JSON-LD | yes |
| home → Latest Results | The one unfiltered home section, directly below three filtered ones | yes |
| `sitemap-tournaments.xml` / `sitemap-matches.xml` | Submits hidden-tier URLs to Google × 5 locales | **no** |
| `/tournaments/[id]`, `/match/[id]` | Render fully on direct URL; no noindex, no 404 | yes (layouts) |
| `/player/[id]` results, season, titles, earnings | Hidden-tier results counted and rendered | yes |
| `/api/player/[id]/next-enrollment` | Promotes "plays next at <hidden event>" | yes |
| search page + `SearchOverlay` | Tournament index, "popular", match-by-player | partial |
| `/api/push/notify` | Pushes + writes `user_notifications` bell rows | yes |
| bottom-nav LIVE badge (both navs) | Counts hidden-tier live matches — "LIVE 3" over an empty list | **no** |
| `fetch-matches-calendar.ts` | Day-pill dots + the LIVE-pill tap gate | **no** |
| `/picks` | Tournament selector + leaderboard scope | yes |
| `/following` | Followed matches and tournaments | **no** |

Already correct: home Live Now, home Coming Up (DB-side Premier-only), home
Spotlight hero (DB-side Premier-only), home Live Tournaments carousel,
`/tournaments` list + subtier chips.

**Timing note.** There are 7 Promises events running as of 2026-09-26 but zero
Promises matches in the last 7 days, so today's live leak is mostly
tournament-shaped (search, sitemaps) rather than match-shaped. A calm moment to
ship.

## Decisions

Settled during design:

| Question | Decision |
|---|---|
| How deep does hiding go? | **Full blackout** — browse, detail pages, search, sitemaps, push |
| Control shape | **Dedicated `/system/tier-visibility` admin page**, not N feature-flag rows |
| Player career stats | **Keep the stats, hide the navigation** — results still count; links go plain-text |
| Hidden detail-page URLs | **404** via `notFound()` |
| Tiers off on day one | `fip_promises` + `fip_beyond` — a faithful port of today's array |

### Why not RLS

RLS on `tournaments`/`matches` for the anon role would be impossible to forget
and need zero call-site changes. Rejected because it **contradicts the career-stats
decision** — it would strip hidden-tier matches out of a player's W/L, win rate,
titles and earnings — and because it would silently affect the Padel Labs app,
which shares this Supabase project and reads the same public tables.

### Why a table, not feature flags

`feature_flags` was the obvious rail (public-read RLS, prod/local split, existing
admin UI). Rejected for this because ~19 boolean rows makes the flags page a wall
of toggles, carries no `label`/`sort_order`, and costs 19 lookups instead of one
set fetch. The new table mirrors the `feature_flags` *pattern* without living
inside it.

## Design

### 1. Data model

```sql
create table public.tier_visibility (
  level          text primary key,
  label          text not null,
  visible        boolean not null default true,
  visible_local  boolean not null default true,
  sort_order     int,
  updated_at     timestamptz not null default now(),
  updated_by     text
);
```

- Public-read RLS, service-role writes, `updated_at` trigger — same shape as
  `feature_flags` (`supabase/migrations/20260520_feature_flags.sql`).
- `visible` = production; `visible_local` = localhost dev. Lets a tier stay dark
  in prod while being worked on locally, and vice versa.
- Seeded with all 19 levels present in `tournaments` today. `fip_promises` and
  `fip_beyond` seed to `visible=false, visible_local=false`.

**Default is visible.** A level with no config row resolves to visible. When
padelgod stamps a new tier (it has invented several — see
`padelgod/src/lib/fip-categories.ts`) that tier appears rather than silently
vanishing. Silent hiding of new content is the worse failure mode.

**Forward compatibility.** A later `tournaments.hidden_override boolean` can
layer on for "hide just this one event" without reshaping this table.

### 2. Resolution semantics

New module `src/lib/tier-visibility.ts`.

```ts
export async function fetchHiddenTiers(supabase: SupabaseClient): Promise<Set<string>>
export function isTierHidden(level: string | null | undefined, hidden: Set<string>): boolean
```

A missing `level` (null/empty) is **never** hidden — an unclassified row is not
evidence of a hidden tier.

**The prod/local subtlety.** `src/lib/feature-flags.ts`'s existing `isLocalEnv()`
reads `window.location.hostname` and returns `false` during SSR. Reusing it here
would make local dev disagree with itself: `/matches/[date]` (server-rendered)
would read the `visible` column while the home page (client) reads
`visible_local`. So the module exposes two resolvers:

- **client:** hostname check, matching `isLocalEnv()`'s existing behaviour
- **server:** `process.env.NODE_ENV !== 'production'`

Server reads go through a module-level 60s TTL cache (`{ value, expiresAt }`), so
`/matches/[date]` — which is `force-dynamic` — does not add a query per request.
Deliberately not `unstable_cache`: this is Next 16 and the plain cache has no
API-stability risk.

Client surfaces get a small provider/hook so the set is fetched once per page
rather than per component.

**Propagation delay.** A toggle takes effect within ~60s on match lists (TTL +
`/api/matches/by-date`'s `revalidate = 60`) and up to 1h on the sitemaps
(`revalidate = 3600`). The admin page states this rather than leaving the
operator guessing.

### 3. Admin control surface

Built in **`apps/ops` only** — the deployed admin. The legacy `src/app/ops`
tab-based dashboard gets nothing.

- Page: `apps/ops/src/app/(app)/system/tier-visibility/page.tsx`
- Rail entry + command-palette entry beside Feature Flags
  (`apps/ops/src/components/shell/Rail.tsx:48`,
  `apps/ops/src/lib/command-palette.ts:33`)
- API: `GET /api/internal/tier-visibility`, `PATCH /api/internal/tier-visibility/[level]`
  — mirroring `apps/ops/src/app/api/internal/feature-flags/` exactly
- Built from the existing `ui/` primitives (`PageHeader`, `Panel`, `Button`,
  `EmptyState`), token-driven so both themes work

Each row shows **label · raw `level` code · total tournaments · last 120d · live
now**, then two switches (Production · Local). The counts are what make the page
self-documenting: seeing `fip_promises · 125 · 106 · 7` tells the operator
exactly what they're switching off.

The page's tier list is `select distinct level from tournaments` **unioned with**
the config rows, so a newly-invented tier appears automatically with no
migration. Labels come from the DB `label` column rather than importing
`src/lib/tournament-labels.ts` — `apps/ops/src/lib` does not currently mirror
that file, and sourcing from the DB avoids creating a new mirror to drift.
Unioned-in tiers with no config row render with a "not configured — visible by
default" hint.

### 4. Single source of truth

`HIDDEN_TOURNAMENT_LEVELS` and `isHiddenLevel` are **deleted** from
`src/components/home/shared.tsx:329-331` and their four call sites repointed at
the new module. Keeping both would guarantee drift — the stale comment on the old
constant is evidence of exactly that.

### 5. Enforcement map

Line numbers are against `origin/main` @ `fece38f2f`.

**Group 1 — `level` already selected; apply the filter.**

| Site | Change |
|---|---|
| `src/lib/fetch-matches-day.ts:200` | The choke point. Extends the existing `.filter((m) => !!m.tournament)`. Covers `/matches/[date]`, `/api/matches/by-date`, and the `SportsEvent` JSON-LD for free |
| `src/app/[locale]/(app)/home/page.tsx:410` | Latest Results (`setRecentMatches`) |
| `src/app/[locale]/(app)/home/page.tsx:404`, `:417` | Repoint existing `isHiddenLevel` filters |
| `src/components/home/TournamentsView.tsx:215`, `:600` | Repoint existing `isHiddenLevel` filters |
| `src/app/[locale]/(app)/search/page.tsx:84` | Tournament results |
| `src/components/nav/SearchOverlay.tsx:126`, `:172` | Tournament index + "popular" |
| `src/app/[locale]/picks/page.tsx:33` | Tournament selector |
| `src/app/api/push/notify/route.ts:274` | Skip the match entirely — no push, no `user_notifications` row |

**Group 2 — `level` must be added to the query.**

| Site | Change |
|---|---|
| `src/app/sitemap-tournaments.xml/route.ts:29` | Add `level` to the select, filter |
| `src/app/sitemap-matches.xml/route.ts:39` | Add `tournaments!inner(level)`, filter |
| `src/lib/fetch-matches-calendar.ts:91`, `:98` | Day-pill dots + the LIVE-pill tap gate |
| `src/components/nav/BottomNavV3.tsx:294`, `src/app/components/BottomNav.tsx:217` | Live badge → `tournaments!inner(level)` + `not.in` predicate, so "LIVE 3" can't sit over an empty list |
| `src/app/[locale]/(app)/following/page.tsx:587`, `:619` | Followed matches + followed tournaments |
| `src/app/api/player/[id]/next-enrollment/route.ts:46` | Don't promote an event whose page now 404s |

**Group 3 — 404 on detail pages.**

Both layouts already have a `notFound()` path, so the guard has a natural home:

| Site | Change |
|---|---|
| `src/app/[locale]/(app)/tournaments/[id]/layout.tsx:87` | Extend the `tournamentExists === false` guard |
| `src/app/[locale]/match/[id]/layout.tsx:154` | Extend the `matchExists === false` guard |

Guarding in the **layout** (server) rather than the client page covers
`generateMetadata`, the JSON-LD emitters, and `opengraph-image.tsx` with one
change each. The existing `isGhost` → `robots: noindex` path at
`tournaments/[id]/layout.tsx:50` is the precedent.

### 6. Player profile — the deliberate exception

Hidden-tier matches **keep counting** toward career W/L, win rate, titles and
earnings, and their rows still render. Only two things change:

1. Any row linking to a now-404ing detail page renders as **plain text instead of
   a link** — results list, season rows, titles callout, earnings rows.
2. The **next-enrollment strip is filtered out**, because that is promotion
   rather than a stat.

Rationale: results are facts; visibility is presentation. This also avoids a
player's record silently shifting when an operator flips a toggle, and avoids a
Promises-only player's profile going blank.

### 7. Keeping it from rotting

The failure mode of per-call-site filtering is a future surface that forgets.
Mitigation: `scripts/audit-tier-visibility.ts`, in the same idiom as the existing
`scripts/audit-unranged-selects.ts` — flags queries against `matches` /
`tournaments` in user-facing paths that don't apply the filter. Heuristic, not a
CI gate, same as its sibling.

### 8. Implementation traps

- **Empty hidden set breaks `not.in`.** PostgREST rejects `not.in.()`. Every
  Group 2 site must skip the predicate entirely when `hidden.size === 0` — which
  is the normal state once an operator re-enables everything. This is the most
  likely way to ship a 500.
- **`!inner` on a head count.** The bottom-nav badge currently uses
  `select('*', { count: 'exact', head: true })`. It becomes
  `select('id, tournaments!inner(level)', { count: 'exact', head: true })` — the
  inner join must be in the select string for the count to respect it.
- **Client fetch must not block first paint.** The hidden set resolves to "hide
  nothing" until loaded, so a hidden tier can flash in for one frame on
  client-rendered surfaces. Acceptable on `/tournaments` and home (both already
  render a loading state), but the set must be fetched in the *same*
  `Promise.all` batch as the page's other queries, not chained after it.

## Testing

**Unit (vitest):**
- `tier-visibility.ts` resolution: missing row → visible; `visible` vs
  `visible_local` column selection; null/empty `level` → never hidden; null
  column values → default
- `fetch-matches-day.ts`: hidden-tier matches dropped, visible ones kept, groups
  with only hidden matches removed entirely
- `push/notify`: hidden-tier match produces no push and no `user_notifications`
  row

**Manual, on `localhost:3002`:**
1. With `fip_promises.visible_local = false` — `/matches/<a date with Promises
   matches>`, home Latest Results, search "promises", `/tournaments` FIP tab,
   bottom-nav LIVE badge, `sitemap-tournaments.xml`, and a direct
   `/tournaments/<promises id>` URL (expect 404).
2. Flip to `true` in the admin, wait out the 60s TTL, confirm every surface
   returns.
3. A player with Promises results: confirm W/L and titles unchanged, rows present
   but not clickable, enrollment strip clean.

Step 2 is the one that matters most — the whole point is that this is reversible.

## Out of scope

- **Feed relevance scoring** (`src/app/[locale]/(app)/feed/FeedClient.tsx`) —
  hidden-tier player *names* nudge article ranking; nothing tournament-shaped is
  rendered. Indirect, cosmetic.
- **Padelgod ingestion** — unchanged. We keep collecting hidden-tier data; this
  is display-only. Flipping a tier back on must surface complete history.
- **`/rankings`** — players only, unaffected.
- **Per-tournament overrides** — the table is shaped to allow it later.
- **Legacy `src/app/ops`** — no new tab.

## Notes

- Work happens in the `/Volumes/Crucial/dev/padel-tier-visibility` worktree; the
  primary working directory's branch is switched by concurrent sessions.
- Merging to `main` does not deploy. padelgod auto-deploys on merge; the admin
  (`apps/ops`) needs a manual `railway up` from inside `apps/ops`.
- The migration applies via the pg driver + `DATABASE_URL`, not
  `supabase db push` (the migrations directory has drift).

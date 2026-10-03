# Tier Visibility — admin-controlled hiding of tournament tiers on /matches

**Date:** 2026-09-27 (re-scoped 2026-10-03)
**Branch:** `feat/tier-visibility`
**Worktree:** `/Volumes/Crucial/dev/padel-tier-visibility`
**Status:** implemented on `feat/tier-visibility` (2026-10-03); migration NOT applied, not deployed

## Re-scope note (2026-10-03)

The 2026-09-27 version of this spec designed a **full blackout**: hidden tiers
removed from ~14 surfaces, detail pages 404, sitemaps, search, push. It was
never built. On 2026-10-03 Gustavo narrowed the ask:

> a toggle in the admin to hide some tournament tiers from the matches page —
> keep other pages like events etc. Mainly for initial tiers such as Promises
> and Beyond, which make noise in the UI.

This spec now covers **/matches only**. It keeps the 09-27 data shape (one
config row per tier, dedicated admin page) so the full blackout can be layered
on later without reshaping anything. The 09-27 leak audit is preserved in git
history (`88f1be1f5`) for when that happens.

## Problem

Low-tier FIP events (Promises, Beyond) are noise on the /matches day page.
Promises alone has 130 tournaments and ~5,000 matches all-time; Beyond had 38
matches in the last 90 days. Today the only tier filter is a hardcoded array,
`HIDDEN_TOURNAMENT_LEVELS = ['fip_promises', 'fip_beyond']` in
`src/components/home/shared.tsx:329`, wired into home Live Now, the home Live
Tournaments carousel and the `/tournaments` FIP chips — **not** into /matches.
Changing it needs a deploy.

## Decisions

| Question | Decision |
|---|---|
| Which surfaces? | **/matches only** — day list, day-pill dots, LIVE-pill tap gate. Every other page unchanged |
| Hide mode | **Fully removed** — not collapsed, no user opt-in |
| Per-user exceptions (followed players)? | **No** — one global rule, same SSR HTML for everyone |
| Control shape | Dedicated `/system/tier-visibility` admin page, one row per tier |
| Storage | New `tier_visibility` table (not `feature_flags`, not a jsonb settings blob) |
| Day-one hidden tiers | `fip_promises`, `fip_beyond` — matches today's hardcoded list |
| Hardcoded `HIDDEN_TOURNAMENT_LEVELS` | **Left untouched** — it governs home/tournaments, which are out of scope |

### Why not `feature_flags`

~19 boolean rows would bury the flags page, carry no label/sort order, and the
flags' prod/local split adds nothing here.

### Why no prod/local split

The 09-27 design had `visible` + `visible_local` columns. Dropped (YAGNI): it
forced two resolvers (SSR can't see the hostname) for a toggle an operator can
simply flip and flip back. Local dev reads the same row as prod.

## Design

### 1. Data model

```sql
create table public.tier_visibility (
  level            text primary key,
  label            text not null,
  show_on_matches  boolean not null default true,
  sort_order       int,
  updated_at       timestamptz not null default now(),
  updated_by       text
);
```

- Public-read RLS, service-role writes, `updated_at` trigger — same shape as
  `feature_flags` (`supabase/migrations/20260520_feature_flags.sql`).
- The switch is named **`show_on_matches`**, not `visible`, because it only
  governs /matches. A future full blackout adds its own column rather than
  silently widening this one's meaning.
- Seeded with every level present in `tournaments` today, labels + sort order
  from `levelTierWeight()` (`src/lib/tournament-labels.ts`). `fip_promises` and
  `fip_beyond` seed to `show_on_matches = false`.

**Default is shown.** A level with no row is shown, so a new padelgod-invented
tier appears rather than silently vanishing. A null/empty `tournaments.level`
is never hidden.

### 2. Resolution — `src/lib/tier-visibility.ts`

```ts
export async function fetchMatchesHiddenTiers(supabase: SupabaseClient): Promise<string[]>
```

- Returns `level`s where `show_on_matches = false`.
- Module-level 60s TTL cache (`{ value, expiresAt }`) — `/matches/[date]` is
  `force-dynamic`, so no extra query per request. Plain cache, not
  `unstable_cache`.
- **Fail-open:** on query error, log and return `[]` (hide nothing), caching
  that `[]` for 10s so a missing table doesn't query + warn on every request.
  The page must never go blank because of this table.
- Levels not matching `/^[a-z0-9_]+$/` are dropped from the filter (they
  could break the PostgREST filter string); the admin PATCH rejects them
  with `invalid_level` so the UI can't show "Hidden" for a tier /matches
  would ignore.

### 3. Enforcement — two choke points

All callers of these two helpers are /matches surfaces
(`matches/DailyMatchesView.tsx`, `/api/matches/by-date`,
`/api/matches/calendar`), so filtering inside them scopes the change exactly.

| Site | Change |
|---|---|
| `src/lib/fetch-matches-day.ts` | Filter **DB-side**: switch the embed to `tournament:tournaments!inner(...)` (alias needed for `referencedTable: 'tournament'`) and add `or(level.is.null,level.not.in.(…))` on the referenced table. Covers the SSR page, `/api/matches/by-date` and the `SportsEvent` JSON-LD |
| `src/lib/fetch-matches-calendar.ts` | Same predicate on both queries: the window query (day-pill dots) and the live head-count (LIVE-pill gate), via `tournaments!inner(level)` in the select string |

Why DB-side rather than a JS `.filter()`: the day query has `.limit(400)`.
Filtering after the fetch would let hidden-tier rows consume that budget and
push visible matches off a busy day.

### 4. Admin control surface (`apps/ops` only)

- Page: `apps/ops/src/app/(app)/system/tier-visibility/page.tsx`
- Rail + command-palette entries beside Feature Flags
  (`apps/ops/src/components/shell/Rail.tsx:59`,
  `apps/ops/src/lib/command-palette.ts:35`)
- Stats come from `tier_visibility_stats()` (SQL function in the same
  migration, `EXECUTE` granted to `service_role` only). Its `matches_90d`
  has no upper bound, hence the "+ upcoming" wording.
- API: `GET /api/internal/tier-visibility`,
  `PATCH /api/internal/tier-visibility/[level]` — mirroring
  `apps/ops/src/app/api/internal/feature-flags/`. PATCH upserts, so a tier with
  no row can be toggled.
- Built from existing `ui/` primitives (`PageHeader`, `Panel`, `Button`,
  `EmptyState`), token-driven for both themes.

Each row: **label · raw `level` · tournaments · matches (last 90d + upcoming) · live now**,
then one switch, **"Show on /matches"**. The tier list is
`distinct tournaments.level` unioned with config rows, so a new tier shows up
automatically (with a "not configured — shown by default" hint).

Header copy states the propagation delay: **up to ~2 minutes** (60s TTL +
`by-date` `s-maxage=60`; calendar `s-maxage=30`).

## Implementation traps

- **Empty hidden list breaks `not.in`.** PostgREST rejects `not.in.()`. When the
  list is empty, skip the predicate and the `!inner` switch entirely — that is
  the normal state once everything is re-enabled. Most likely way to ship a 500.
- **`not in` drops NULLs.** `level not in (…)` is NULL for a null level, which
  would hide unclassified tournaments. Hence `or(level.is.null, …)`.
- **`!inner` on a head count.** The live count becomes
  `select('id, tournaments!inner(level)', { count: 'exact', head: true })` — the
  join must be in the select string for the count to respect it.

## Testing

**Unit (vitest):**
- `tier-visibility.ts`: returns only `show_on_matches = false` levels; cache
  hit within TTL; query error → `[]`
- `fetch-matches-day.ts`: predicate applied when list non-empty, omitted when
  empty
- `fetch-matches-calendar.ts` (existing test file): same for both queries

**Manual on `localhost:3002`:**
1. `fip_beyond` hidden → a `/matches/<date>` with Beyond matches no longer lists
   them; that Beyond tournament page still shows its matches; home unchanged.
2. Flip it back on in the admin (`localhost` ops app), wait ~2 min, confirm the
   matches return.
3. Hide everything-but-one → no 500 (exercises the non-empty path); show all →
   no 500 (exercises the empty path).

## Out of scope

- Every non-/matches surface: home, `/tournaments`, tournament/match/player
  pages, search, sitemaps, push, bottom-nav LIVE badge, `/following`, events.
- Removing/repointing `HIDDEN_TOURNAMENT_LEVELS` — follow-up if/when the full
  blackout is built on this table.
- Per-tournament overrides, per-user opt-in.
- Padelgod ingestion — unchanged; hidden-tier data keeps flowing.

## Notes

- The admin page needs the migration applied first; before that its GET
  returns 500 (the /matches side fails open and is unaffected).
- Merging to `main` does not deploy. The web app and the admin (`apps/ops`)
  each need their deploy; padelgod is untouched.
- Migration applies via the pg driver + `DATABASE_URL`, not `supabase db push`.
  **Not applied without Gustavo's go-ahead.** Until applied, the fail-open path
  means /matches behaves exactly as today.

# FIP Rankings — Integration Health tile (data-freshness derived)

**Date:** 2026-06-08
**Status:** Approved (design)
**Branch:** `feat/rankings-integration-health`

## Problem

The Integration Health tab on admin.padelnachos.com (the `apps/ops` app) shows a
"Rankings" tile keyed `cron:rankings`. That tile is driven by the `ops_events`
table, which the **retired** Vercel rankings cron used to write to (retired
2026-05-18, PR #344). FIP rankings are now synced exclusively by the padelgod
Railway worker `player-rankings`, which writes its run log to padelgod's own
`scrape_jobs` table — **not** `ops_events`. As a result the tile is effectively
dead: it never reflects whether the rankings integration is actually healthy.

Operationally we want to answer one question at a glance: **next time FIP
publishes a new weekly ranking, did the worker pick it up?** Today (2026-06-08,
Monday) is exactly the live case — the latest captured snapshot is still
`2026-W23` (`ranking_date 2026-05-31`) while the current ISO week has rolled over.

## Goal

Repurpose the existing `cron:rankings` tile so it reflects the padelgod
`player-rankings` worker by reading **the data the worker produces**
(`player_ranking_snapshots`), not a worker heartbeat. No padelgod/Railway code
changes and no new deploy of the worker.

### Non-goals

- No padelgod worker changes (no heartbeat into `ops_events`).
- No new dashboard tile component — reuse the existing tile grid and status
  colors.
- No backfill / historical analytics. Pure freshness read.

## Decisions (from brainstorming)

1. **Health signal: data-freshness derived.** Query `player_ranking_snapshots`
   directly rather than wiring a worker heartbeat. It answers the real question
   ("did fresh rankings land?") with zero cross-service changes.
2. **Thresholds: grace until mid-week.** FIP publishes weekly (usually Monday,
   timing drifts); the worker runs Mon 06:00–12:00 UTC every 30m + Tue–Sat
   07:00 UTC. So a one-week lag on Mon/Tue is normal, not alarming.
3. **Repurpose the existing `cron:rankings` tile** rather than adding a new one.
4. **Show the four bucket counts** (official/race × men/women) in the summary.

## Architecture

One pure function + one server-side fetch + tile metadata edits. **No client
component changes** — the tile grid already iterates `TILES` and renders
`health[key]` (a `HealthEntry`), and the status→color mapping already handles
`ok` / `partial` / `error`.

```
GET /api/internal/ops-status
  └─ Promise.all([ …existing fetchers…, fetchRankingsHealth(supabase) ])
        └─ queries player_ranking_snapshots (latest week, max captured_at, bucket counts)
        └─ assessRankingsHealth({ now, latestRankingDate, maxCapturedAt, buckets })  // pure
        └─ returns a synthesized HealthEntry
  └─ merge into health['cron:rankings']
  └─ client renders the existing tile with status color + metaSummary
```

`cron:rankings` is **removed** from the `ops_events` `sources` list in
`fetchHealth()` (it has no events) and instead injected by `fetchRankingsHealth`.

### Component 1 — pure verdict function

New module: `apps/ops/src/lib/rankings-health.ts` (pure logic lives in
`src/lib`, where apps/ops keeps its unit-tested helpers + `__tests__/`).

```ts
export interface RankingsBuckets {
  official_men: number
  official_women: number
  race_men: number
  race_women: number
}

export interface RankingsHealthInput {
  now: Date                        // UTC
  latestYear: number | null        // canonical snapshot key (NOT ranking_date)
  latestWeek: number | null        // canonical snapshot key
  latestRankingDate: string | null // display only ('YYYY-MM-DD', mixed provenance)
  maxCapturedAt: string | null     // ISO timestamp of the most recent snapshot row
  buckets: RankingsBuckets         // counts for the latest snapshot (year, week)
}

export interface RankingsHealthResult {
  status: 'ok' | 'partial' | 'error' | 'unknown'
  started_at: string | null        // = maxCapturedAt (so the tile shows "last seen")
  meta: Record<string, unknown>
  error_message: string | null
}

export function assessRankingsHealth(input: RankingsHealthInput): RankingsHealthResult
```

**Why `(year, week)` and not `ranking_date`:** the worker builds each snapshot's
`(year, week)` via `isoYearWeek(new Date(rankingDate))` in
[player-rankings.ts](padelgod/src/workers/player-rankings.ts) — that's the
canonical key (`onConflict: 'player_id,type,year,week'`). The `ranking_date`
column has mixed provenance across code generations (some rows hold the FIP
Sunday date, newer rows hold the ISO Monday), so it is unreliable for math and
used for display only. To compare apples-to-apples, the health module **mirrors
two worker functions byte-for-byte** — `isoYearWeek(date)` (to derive the current
ISO `(year, week)` from `now`) and `weekToDate(year, week)` (to convert any
`(year, week)` to its ISO-Monday for week-diffing). Copying guarantees the
"current week" label matches whatever the worker would store today.

**Verdict logic (grace until mid-week):**

Let:
- `current = isoYearWeek(now)` → `{ year, week }` (mirrored worker fn)
- `weeksBehind = round((weekToDate(current.year, current.week) −
  weekToDate(latestYear, latestWeek)) / 7d)`, clamped at ≥ 0. `weekToDate`
  yields real ISO-Mondays, so this is year-boundary-safe.
- `captureAgeDays = (now − maxCapturedAt) / 1d`
- `dow` = `now` UTC day-of-week (1 = Mon … 7 = Sun)

Rules, in order:

1. `latestYear == null || latestWeek == null || maxCapturedAt == null` →
   **unknown** ("No ranking snapshots found").
2. `captureAgeDays > 9` → **error**
   ("No ranking snapshot in {N} days — worker may be down").
3. `weeksBehind <= 0` (current ISO week captured):
   - if any of the four buckets is `0` → **partial**
     ("Current week captured but missing: {list}").
   - else → **ok**.
4. `weeksBehind == 1 && dow <= 2` (Mon/Tue) → **partial**
   ("Awaiting current week — FIP usually publishes Monday").
5. otherwise → **error**
   ("Current ISO week {current} not captured — latest is {latest}, {N} days into the week").

**Meta** (always populated): `latest_week` (`"YYYY-Www"`), `current_week`
(`"YYYY-Www"`), `weeks_behind`, `ranking_date`, `last_capture`, `official_men`,
`official_women`, `race_men`, `race_women`.

ISO week label (`"YYYY-Www"`) is `${year}-W${String(week).padStart(2,'0')}`,
formatted inline in this module.

### Component 2 — `fetchRankingsHealth(supabase)`

In `apps/ops/src/app/api/internal/ops-status/route.ts`, alongside the existing
`fetchHealth` / `fetchFreshness` / etc.

Queries against `player_ranking_snapshots`:
1. Latest `(year, week)`: `select year, week, ranking_date order by year desc,
   week desc limit 1` → `maybeSingle()`.
2. `max(captured_at)`: `select captured_at order by captured_at desc limit 1` →
   `maybeSingle()`.
3. Per-bucket counts **for that latest `(year, week)`**: four head-count queries
   filtered by `(year, week, type, gender)` — `official/men`, `official/women`,
   `race/men`, `race/women`.

All six reads run in `Promise.all`. Calls `assessRankingsHealth(...)`, returns
the `HealthEntry`-shaped object.
Wired into the route's `Promise.all`; result merged as
`health['cron:rankings']`. `cron:rankings` removed from `fetchHealth`'s
`sources` array.

> Note: `player_ranking_snapshots` RLS returns empty for the anon role, but this
> route runs server-side with the service key (same as the other fetchers), so
> the reads succeed.

### Component 3 — tile metadata

In `apps/ops/src/app/(app)/system/_shared/ops-status-types.ts`:

- Repurpose the `cron:rankings` entry in `TILES`:
  - `label`: `"FIP Rankings"`
  - `schedule`: `"padelgod · Mon 06–12h + Tue–Sat 07h UTC"`
  - `description`: notes padelgod ownership + that health is derived from
    `player_ranking_snapshots` freshness (current ISO week captured?).
- Update `metaSummary('cron:rankings')`:
  - healthy: `` `${latest_week} · Off ${official_men}/${official_women} · Race ${race_men}/${race_women}` ``
  - behind: `` `⚠ latest ${latest_week} · current ${current_week}` ``
- `fetchCronStats` / `SOURCE_COLORS`: leave as-is unless the existing
  `cron:rankings` entries need the label change reflected; no datapoint math
  needed (freshness, not throughput).

## Data flow summary

1. Dashboard polls `/api/internal/ops-status` every 30s (unchanged).
2. Route now also runs `fetchRankingsHealth`, injecting `health['cron:rankings']`.
3. Existing tile renders: status color from `status`, "last seen" from
   `started_at` (= `max(captured_at)`), summary from `metaSummary`.

## Error handling

- Query failure in `fetchRankingsHealth` → return `status: 'unknown'` with
  `error_message` set; never throw (matches the route's other fetchers, which
  degrade gracefully so one failing source doesn't blank the dashboard).
- Null/empty snapshots → `unknown` (rule 1).

## Testing

`assessRankingsHealth` is pure and the core of the feature → unit tests:

- **ok**: current ISO week captured, all four buckets non-zero.
- **partial (missing bucket)**: current week captured, `race_women == 0`.
- **partial (grace)**: one week behind, `now` = Monday.
- **error (mid-week lag)**: one week behind, `now` = Wednesday — *this is today's
  real scenario and should render yellow→red as the week progresses*.
- **error (dead worker)**: `maxCapturedAt` 12 days ago.
- **unknown**: null inputs.

Run with the repo's vitest. If `apps/ops` has no test runner wired, colocate the
test and run via the root `npx vitest run <path>`; otherwise verify manually
against the live dashboard (which, given today's W23-vs-current-week state,
should render the tile yellow on Mon/Tue and red from Wed).

Manual verification: load the Integration Health tab, confirm the FIP Rankings
tile shows the correct color + `latest_week`/bucket summary matching a direct DB
query.

## Files touched

- `apps/ops/src/lib/rankings-health.ts` (new — pure fn + mirrored `isoYearWeek`
  / `weekToDate`)
- `apps/ops/src/lib/__tests__/rankings-health.test.ts` (new — tests)
- `apps/ops/src/app/api/internal/ops-status/route.ts` (add `fetchRankingsHealth`,
  drop `cron:rankings` from `fetchHealth` sources, wire into `Promise.all`)
- `apps/ops/src/app/(app)/system/_shared/ops-status-types.ts` (tile metadata +
  `metaSummary`)

`fetchCronStats`'s historical `cron:rankings` datapoint case (driven by old
`ops_events` rows from the retired Vercel cron) is left as-is — harmless, and the
tile reads `health`, not `cron_stats`.

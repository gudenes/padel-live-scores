# FIP Rankings Integration-Health Tile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repurpose the dead `cron:rankings` Integration-Health tile on admin.padelnachos.com so it reflects the padelgod `player-rankings` worker by reading the freshness of `player_ranking_snapshots` (did the current ISO week get captured?), with no padelgod/Railway changes.

**Architecture:** A pure verdict function (`assessRankingsHealth`) decides ok/partial/error/unknown from the latest snapshot `(year, week)`, `max(captured_at)`, and the four bucket counts. A new server-side fetcher in the ops-status route queries those values and injects a synthesized `HealthEntry` under `health['cron:rankings']`. Tile metadata is relabeled. The client tile grid is unchanged — it already renders `health[key]` with status colors.

**Tech Stack:** Next.js 16 (apps/ops package), TypeScript, supabase-js (service client), Vitest.

**Worktree:** `.claude/worktrees/rankings-health` on branch `feat/rankings-integration-health`. All paths below are relative to that worktree root. The apps/ops package is independent (its own `package.json`, `vitest`, and `@/* → ./src/*` alias).

**Spec:** `docs/superpowers/specs/2026-06-08-rankings-integration-health-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/ops/src/lib/rankings-health.ts` (new) | Pure verdict logic + mirrored `isoYearWeek` / `weekToDate` copied from the worker. No DB, no I/O. |
| `apps/ops/src/lib/__tests__/rankings-health.test.ts` (new) | Unit tests for every verdict branch. |
| `apps/ops/src/app/api/internal/ops-status/route.ts` (modify) | Add `fetchRankingsHealth(supabase)`, wire into `Promise.all`, drop `cron:rankings` from `fetchHealth` sources. |
| `apps/ops/src/app/(app)/system/_shared/ops-status-types.ts` (modify) | Relabel the `cron:rankings` tile + update its `metaSummary` case. |

---

## Task 0: Setup & baseline

**Files:** none (environment only)

- [ ] **Step 1: Install apps/ops dependencies**

The worktree was created from `origin/main` without an install. apps/ops is an independent package.

Run: `cd apps/ops && npm install`
Expected: completes without error (warnings OK).

- [ ] **Step 2: Verify the test runner works on the existing suite**

Run: `cd apps/ops && npx vitest run src/lib/__tests__/readiness.test.ts`
Expected: PASS (this is an existing pure-logic test; confirms vitest + ts resolve in this package).

---

## Task 1: Pure verdict function `assessRankingsHealth`

**Files:**
- Create: `apps/ops/src/lib/rankings-health.ts`
- Test: `apps/ops/src/lib/__tests__/rankings-health.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/ops/src/lib/__tests__/rankings-health.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { assessRankingsHealth, isoYearWeek, weekToDate } from '@/lib/rankings-health'

// Reference anchors (computed with the worker's isoYearWeek):
//   2026-06-08 (Mon) → ISO 2026-W24
//   2026-06-10 (Wed) → ISO 2026-W24
//   2026-06-01 (Mon) → ISO 2026-W23
const FULL = { official_men: 1000, official_women: 1000, race_men: 137, race_women: 130 }

describe('isoYearWeek (mirrors worker)', () => {
  it('maps known dates to ISO weeks', () => {
    expect(isoYearWeek(new Date('2026-06-08T09:00:00Z'))).toEqual({ year: 2026, week: 24 })
    expect(isoYearWeek(new Date('2026-06-01T00:00:00Z'))).toEqual({ year: 2026, week: 23 })
  })
})

describe('weekToDate (mirrors worker)', () => {
  it('returns ISO Mondays', () => {
    expect(weekToDate(2026, 24)).toBe('2026-06-08')
    expect(weekToDate(2026, 23)).toBe('2026-06-01')
  })
})

describe('assessRankingsHealth', () => {
  it('unknown when no snapshots', () => {
    const r = assessRankingsHealth({
      now: new Date('2026-06-10T09:00:00Z'),
      latestYear: null, latestWeek: null, latestRankingDate: null,
      maxCapturedAt: null, buckets: { official_men: 0, official_women: 0, race_men: 0, race_women: 0 },
    })
    expect(r.status).toBe('unknown')
  })

  it('error when last capture older than 9 days', () => {
    const r = assessRankingsHealth({
      now: new Date('2026-06-10T09:00:00Z'),
      latestYear: 2026, latestWeek: 24, latestRankingDate: '2026-06-08',
      maxCapturedAt: '2026-05-30T09:00:00Z', // 11 days
      buckets: FULL,
    })
    expect(r.status).toBe('error')
    expect(r.error_message).toMatch(/worker may be down/)
  })

  it('ok when current ISO week captured with all buckets', () => {
    const r = assessRankingsHealth({
      now: new Date('2026-06-10T09:00:00Z'), // W24
      latestYear: 2026, latestWeek: 24, latestRankingDate: '2026-06-08',
      maxCapturedAt: '2026-06-08T08:00:00Z',
      buckets: FULL,
    })
    expect(r.status).toBe('ok')
    expect(r.meta.weeks_behind).toBe(0)
    expect(r.meta.latest_week).toBe('2026-W24')
    expect(r.meta.current_week).toBe('2026-W24')
  })

  it('partial when current week captured but a bucket is empty', () => {
    const r = assessRankingsHealth({
      now: new Date('2026-06-10T09:00:00Z'),
      latestYear: 2026, latestWeek: 24, latestRankingDate: '2026-06-08',
      maxCapturedAt: '2026-06-08T08:00:00Z',
      buckets: { ...FULL, race_women: 0 },
    })
    expect(r.status).toBe('partial')
    expect(r.error_message).toMatch(/race_women/)
  })

  it('partial (grace) when one week behind on a Monday', () => {
    const r = assessRankingsHealth({
      now: new Date('2026-06-08T09:00:00Z'), // Mon, W24
      latestYear: 2026, latestWeek: 23, latestRankingDate: '2026-06-01',
      maxCapturedAt: '2026-06-08T08:00:00Z',
      buckets: FULL,
    })
    expect(r.status).toBe('partial')
    expect(r.meta.weeks_behind).toBe(1)
    expect(r.error_message).toMatch(/Awaiting current week/)
  })

  it('error when one week behind mid-week (Wednesday)', () => {
    const r = assessRankingsHealth({
      now: new Date('2026-06-10T09:00:00Z'), // Wed, W24
      latestYear: 2026, latestWeek: 23, latestRankingDate: '2026-06-01',
      maxCapturedAt: '2026-06-08T08:00:00Z',
      buckets: FULL,
    })
    expect(r.status).toBe('error')
    expect(r.error_message).toMatch(/not captured/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/ops && npx vitest run src/lib/__tests__/rankings-health.test.ts`
Expected: FAIL — cannot resolve `@/lib/rankings-health`.

- [ ] **Step 3: Write the implementation**

Create `apps/ops/src/lib/rankings-health.ts`:

```ts
// apps/ops/src/lib/rankings-health.ts
// Pure health verdict for the FIP rankings integration (padelgod player-rankings
// worker). Derives status from player_ranking_snapshots freshness — did the
// current ISO week get captured? No DB / no I/O here; the route supplies inputs.
//
// isoYearWeek + weekToDate are copied byte-for-byte from
// padelgod/src/workers/player-rankings.ts so "current week" matches whatever the
// worker would store today. The snapshot (year, week) is the canonical key;
// ranking_date has mixed provenance and is display-only.

export interface RankingsBuckets {
  official_men: number
  official_women: number
  race_men: number
  race_women: number
}

export interface RankingsHealthInput {
  now: Date
  latestYear: number | null
  latestWeek: number | null
  latestRankingDate: string | null
  maxCapturedAt: string | null
  buckets: RankingsBuckets
}

export interface RankingsHealthResult {
  status: 'ok' | 'partial' | 'error' | 'unknown'
  started_at: string | null
  meta: Record<string, unknown>
  error_message: string | null
}

// ── Mirrored from padelgod player-rankings.ts (keep in sync) ──────────────
export function isoYearWeek(d: Date): { year: number; week: number } {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - dayNum + 3)
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const diff = (date.getTime() - firstThursday.getTime()) / 86400000
  const week = 1 + Math.round((diff - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
  return { year: date.getUTCFullYear(), week }
}

export function weekToDate(year: number, week: number): string {
  const jan1 = new Date(Date.UTC(year, 0, 1))
  const jan1Day = jan1.getUTCDay()
  const dayOffset = (week - 1) * 7 - jan1Day + 1
  const monday = new Date(Date.UTC(year, 0, 1 + dayOffset))
  return monday.toISOString().slice(0, 10)
}

// ── Helpers ───────────────────────────────────────────────────────────────
function weekLabel(year: number, week: number): string {
  return `${year}-W${String(week).padStart(2, '0')}`
}

const DAY_MS = 86400000

// ── Verdict ─────────────────────────────────────────────────────────────────
export function assessRankingsHealth(input: RankingsHealthInput): RankingsHealthResult {
  const { now, latestYear, latestWeek, latestRankingDate, maxCapturedAt, buckets } = input

  const current = isoYearWeek(now)
  const currentLabel = weekLabel(current.year, current.week)

  const base = {
    started_at: maxCapturedAt,
    meta: {
      latest_week: latestYear != null && latestWeek != null ? weekLabel(latestYear, latestWeek) : null,
      current_week: currentLabel,
      weeks_behind: null as number | null,
      ranking_date: latestRankingDate,
      last_capture: maxCapturedAt,
      official_men: buckets.official_men,
      official_women: buckets.official_women,
      race_men: buckets.race_men,
      race_women: buckets.race_women,
    } as Record<string, unknown>,
  }

  // Rule 1: no data
  if (latestYear == null || latestWeek == null || maxCapturedAt == null) {
    return { status: 'unknown', ...base, error_message: 'No ranking snapshots found' }
  }

  // Rule 2: dead worker
  const captureAgeDays = (now.getTime() - new Date(maxCapturedAt).getTime()) / DAY_MS
  if (captureAgeDays > 9) {
    return {
      status: 'error',
      ...base,
      error_message: `No ranking snapshot in ${Math.floor(captureAgeDays)} days — worker may be down`,
    }
  }

  const weeksBehind = Math.max(
    0,
    Math.round(
      (new Date(weekToDate(current.year, current.week)).getTime() -
        new Date(weekToDate(latestYear, latestWeek)).getTime()) /
        (7 * DAY_MS),
    ),
  )
  base.meta.weeks_behind = weeksBehind

  // Rule 3: current week captured
  if (weeksBehind <= 0) {
    const missing = (
      [
        ['official_men', buckets.official_men],
        ['official_women', buckets.official_women],
        ['race_men', buckets.race_men],
        ['race_women', buckets.race_women],
      ] as const
    )
      .filter(([, n]) => n === 0)
      .map(([name]) => name)

    if (missing.length > 0) {
      return {
        status: 'partial',
        ...base,
        error_message: `Current week captured but missing: ${missing.join(', ')}`,
      }
    }
    return { status: 'ok', ...base, error_message: null }
  }

  // Rule 4: one week behind, early in the week → grace
  const dow = ((now.getUTCDay() + 6) % 7) + 1 // 1 = Mon … 7 = Sun
  if (weeksBehind === 1 && dow <= 2) {
    return {
      status: 'partial',
      ...base,
      error_message: 'Awaiting current week — FIP usually publishes Monday',
    }
  }

  // Rule 5: behind and past the grace window
  const latestLabel = weekLabel(latestYear, latestWeek)
  const daysIntoWeek = dow - 1
  return {
    status: 'error',
    ...base,
    error_message: `Current ISO week ${currentLabel} not captured — latest is ${latestLabel}, ${daysIntoWeek} day(s) into the week`,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/ops && npx vitest run src/lib/__tests__/rankings-health.test.ts`
Expected: PASS — all cases green. If `isoYearWeek`/`weekToDate` assertions fail, the mirrored math diverged from the worker; re-copy from `padelgod/src/workers/player-rankings.ts:97-125`.

- [ ] **Step 5: Commit**

```bash
git add apps/ops/src/lib/rankings-health.ts apps/ops/src/lib/__tests__/rankings-health.test.ts
git commit -m "feat(ops): pure assessRankingsHealth verdict for rankings freshness"
```

---

## Task 2: `fetchRankingsHealth` in the ops-status route

**Files:**
- Modify: `apps/ops/src/app/api/internal/ops-status/route.ts`

Context anchors (current code):
- `Promise.all([...])` destructure at lines 21-29.
- `fetchHealth` `sources` array at lines 47-51 (contains `'cron:rankings'`).
- `import { serviceClient } from '@/lib/supabase'` at line 8.

- [ ] **Step 1: Add the import**

At the top of the file, after the existing `import { serviceClient } from '@/lib/supabase'` (line 8), add:

```ts
import { assessRankingsHealth } from '@/lib/rankings-health'
```

- [ ] **Step 2: Remove `cron:rankings` from the ops_events sources list**

In `fetchHealth`, change the `sources` array (lines 47-51) from:

```ts
  const sources = [
    'cron:scores', 'cron:sync', 'cron:sync-matches',
    'cron:rankings', 'cron:articles', 'cron:highlights',
    'cron:fip-tournaments', 'cron:fip-scores',
  ]
```

to (drop `'cron:rankings'` — it now comes from `fetchRankingsHealth`):

```ts
  const sources = [
    'cron:scores', 'cron:sync', 'cron:sync-matches',
    'cron:articles', 'cron:highlights',
    'cron:fip-tournaments', 'cron:fip-scores',
  ]
```

- [ ] **Step 3: Add the `fetchRankingsHealth` function**

Immediately after the `fetchHealth` function (after its closing `}` at line 68), add. The latest-week query must resolve before the four bucket counts (they filter on `latest.year`/`latest.week`), so the bucket counts run in their own `Promise.all` after:

```ts
// ── Rankings: data-freshness derived (padelgod player-rankings worker) ──────
// The worker runs on Railway and does NOT write ops_events, so we read the data
// it produces (player_ranking_snapshots) and synthesize a HealthEntry.

async function fetchRankingsHealth(supabase: ReturnType<typeof serviceClient>) {
  const empty = { status: 'unknown', started_at: null, duration_ms: null, meta: null, error_message: null }
  try {
    const [latestRes, capturedRes] = await Promise.all([
      supabase
        .from('player_ranking_snapshots')
        .select('year, week, ranking_date')
        .order('year', { ascending: false })
        .order('week', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('player_ranking_snapshots')
        .select('captured_at')
        .order('captured_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const latest = latestRes.data
    const maxCapturedAt = capturedRes.data?.captured_at ?? null

    let buckets = { official_men: 0, official_women: 0, race_men: 0, race_women: 0 }
    if (latest) {
      const countBucket = (type: string, gender: string) =>
        supabase
          .from('player_ranking_snapshots')
          .select('player_id', { count: 'exact', head: true })
          .eq('year', latest.year)
          .eq('week', latest.week)
          .eq('type', type)
          .eq('gender', gender)

      const [omc, owc, rmc, rwc] = await Promise.all([
        countBucket('official', 'men'),
        countBucket('official', 'women'),
        countBucket('race', 'men'),
        countBucket('race', 'women'),
      ])
      buckets = {
        official_men: omc.count ?? 0,
        official_women: owc.count ?? 0,
        race_men: rmc.count ?? 0,
        race_women: rwc.count ?? 0,
      }
    }

    const verdict = assessRankingsHealth({
      now: new Date(),
      latestYear: latest?.year ?? null,
      latestWeek: latest?.week ?? null,
      latestRankingDate: latest?.ranking_date ?? null,
      maxCapturedAt,
      buckets,
    })

    return {
      status: verdict.status,
      started_at: verdict.started_at,
      duration_ms: null,
      meta: verdict.meta,
      error_message: verdict.error_message,
    }
  } catch (err) {
    return { ...empty, error_message: err instanceof Error ? err.message : 'rankings health query failed' }
  }
}
```

- [ ] **Step 4: Wire it into the route's `Promise.all` and merge into `health`**

Change the destructure + `Promise.all` (lines 21-29) from:

```ts
  const [health, freshness, quality, recentEvents, relay, ongoing, cronStats] = await Promise.all([
    fetchHealth(supabase),
    fetchFreshness(supabase),
    fetchQuality(supabase),
    fetchRecentEvents(supabase),
    fetchRelayStatus(),
    fetchOngoing(supabase),
    fetchCronStats(supabase),
  ])
```

to:

```ts
  const [health, freshness, quality, recentEvents, relay, ongoing, cronStats, rankingsHealth] = await Promise.all([
    fetchHealth(supabase),
    fetchFreshness(supabase),
    fetchQuality(supabase),
    fetchRecentEvents(supabase),
    fetchRelayStatus(),
    fetchOngoing(supabase),
    fetchCronStats(supabase),
    fetchRankingsHealth(supabase),
  ])

  ;(health as Record<string, unknown>)['cron:rankings'] = rankingsHealth
```

- [ ] **Step 5: Typecheck + lint the route**

Run: `cd apps/ops && npx tsc --noEmit && npm run lint`
Expected: no type errors; lint passes for the route file (pre-existing warnings elsewhere are acceptable, but no new errors in `route.ts`).

- [ ] **Step 6: Commit**

```bash
git add apps/ops/src/app/api/internal/ops-status/route.ts
git commit -m "feat(ops): wire fetchRankingsHealth into ops-status route"
```

---

## Task 3: Relabel the tile + metaSummary

**Files:**
- Modify: `apps/ops/src/app/(app)/system/_shared/ops-status-types.ts`

Context anchors:
- `TILES` `cron:rankings` entry at line 89.
- `metaSummary` `case 'cron:rankings'` at line 150.

- [ ] **Step 1: Relabel the tile**

Change line 89 from:

```ts
  { key: 'cron:rankings', label: 'Rankings', schedule: 'Daily 5am UTC', description: 'Fetches FIP official and race rankings (top 1000, men & women) from the FIP website' },
```

to:

```ts
  { key: 'cron:rankings', label: 'FIP Rankings', schedule: 'padelgod · Mon 06–12h + Tue–Sat 07h UTC', description: 'padelgod player-rankings worker → player_ranking_snapshots. Health = data freshness: is the current ISO week captured (official + race × men/women)?' },
```

- [ ] **Step 2: Update the metaSummary case**

Change line 150 from:

```ts
    case 'cron:rankings': return `Official: ${(meta.official as number) ?? 0} · Race: ${(meta.race as number) ?? 0}`
```

to (reads the new freshness meta; shows a warning form when behind):

```ts
    case 'cron:rankings': {
      const latest = (meta.latest_week as string) ?? '—'
      const current = (meta.current_week as string) ?? '—'
      const behind = (meta.weeks_behind as number) ?? 0
      if (behind > 0) return `⚠ latest ${latest} · current ${current}`
      const om = (meta.official_men as number) ?? 0
      const ow = (meta.official_women as number) ?? 0
      const rm = (meta.race_men as number) ?? 0
      const rw = (meta.race_women as number) ?? 0
      return `${latest} · Off ${om}/${ow} · Race ${rm}/${rw}`
    }
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/ops && npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/ops/src/app/(app)/system/_shared/ops-status-types.ts"
git commit -m "feat(ops): relabel rankings tile + freshness metaSummary"
```

---

## Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the new unit suite + a sanity sweep**

Run: `cd apps/ops && npx vitest run src/lib/__tests__/rankings-health.test.ts`
Expected: PASS.

- [ ] **Step 2: Typecheck the whole apps/ops package**

Run: `cd apps/ops && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual dashboard check (preview)**

Start apps/ops dev server (port per its own config) and load the Integration Health tab (`/system/integration-health`). Confirm the **FIP Rankings** tile renders. Given today's real data (latest `2026-W23`, current ISO `2026-W24`), expect: **partial/yellow on Mon–Tue** ("Awaiting current week — FIP usually publishes Monday") or **error/red from Wed**. Cross-check the `latest_week` and bucket numbers against a direct DB query:

```sql
select type, gender, year, week, count(*)
from player_ranking_snapshots
where (year, week) = (select year, week from player_ranking_snapshots order by year desc, week desc limit 1)
group by type, gender, year, week order by type, gender;
```

The tile's `Off m/w · Race m/w` must match these counts.

> If the apps/ops dev server isn't trivially runnable in this environment, the
> unit tests + typecheck are the gate; note the manual check as pending for the
> operator.

- [ ] **Step 4: Final commit (if any verification fixups were needed)**

```bash
git add -A && git commit -m "test(ops): verify rankings health tile" || echo "nothing to commit"
```

---

## Self-Review notes (already reconciled)

- **Spec coverage:** Component 1 → Task 1; Component 2 → Task 2; Component 3 → Task 3; testing → Tasks 1 & 4. `fetchCronStats` left as-is (documented in spec). ✅
- **Type consistency:** `assessRankingsHealth` / `RankingsHealthInput` / `RankingsBuckets` field names (`official_men`, `official_women`, `race_men`, `race_women`, `latestYear`, `latestWeek`, `latestRankingDate`, `maxCapturedAt`) are identical across the module, the route caller, and the tests. The synthesized entry shape (`status`, `started_at`, `duration_ms`, `meta`, `error_message`) matches the `HealthEntry` shape the other `fetchHealth` entries return. ✅
- **No placeholders:** every code step is complete; each shows the full code to write. ✅

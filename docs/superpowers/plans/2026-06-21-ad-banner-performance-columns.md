# Ad Banner Performance Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show all-time impressions, clicks, and CTR per banner as inline columns on the ops Ads tab.

**Architecture:** A read-only Postgres view (`ad_banner_stats`) pre-aggregates impressions and clicks per banner id. The existing ops list endpoint (`GET /api/internal/ad-banners`) reads the view alongside the banner rows and merges the counts in. `AdsTab.tsx` renders three new right-aligned columns. CTR is derived in the UI. A small pure lib (`ad-banner-stats.ts`) holds the merge + formatting logic so it is unit-testable without Supabase or the DOM.

**Tech Stack:** Next.js 16 (ops app under `apps/ops`), Supabase (Postgres + supabase-js service client), Vitest, TypeScript.

---

## File Structure

- **Create** `supabase/migrations/20260621000000_ad_banner_stats_view.sql` — the aggregation view.
- **Create** `apps/ops/src/lib/ad-banner-stats.ts` — pure helpers: `mergeBannerStats`, `formatCount`, `formatCtr`, plus the `BannerStatRow` type.
- **Create** `apps/ops/tests/ad-banner-stats.test.ts` — unit tests for the three helpers.
- **Modify** `apps/ops/src/app/api/internal/ad-banners/route.ts` — extend `GET` only to merge stats.
- **Modify** `apps/ops/src/app/(app)/ads/_components/AdsTab.tsx` — add `impressions`/`clicks` to the `Banner` interface and three columns to the table.

Migrations are applied via `node scripts/apply-migration.mjs <file>` (reads `DATABASE_URL` from `.env.local`), **not** `supabase db push`.

---

## Task 1: Aggregation view

**Files:**
- Create: `supabase/migrations/20260621000000_ad_banner_stats_view.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260621000000_ad_banner_stats_view.sql
-- All-time per-banner engagement totals for the ops Ads tab.
-- impressions: summed from the ad_impressions daily aggregate.
-- clicks: counted from the ad_clicks per-event table.
-- Keyed by ad_banners.id; sponsor_id in both source tables holds that id as text.
-- Read via the service role (ops endpoint), which bypasses RLS on the source tables.

create or replace view ad_banner_stats as
select b.id as banner_id,
       coalesce(i.impressions, 0) as impressions,
       coalesce(c.clicks, 0)      as clicks
from ad_banners b
left join (
  select sponsor_id, sum(count) as impressions
  from ad_impressions group by sponsor_id
) i on i.sponsor_id = b.id::text
left join (
  select sponsor_id, count(*) as clicks
  from ad_clicks group by sponsor_id
) c on c.sponsor_id = b.id::text;
```

- [ ] **Step 2: Apply the migration**

Run: `node scripts/apply-migration.mjs supabase/migrations/20260621000000_ad_banner_stats_view.sql`
Expected: prints `Applied.`

- [ ] **Step 3: Verify the view returns a row per banner**

Run:
```bash
node -e "import('pg').then(async ({default:{Pool}})=>{const fs=await import('node:fs');for(const l of fs.readFileSync('.env.local','utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/i);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^[\"']|[\"']$/g,'')}const u=new URL(process.env.DATABASE_URL);const p=new Pool({host:u.hostname,port:+u.port||5432,database:u.pathname.slice(1),user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),ssl:{rejectUnauthorized:false}});const {rows}=await p.query('select banner_id, impressions, clicks from ad_banner_stats order by impressions desc limit 5');console.log(rows);await p.end()})"
```
Expected: an array of `{ banner_id, impressions, clicks }` rows (at least the seeded `AceProGrip` banner). Counts are numbers/strings ≥ 0, never null.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260621000000_ad_banner_stats_view.sql
git commit -m "feat(ads): ad_banner_stats view for per-banner impressions/clicks"
```

---

## Task 2: Pure helpers (merge + formatting)

**Files:**
- Create: `apps/ops/src/lib/ad-banner-stats.ts`
- Test: `apps/ops/tests/ad-banner-stats.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/ops/tests/ad-banner-stats.test.ts
import { describe, it, expect } from 'vitest'
import { mergeBannerStats, formatCount, formatCtr } from '../src/lib/ad-banner-stats'

describe('formatCount', () => {
  it('adds thousands separators', () => {
    expect(formatCount(1234567)).toBe('1,234,567')
  })
  it('renders zero as 0', () => {
    expect(formatCount(0)).toBe('0')
  })
})

describe('formatCtr', () => {
  it('returns an em dash when there are no impressions', () => {
    expect(formatCtr(0, 0)).toBe('—')
    expect(formatCtr(5, 0)).toBe('—')
  })
  it('formats a percentage with one decimal', () => {
    expect(formatCtr(3, 100)).toBe('3.0%')
  })
  it('rounds to one decimal', () => {
    expect(formatCtr(1, 3)).toBe('33.3%')
  })
})

describe('mergeBannerStats', () => {
  it('merges counts onto banners by id', () => {
    const banners = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]
    const stats = [
      { banner_id: 'a', impressions: 10, clicks: 2 },
      { banner_id: 'b', impressions: 0, clicks: 0 },
    ]
    expect(mergeBannerStats(banners, stats)).toEqual([
      { id: 'a', name: 'A', impressions: 10, clicks: 2 },
      { id: 'b', name: 'B', impressions: 0, clicks: 0 },
    ])
  })
  it('zero-fills banners with no stats row', () => {
    const result = mergeBannerStats([{ id: 'x' }], [])
    expect(result).toEqual([{ id: 'x', impressions: 0, clicks: 0 }])
  })
  it('coerces string counts (pg bigint) to numbers', () => {
    const result = mergeBannerStats(
      [{ id: 'a' }],
      [{ banner_id: 'a', impressions: '42' as unknown as number, clicks: '7' as unknown as number }],
    )
    expect(result[0]).toEqual({ id: 'a', impressions: 42, clicks: 7 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/ops && npx vitest run tests/ad-banner-stats.test.ts`
Expected: FAIL — cannot find module `../src/lib/ad-banner-stats`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/ops/src/lib/ad-banner-stats.ts
// Pure helpers for per-banner engagement stats. No Supabase, no DOM — so the
// merge and the display formatting can be unit-tested in isolation.

export interface BannerStatRow {
  banner_id: string
  impressions: number
  clicks: number
}

export interface WithStats {
  impressions: number
  clicks: number
}

const countFmt = new Intl.NumberFormat('en-US')

/** Whole-number count with thousands separators (e.g. 1,234). */
export function formatCount(n: number): string {
  return countFmt.format(n)
}

/**
 * Click-through rate as a 1-decimal percentage. Returns an em dash when there
 * are no impressions (avoids NaN / Infinity for a banner that never rendered).
 */
export function formatCtr(clicks: number, impressions: number): string {
  if (!impressions) return '—'
  return `${((clicks / impressions) * 100).toFixed(1)}%`
}

/**
 * Attach impressions/clicks to each banner by id, zero-filling banners with no
 * stats row. Counts are coerced to numbers (pg sum()/count() may arrive as
 * strings via the bigint type).
 */
export function mergeBannerStats<T extends { id: string }>(
  banners: T[],
  stats: BannerStatRow[],
): (T & WithStats)[] {
  const byId = new Map(stats.map((s) => [s.banner_id, s]))
  return banners.map((b) => {
    const s = byId.get(b.id)
    return { ...b, impressions: Number(s?.impressions ?? 0), clicks: Number(s?.clicks ?? 0) }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/ops && npx vitest run tests/ad-banner-stats.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/ops/src/lib/ad-banner-stats.ts apps/ops/tests/ad-banner-stats.test.ts
git commit -m "feat(ads): pure helpers for merging + formatting banner stats"
```

---

## Task 3: Extend the GET endpoint to merge stats

**Files:**
- Modify: `apps/ops/src/app/api/internal/ad-banners/route.ts` (the `GET` function only)

- [ ] **Step 1: Add the import**

At the top of the file, after the existing imports, add:

```ts
import { mergeBannerStats, type BannerStatRow } from '@/lib/ad-banner-stats'
```

- [ ] **Step 2: Replace the GET function**

Replace the existing `GET` (currently selects `ad_banners` and returns `{ banners: data ?? [] }`) with:

```ts
export async function GET() {
  const deny = await requireOperator()
  if (deny) return deny
  const supabase = serviceClient()
  const [{ data, error }, { data: stats }] = await Promise.all([
    supabase.from('ad_banners').select(COLS).order('created_at', { ascending: false }),
    supabase.from('ad_banner_stats').select('banner_id, impressions, clicks'),
  ])
  if (error) return Response.json({ error: error.message }, { status: 500 })
  const banners = mergeBannerStats(data ?? [], (stats ?? []) as BannerStatRow[])
  return Response.json({ banners })
}
```

Leave `POST`, `PATCH`, `DELETE`, `COLS`, and the validators untouched.

- [ ] **Step 3: Verify the ops app type-checks / builds**

Run: `cd apps/ops && npx tsc --noEmit`
Expected: no errors (exit 0). If `tsc` is not configured standalone, run `cd apps/ops && npm run build` and expect it to compile the route without type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/ops/src/app/api/internal/ad-banners/route.ts
git commit -m "feat(ads): merge ad_banner_stats into ops banner list response"
```

---

## Task 4: Render the columns in AdsTab

**Files:**
- Modify: `apps/ops/src/app/(app)/ads/_components/AdsTab.tsx`

- [ ] **Step 1: Extend the Banner interface**

In the `Banner` interface (currently ends with `weight: number`), add two fields:

```ts
interface Banner {
  id: string
  name: string
  country_codes: string[]
  slot: string
  image_url: string
  click_url: string
  active: boolean
  weight: number
  impressions: number
  clicks: number
}
```

`Draft` is `Omit<Banner, 'id'>` and `EMPTY` is used for new/edited drafts that get sent to the API, which ignores unknown fields — but to keep the draft type honest, also add the two fields to `EMPTY`:

```ts
const EMPTY: Draft = {
  name: '', country_codes: [], slot: 'sticky-bottom',
  image_url: '', click_url: '', active: true, weight: 1,
  impressions: 0, clicks: 0,
}
```

- [ ] **Step 2: Add the import**

Add to the imports at the top of the file:

```ts
import { formatCount, formatCtr } from '@/lib/ad-banner-stats'
```

- [ ] **Step 3: Add the three header cells**

In the table `<thead>`, replace the header row so the new columns sit before Actions:

```tsx
<tr>
  <th>Preview</th>
  <th>Name</th>
  <th>Countries</th>
  <th>Status</th>
  <th>Weight</th>
  <th style={{ textAlign: 'right' }}>Impressions</th>
  <th style={{ textAlign: 'right' }}>Clicks</th>
  <th style={{ textAlign: 'right' }}>CTR</th>
  <th style={{ textAlign: 'right' }}>Actions</th>
</tr>
```

- [ ] **Step 4: Add the three body cells**

In the `<tbody>` row, add the three `<td>` cells immediately after the Weight cell (`<td>{b.weight}</td>`) and before the Actions cell:

```tsx
<td>{b.weight}</td>
<td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatCount(b.impressions)}</td>
<td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatCount(b.clicks)}</td>
<td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatCtr(b.clicks, b.impressions)}</td>
```

- [ ] **Step 5: Verify the ops app builds**

Run: `cd apps/ops && npm run build`
Expected: build succeeds, no type errors for `AdsTab.tsx`.

- [ ] **Step 6: Manual verification**

Run the ops app, open the Ads tab. Expected: the banners table now shows Impressions, Clicks, and CTR columns. The seeded `AceProGrip` row shows its counts (numbers with separators), and CTR shows `—` if it has zero impressions, otherwise a percentage. Cross-check one banner's numbers against:
```sql
select impressions, clicks from ad_banner_stats where banner_id = '<that banner id>';
```

- [ ] **Step 7: Commit**

```bash
git add "apps/ops/src/app/(app)/ads/_components/AdsTab.tsx"
git commit -m "feat(ads): show impressions/clicks/CTR columns on the Ads tab"
```

---

## Self-Review Notes

- **Spec coverage:** view (Task 1) ✓; endpoint merge (Task 3) ✓; three inline columns all-time (Task 4) ✓; CTR derived in UI with `—` for zero impressions (Task 2 `formatCtr` + Task 4) ✓; unit test of the pure helper (Task 2) ✓; service-role read bypasses RLS (Task 1 comment + Task 3 uses `serviceClient`) ✓; CRUD untouched (Task 3 leaves POST/PATCH/DELETE) ✓.
- **Type consistency:** `BannerStatRow { banner_id, impressions, clicks }` defined in Task 2, imported in Task 3; `mergeBannerStats` / `formatCount` / `formatCtr` names match across tasks; `Banner` gains `impressions`/`clicks` (Task 4) matching what the endpoint returns (Task 3).
- **No placeholders:** every code/SQL/command step is complete.
```

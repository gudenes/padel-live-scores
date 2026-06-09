# Where to Watch — Geo-aware Channel Availability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let operators block a channel's live YouTube stream per country (e.g. FIP/Premier blocked across Latin America where Disney holds rights) so viewers there see the local broadcaster instead of a dead link, with a head-start suggestion engine fed by YouTube's own region data.

**Architecture:** A new `channel_region_rules` table holds operator-authoritative blocks read at runtime by `buildGroups()` (hides blocked live streams; existing country broadcasters surface naturally). A separate suggestion path aggregates YouTube `regionRestriction` over each channel's recent VODs into `youtube_channels.observed_region_blocks` and combines it with broadcaster signals — surfaced only as suggestions in a new admin tab. Russia-style regional channels reuse the existing `broadcasters` table.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase (Postgres), Vitest, the `apps/ops` admin app (next-auth `isOperator`, `/api/internal/*` routes, `.ui-*` design-system primitives).

**Spec:** `docs/superpowers/specs/2026-06-09-where-to-watch-geo-availability-design.md`

---

## File Structure

**New files**
- `supabase/migrations/20260609000000_channel_region_rules.sql` — table + `youtube_channels` columns + LatAm seed
- `src/lib/where-to-watch/regions.ts` — static ISO-3166 region groupings + helpers
- `src/lib/where-to-watch/region-blocks.ts` — pure helpers: `aggregateRegionBlocks`, `computeBlockSuggestions`
- `src/lib/where-to-watch/fetch-channel-region-rules.ts` — runtime fetch of block rules
- `src/lib/__tests__/regions.test.ts`
- `src/lib/__tests__/region-blocks.test.ts`
- `apps/ops/src/app/api/internal/channel-region-rules/route.ts` — GET/POST/DELETE
- `apps/ops/src/app/(app)/yt-channels/_components/AvailabilityTab.tsx` — the new admin tab
- `apps/ops/src/app/(app)/yt-channels/_components/YtChannelsShell.tsx` — tab switcher wrapper

**Modified files**
- `src/lib/where-to-watch/group-builder.ts` — `channelRegionBlocks` input + block guard
- `src/lib/__tests__/group-builder.test.ts` — block-guard tests
- `src/lib/youtube-channel-api.ts` — `contentDetails` part + `regionRestriction` on `VideoDetails`
- `src/app/api/cron/fip-streams-discover/route.ts` — write `observed_region_blocks`
- `src/app/api/cron/youtube-channels-discover/route.ts` — write `observed_region_blocks`
- `src/app/[locale]/match/[id]/page.tsx`, `src/app/[locale]/(app)/matches/[date]/page.tsx`, tournament detail page — fetch + pass rules
- `src/components/where-to-watch/WhereToWatchBanner.tsx`, `WhereToWatchPill.tsx`, `WhereToWatchInline.tsx` — thread the new prop
- `apps/ops/src/app/(app)/yt-channels/page.tsx` — render the shell

---

## Task 1: Migration — table, columns, seed

**Files:**
- Create: `supabase/migrations/20260609000000_channel_region_rules.sql`

> **Apply note:** per repo convention, apply migrations with the pg driver against `DATABASE_URL` (e.g. `psql "$DATABASE_URL" -f <file>`), NOT `supabase db push` (the migration history has drift).

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/20260609000000_channel_region_rules.sql`:

```sql
-- Geo-aware Where-to-Watch: per-channel, per-country live-stream block rules.

CREATE TABLE IF NOT EXISTS channel_region_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id    UUID NOT NULL REFERENCES youtube_channels(id) ON DELETE CASCADE,
  country_iso2  TEXT NOT NULL,
  effect        TEXT NOT NULL DEFAULT 'block' CHECK (effect IN ('block','allow')),
  source        TEXT NOT NULL CHECK (source IN ('seed','yt_api','broadcaster','manual')),
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel_id, country_iso2)
);

CREATE INDEX IF NOT EXISTS channel_region_rules_channel_idx
  ON channel_region_rules(channel_id);

-- Runtime reads this on public pages via the anon key (like `broadcasters`).
ALTER TABLE channel_region_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS channel_region_rules_anon_read ON channel_region_rules;
CREATE POLICY channel_region_rules_anon_read
  ON channel_region_rules FOR SELECT USING (true);

-- Observed signal for the admin suggestion panel (never authoritative).
ALTER TABLE youtube_channels
  ADD COLUMN IF NOT EXISTS observed_region_blocks JSONB,
  ADD COLUMN IF NOT EXISTS observed_at TIMESTAMPTZ;

-- Seed the known Disney / Latin America deal for both circuit channels.
INSERT INTO channel_region_rules (channel_id, country_iso2, effect, source, note)
SELECT c.id, x.cc, 'block', 'seed', 'Disney holds Latin America rights'
FROM youtube_channels c
CROSS JOIN (VALUES
  ('ar'),('bo'),('br'),('cl'),('co'),('cr'),('cu'),('do'),('ec'),('gt'),
  ('hn'),('mx'),('ni'),('pa'),('pe'),('pr'),('py'),('sv'),('uy'),('ve')
) AS x(cc)
WHERE c.abbreviation IN ('FIP','PP')
ON CONFLICT (channel_id, country_iso2) DO NOTHING;
```

- [ ] **Step 2: Apply the migration**

Run: `psql "$DATABASE_URL" -f supabase/migrations/20260609000000_channel_region_rules.sql`
Expected: `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE`, `INSERT 0 N` (N = 40 if both channels exist, 20 if one).

- [ ] **Step 3: Verify rows + columns**

Run: `psql "$DATABASE_URL" -c "SELECT source, count(*) FROM channel_region_rules GROUP BY source; SELECT column_name FROM information_schema.columns WHERE table_name='youtube_channels' AND column_name IN ('observed_region_blocks','observed_at');"`
Expected: a `seed` row with count 20 or 40; both new column names listed.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260609000000_channel_region_rules.sql
git commit -m "feat(wtw): channel_region_rules table + observed columns + LatAm seed"
```

---

## Task 2: Region map module

**Files:**
- Create: `src/lib/where-to-watch/regions.ts`
- Test: `src/lib/__tests__/regions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/regions.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { REGIONS, REGION_NAMES, regionForCountry, countriesForRegion } from '@/lib/where-to-watch/regions'

describe('regions', () => {
  it('lists Latin America with the seeded countries', () => {
    expect(countriesForRegion('Latin America')).toContain('ar')
    expect(countriesForRegion('Latin America')).toContain('br')
    expect(countriesForRegion('Latin America').length).toBeGreaterThanOrEqual(20)
  })

  it('maps a country back to a single canonical region', () => {
    expect(regionForCountry('ar')).toBe('Latin America')
    expect(regionForCountry('es')).toBe('Europe')
    // mx is dual-listed for the picker but resolves to Latin America canonically
    expect(regionForCountry('mx')).toBe('Latin America')
  })

  it('returns null for an unknown country code', () => {
    expect(regionForCountry('zz')).toBeNull()
  })

  it('exposes region names in display order', () => {
    expect(REGION_NAMES[0]).toBe('Latin America')
    expect(REGION_NAMES).toContain('Middle East & North Africa')
    expect(Object.keys(REGIONS)).toEqual(REGION_NAMES)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/regions.test.ts`
Expected: FAIL — cannot resolve `@/lib/where-to-watch/regions`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/where-to-watch/regions.ts`:

```ts
// Static ISO-3166 region groupings for the Where-to-Watch geo-rules admin.
// Used by the "block a whole region" picker and the rules-table region filter.
// Not exhaustive — a pragmatic set covering the markets we operate in.
// `mx` is intentionally listed under both Latin America and North America for
// the picker; the reverse map (`regionForCountry`) resolves it to Latin America.

export const REGIONS = {
  'Latin America': [
    'ar','bo','br','cl','co','cr','cu','do','ec','gt',
    'hn','mx','ni','pa','pe','pr','py','sv','uy','ve',
  ],
  'Europe': [
    'es','it','fr','de','pt','nl','be','gb','ie','se','no','dk','fi',
    'pl','cz','at','ch','gr','ro','hu','ua','rs','hr','bg','sk',
  ],
  'Middle East & North Africa': [
    'ae','sa','qa','kw','bh','om','jo','lb','il','eg','ma','tn','dz',
  ],
  'Asia & Pacific': [
    'jp','cn','kr','in','id','th','vn','ph','my','sg','au','nz','hk','tw',
  ],
  'North America': ['us','ca','mx'],
  'Africa': ['za','ng','ke','gh','sn','ci','cm','ao','mz','tz'],
} as const

export type RegionName = keyof typeof REGIONS

export const REGION_NAMES = Object.keys(REGIONS) as RegionName[]

export function countriesForRegion(region: RegionName): string[] {
  return [...REGIONS[region]]
}

// Reverse lookup. When a country is in more than one region (e.g. `mx`),
// the FIRST region in declaration order wins as canonical.
const COUNTRY_TO_REGION: Record<string, RegionName> = (() => {
  const map: Record<string, RegionName> = {}
  for (const region of REGION_NAMES) {
    for (const cc of REGIONS[region]) {
      if (!(cc in map)) map[cc] = region
    }
  }
  return map
})()

export function regionForCountry(iso2: string): RegionName | null {
  return COUNTRY_TO_REGION[iso2.toLowerCase()] ?? null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/regions.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/where-to-watch/regions.ts src/lib/__tests__/regions.test.ts
git commit -m "feat(wtw): ISO-3166 region groupings module"
```

---

## Task 3: `buildGroups` block guard

**Files:**
- Modify: `src/lib/where-to-watch/group-builder.ts`
- Test: `src/lib/__tests__/group-builder.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/__tests__/group-builder.test.ts` (inside the existing `describe('buildGroups', ...)` block, before its closing `})`):

```ts
  it('hides a blocked channel live stream but keeps its broadcasters', () => {
    const groups = buildGroups({
      liveChannels: [ppLive],
      broadcasters: [movistar],
      todayCircuits: new Set(['PP']),
      country: 'es',
      channelsMeta: [ppChannelMeta],
      channelRegionBlocks: [{ channelId: PP_CHANNEL_ID, countryIso2: 'es' }],
    })
    expect(groups).toHaveLength(1)
    expect(groups[0].hasLive).toBe(false)
    expect(groups[0].liveStreams).toEqual([])
    expect(groups[0].broadcasters).toHaveLength(1)
  })

  it('drops a blocked channel group entirely when it has no broadcaster', () => {
    const groups = buildGroups({
      liveChannels: [fipLive],
      broadcasters: [],
      todayCircuits: new Set(['FIP']),
      country: 'ar',
      channelsMeta: [fipChannelMeta],
      channelRegionBlocks: [{ channelId: FIP_CHANNEL_ID, countryIso2: 'ar' }],
    })
    expect(groups).toEqual([])
  })

  it('does not block when the rule is for a different country', () => {
    const groups = buildGroups({
      liveChannels: [ppLive],
      broadcasters: [],
      todayCircuits: new Set(['PP']),
      country: 'es',
      channelsMeta: [ppChannelMeta],
      channelRegionBlocks: [{ channelId: PP_CHANNEL_ID, countryIso2: 'ar' }],
    })
    expect(groups).toHaveLength(1)
    expect(groups[0].hasLive).toBe(true)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/group-builder.test.ts`
Expected: FAIL — `channelRegionBlocks` not in `BuildGroupsInput`; blocked streams still rendered.

- [ ] **Step 3: Add the input field**

In `src/lib/where-to-watch/group-builder.ts`, add to `BuildGroupsInput` (after `channelsMeta?: ChannelMeta[]`, before the closing `}`):

```ts
  /** Block rules: a channel's live YouTube stream is geo-blocked in these
   *  countries. When the viewer's country matches, the channel's live
   *  streams are dropped (existing broadcasters still surface). Optional —
   *  omit for no geo-blocking. */
  channelRegionBlocks?: Array<{ channelId: string; countryIso2: string }>
```

- [ ] **Step 4: Apply the block guard**

In `src/lib/where-to-watch/group-builder.ts`, change the destructure line:

```ts
  const { liveChannels, broadcasters, todayCircuits, country, channelsMeta = [], channelRegionBlocks = [] } = input
```

Then replace the "Index 2: attach live streams" loop:

```ts
  // Index 2: attach live streams — skipping channels blocked in this country.
  const blockedChannelIds = new Set(
    channelRegionBlocks.filter(r => r.countryIso2 === country).map(r => r.channelId),
  )
  for (const lc of liveChannels) {
    if (blockedChannelIds.has(lc.channel.id)) continue
    const g = channelMetaById.get(lc.channel.id)!
    g.hasLive = true
    g.liveStreams.push({ videoId: lc.videoId, title: lc.title })
  }
```

> Note: blocked channels are still seeded into `channelMetaById` by the existing "Index 1" loop, so a blocked-but-has-broadcaster group renders correctly; the existing empty-group drop removes blocked-with-no-content groups.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/group-builder.test.ts`
Expected: PASS (all existing + 3 new tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/where-to-watch/group-builder.ts src/lib/__tests__/group-builder.test.ts
git commit -m "feat(wtw): buildGroups hides geo-blocked channel live streams"
```

---

## Task 4: Aggregation + suggestion helpers

**Files:**
- Create: `src/lib/where-to-watch/region-blocks.ts`
- Test: `src/lib/__tests__/region-blocks.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/region-blocks.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { aggregateRegionBlocks, computeBlockSuggestions } from '@/lib/where-to-watch/region-blocks'

describe('aggregateRegionBlocks', () => {
  it('counts only videos that carry a blocked list', () => {
    const obs = aggregateRegionBlocks([
      { regionRestriction: { blocked: ['ar', 'br'] } },
      { regionRestriction: { blocked: ['ar'] } },
      {},                                  // no restriction → not sampled
      { regionRestriction: { allowed: ['es'] } }, // allow-only → not sampled
    ])
    expect(obs.sampleSize).toBe(2)
    expect(obs.blocked).toEqual({ ar: 2, br: 1 })
  })

  it('returns an empty observation for no input', () => {
    expect(aggregateRegionBlocks([])).toEqual({ sampleSize: 0, blocked: {} })
  })
})

describe('computeBlockSuggestions', () => {
  it('suggests countries blocked in >= threshold of samples', () => {
    const out = computeBlockSuggestions({
      observed: { sampleSize: 50, blocked: { cl: 47, mx: 3 } },
      broadcasterCountries: [],
      alreadyBlocked: [],
    })
    expect(out.map(s => s.country)).toEqual(['cl'])
    expect(out[0].reasons).toContain('yt_api')
    expect(out[0].ytBlockedCount).toBe(47)
    expect(out[0].ytSampleSize).toBe(50)
  })

  it('suggests countries that have an exclusive broadcaster', () => {
    const out = computeBlockSuggestions({
      observed: null,
      broadcasterCountries: ['co'],
      alreadyBlocked: [],
    })
    expect(out.map(s => s.country)).toEqual(['co'])
    expect(out[0].reasons).toEqual(['broadcaster'])
  })

  it('excludes already-blocked countries and ignores tiny samples', () => {
    const out = computeBlockSuggestions({
      observed: { sampleSize: 4, blocked: { pe: 4 } }, // sample < minSample
      broadcasterCountries: ['ar'],
      alreadyBlocked: ['ar'],
    })
    expect(out).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/region-blocks.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/where-to-watch/region-blocks.ts`:

```ts
// Pure helpers for the geo-rules suggestion path. No I/O.

export interface RegionBlockObservation {
  sampleSize: number
  blocked: Record<string, number>
}

/** Aggregate YouTube `regionRestriction.blocked` over a channel's recent
 *  videos. Only videos that carry a `blocked` list count toward sampleSize. */
export function aggregateRegionBlocks(
  videos: Array<{ regionRestriction?: { blocked?: string[]; allowed?: string[] } }>,
): RegionBlockObservation {
  let sampleSize = 0
  const blocked: Record<string, number> = {}
  for (const v of videos) {
    const list = v.regionRestriction?.blocked
    if (!list || list.length === 0) continue
    sampleSize++
    for (const cc of list) {
      const k = cc.toLowerCase()
      blocked[k] = (blocked[k] ?? 0) + 1
    }
  }
  return { sampleSize, blocked }
}

export interface BlockSuggestion {
  country: string
  reasons: Array<'yt_api' | 'broadcaster'>
  ytBlockedCount?: number
  ytSampleSize?: number
}

export interface ComputeSuggestionsArgs {
  observed: RegionBlockObservation | null
  broadcasterCountries: string[]
  alreadyBlocked: string[]
  threshold?: number  // fraction of samples, default 0.6
  minSample?: number  // minimum sampleSize to trust yt_api, default 5
}

/** Combine the YouTube-observed blocks and broadcaster signal into a
 *  de-duplicated suggestion list, excluding already-blocked countries. */
export function computeBlockSuggestions(args: ComputeSuggestionsArgs): BlockSuggestion[] {
  const { observed, broadcasterCountries, alreadyBlocked, threshold = 0.6, minSample = 5 } = args
  const already = new Set(alreadyBlocked.map(c => c.toLowerCase()))
  const byCountry = new Map<string, BlockSuggestion>()

  if (observed && observed.sampleSize >= minSample) {
    for (const [cc, count] of Object.entries(observed.blocked)) {
      if (count / observed.sampleSize < threshold) continue
      byCountry.set(cc, {
        country: cc, reasons: ['yt_api'],
        ytBlockedCount: count, ytSampleSize: observed.sampleSize,
      })
    }
  }

  for (const raw of broadcasterCountries) {
    const cc = raw.toLowerCase()
    const existing = byCountry.get(cc)
    if (existing) {
      if (!existing.reasons.includes('broadcaster')) existing.reasons.push('broadcaster')
    } else {
      byCountry.set(cc, { country: cc, reasons: ['broadcaster'] })
    }
  }

  return [...byCountry.values()]
    .filter(s => !already.has(s.country))
    .sort((a, b) => a.country.localeCompare(b.country))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/region-blocks.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/where-to-watch/region-blocks.ts src/lib/__tests__/region-blocks.test.ts
git commit -m "feat(wtw): region-block aggregation + suggestion helpers"
```

---

## Task 5: Capture `regionRestriction` from YouTube

**Files:**
- Modify: `src/lib/youtube-channel-api.ts`

- [ ] **Step 1: Extend the `VideoDetails` interface**

In `src/lib/youtube-channel-api.ts`, add to the `VideoDetails` interface (after `viewCount: number | null`):

```ts
  regionRestriction: { allowed?: string[]; blocked?: string[] } | null
```

- [ ] **Step 2: Extend the `VideosResponse` shape**

In the `VideosResponse` interface, add a `contentDetails` field to the item shape (after `statistics?: { viewCount?: string }`):

```ts
    contentDetails?: { regionRestriction?: { allowed?: string[]; blocked?: string[] } }
```

- [ ] **Step 3: Add `contentDetails` to both `part` params and map the field**

In `listVideoDetails`, change the `part`:

```ts
    part: 'snippet,liveStreamingDetails,statistics,contentDetails',
```

and add to the returned object (after `viewCount: ...`):

```ts
    regionRestriction: it.contentDetails?.regionRestriction ?? null,
```

Repeat the identical two changes in `fetchVideoDetailsBatch` (it uses `v` not `it`):

```ts
    part: 'snippet,liveStreamingDetails,statistics,contentDetails',
```
```ts
    regionRestriction: v.contentDetails?.regionRestriction ?? null,
```

> `videos.list` costs 1 quota unit regardless of how many parts you request, so adding `contentDetails` is free.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: no new errors referencing `youtube-channel-api.ts`, `VideoDetails`, or `regionRestriction`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/youtube-channel-api.ts
git commit -m "feat(wtw): capture regionRestriction from YouTube videos.list"
```

---

## Task 6: Write `observed_region_blocks` from the discovery crons

**Files:**
- Modify: `src/app/api/cron/fip-streams-discover/route.ts`
- Modify: `src/app/api/cron/youtube-channels-discover/route.ts`

> Context: both crons already enumerate a channel's recent uploads and call the
> `listVideoDetails`/`fetchVideoDetailsBatch` fetcher. We add a post-step that
> aggregates the `regionRestriction` now present on those results and writes it
> to the channel row. Read each file first to find the variable holding the
> fetched `VideoDetails[]` and the channel's `youtube_channels.id`.

- [ ] **Step 1: fip-streams-discover — aggregate + write**

In `src/app/api/cron/fip-streams-discover/route.ts`, add the import near the top:

```ts
import { aggregateRegionBlocks } from '@/lib/where-to-watch/region-blocks'
import { FIP_CHANNEL_ID } from '@/lib/fip-channel'
```

After the point where the full list of fetched `VideoDetails` for the FIP channel is available (the array passed through `videos.list`; name it `videoDetails` if it differs, adapt), add:

```ts
  // Suggestion signal: learn this channel's geo-block footprint from the
  // regionRestriction on recent VODs (live videos often omit it).
  const observed = aggregateRegionBlocks(videoDetails)
  if (observed.sampleSize > 0) {
    const { data: chan } = await supabase
      .from('youtube_channels')
      .select('id')
      .eq('channel_id', FIP_CHANNEL_ID)
      .maybeSingle()
    if (chan?.id) {
      await supabase
        .from('youtube_channels')
        .update({ observed_region_blocks: observed, observed_at: new Date().toISOString() })
        .eq('id', chan.id)
    }
  }
```

- [ ] **Step 2: youtube-channels-discover — aggregate + write per channel**

In `src/app/api/cron/youtube-channels-discover/route.ts`, add the import:

```ts
import { aggregateRegionBlocks } from '@/lib/where-to-watch/region-blocks'
```

Inside the per-channel loop (each iteration has the channel row, including its `youtube_channels.id` — call it `channel.id`, and the fetched `VideoDetails[]` for that channel — call it `details`), after the details are fetched add:

```ts
    const observed = aggregateRegionBlocks(details)
    if (observed.sampleSize > 0) {
      await supabase
        .from('youtube_channels')
        .update({ observed_region_blocks: observed, observed_at: new Date().toISOString() })
        .eq('id', channel.id)
    }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: no new errors in either cron route. If a variable name differs (`videoDetails`/`details`/`supabase`), adjust to the actual local name — the aggregation call shape is unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/fip-streams-discover/route.ts src/app/api/cron/youtube-channels-discover/route.ts
git commit -m "feat(wtw): discovery crons record observed_region_blocks per channel"
```

---

## Task 7: Runtime fetch helper + wire into pages

**Files:**
- Create: `src/lib/where-to-watch/fetch-channel-region-rules.ts`
- Modify: `src/components/where-to-watch/WhereToWatchBanner.tsx`, `WhereToWatchPill.tsx`, `WhereToWatchInline.tsx`
- Modify: `src/app/[locale]/match/[id]/page.tsx`, `src/app/[locale]/(app)/matches/[date]/page.tsx`, tournament detail page

- [ ] **Step 1: Write the fetch helper**

Create `src/lib/where-to-watch/fetch-channel-region-rules.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

export interface ChannelRegionBlock {
  channelId: string
  countryIso2: string
}

/** Fetch all active block rules. Small bounded table (channels × countries),
 *  safe to fetch whole and ship to the client for region swaps. */
export async function fetchChannelRegionBlocks(
  supabase: SupabaseClient,
): Promise<ChannelRegionBlock[]> {
  const { data, error } = await supabase
    .from('channel_region_rules')
    .select('channel_id, country_iso2')
    .eq('effect', 'block')
  if (error || !data) return []
  return data.map(r => ({
    channelId: r.channel_id as string,
    countryIso2: (r.country_iso2 as string).toLowerCase(),
  }))
}
```

- [ ] **Step 2: Add the prop to the three components**

In each of `WhereToWatchBanner.tsx`, `WhereToWatchPill.tsx`, `WhereToWatchInline.tsx`:

1. Add to the component's props type:

```ts
  channelRegionBlocks?: Array<{ channelId: string; countryIso2: string }>
```

2. Destructure it from props (default `[]`):

```ts
  channelRegionBlocks = [],
```

3. Pass it into the `buildGroups({ ... })` call already present in each file:

```ts
    channelRegionBlocks,
```

- [ ] **Step 3: Fetch + pass on the match detail page**

In `src/app/[locale]/match/[id]/page.tsx`, add the import:

```ts
import { fetchChannelRegionBlocks } from '@/lib/where-to-watch/fetch-channel-region-rules'
```

Add a state holder near the other Where-to-Watch state:

```ts
  const [wtwRegionBlocks, setWtwRegionBlocks] = useState<Array<{ channelId: string; countryIso2: string }>>([])
```

In the same effect that runs the parallel `broadcastersP`/`liveChannelsP`/`channelsMetaP` fetches, add a fourth promise and set state:

```ts
    const regionBlocksP = fetchChannelRegionBlocks(supabase)
    // ...after the existing Promise.all / awaits:
    setWtwRegionBlocks(await regionBlocksP)
```

Pass it to both `<WhereToWatchBanner ... />` render sites:

```tsx
    channelRegionBlocks={wtwRegionBlocks}
```

- [ ] **Step 4: Fetch + pass on the matches list and tournament pages**

In `src/app/[locale]/(app)/matches/[date]/page.tsx` (server component): call `await fetchChannelRegionBlocks(supabase)` alongside the existing broadcaster fetch and pass `channelRegionBlocks={...}` to `<WhereToWatchPill ... />`.

In the tournament detail page that renders `<WhereToWatchInline ... />`: same — fetch and pass `channelRegionBlocks={...}`.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: no new errors in the touched files.

- [ ] **Step 6: Commit**

```bash
git add src/lib/where-to-watch/fetch-channel-region-rules.ts src/components/where-to-watch src/app/[locale]
git commit -m "feat(wtw): thread channelRegionBlocks through runtime render paths"
```

---

## Task 8: Ops API route — `channel-region-rules`

**Files:**
- Create: `apps/ops/src/app/api/internal/channel-region-rules/route.ts`

- [ ] **Step 1: Write the route**

Create `apps/ops/src/app/api/internal/channel-region-rules/route.ts`:

```ts
// apps/ops/src/app/api/internal/channel-region-rules/route.ts
//
// GET    ?channelId=  → rules for a channel + suggestion payload + "watch on"
// POST   add block(s) for a channel { channelId, countries[], note? }
// DELETE ?id=         → remove a block
//
// Auth: Auth.js session with isOperator flag.

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import {
  computeBlockSuggestions,
  type RegionBlockObservation,
} from '@/lib/where-to-watch/region-blocks'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const channelId = request.nextUrl.searchParams.get('channelId')
  if (!channelId) return NextResponse.json({ error: 'channelId required' }, { status: 400 })

  const supabase = serviceClient()

  const [{ data: rules }, { data: chan }, { data: bcasts }] = await Promise.all([
    supabase.from('channel_region_rules')
      .select('id, country_iso2, effect, source, note, created_at')
      .eq('channel_id', channelId).eq('effect', 'block')
      .order('country_iso2'),
    supabase.from('youtube_channels')
      .select('observed_region_blocks, observed_at').eq('id', channelId).maybeSingle(),
    supabase.from('broadcasters')
      .select('country_iso2, name, is_free')
      .eq('channel_id', channelId).eq('active', true),
  ])

  const blockedCountries = (rules ?? []).map(r => r.country_iso2 as string)

  // "Viewers here watch on" — broadcasters per blocked country.
  const watchOn: Record<string, string[]> = {}
  const broadcasterCountries = new Set<string>()
  for (const b of bcasts ?? []) {
    const cc = (b.country_iso2 as string).toLowerCase()
    broadcasterCountries.add(cc)
    ;(watchOn[cc] ??= []).push(b.name as string)
  }

  const suggestions = computeBlockSuggestions({
    observed: (chan?.observed_region_blocks as RegionBlockObservation | null) ?? null,
    broadcasterCountries: [...broadcasterCountries],
    alreadyBlocked: blockedCountries,
  })

  return NextResponse.json({
    rules: rules ?? [],
    watchOn,
    suggestions,
    observedAt: chan?.observed_at ?? null,
  })
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const body = (await request.json()) as {
    channelId?: string; countries?: string[]; source?: string; note?: string
  }
  if (!body.channelId || !body.countries?.length) {
    return NextResponse.json({ error: 'channelId and countries required' }, { status: 400 })
  }
  const supabase = serviceClient()
  const rows = body.countries.map(cc => ({
    channel_id: body.channelId,
    country_iso2: cc.toLowerCase(),
    effect: 'block',
    source: body.source === 'manual' || body.source === 'yt_api' || body.source === 'broadcaster'
      ? body.source : 'manual',
    note: body.note ?? null,
  }))
  const { error } = await supabase
    .from('channel_region_rules')
    .upsert(rows, { onConflict: 'channel_id,country_iso2', ignoreDuplicates: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, added: rows.length })
}

export async function DELETE(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const supabase = serviceClient()
  const { error } = await supabase.from('channel_region_rules').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
```

> If `@/lib/where-to-watch/region-blocks` does not resolve from `apps/ops` (separate npm package, no path alias to the root `src`), copy `region-blocks.ts` to `apps/ops/src/lib/where-to-watch/region-blocks.ts` and import from there. Verify the alias in Step 2 before assuming.

- [ ] **Step 2: Verify the import alias resolves**

Run: `cd apps/ops && npx tsc --noEmit 2>&1 | grep -i "region-blocks\|channel-region-rules" | head`
Expected: no output (resolves). If it reports "cannot find module", copy `region-blocks.ts` into `apps/ops/src/lib/where-to-watch/` and update the import, then re-run.

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/app/api/internal/channel-region-rules
git commit -m "feat(wtw): ops channel-region-rules API (list/add/remove + suggestions)"
```

---

## Task 9: Ops UI — Availability tab + tab switcher

**Files:**
- Create: `apps/ops/src/app/(app)/yt-channels/_components/AvailabilityTab.tsx`
- Create: `apps/ops/src/app/(app)/yt-channels/_components/YtChannelsShell.tsx`
- Modify: `apps/ops/src/app/(app)/yt-channels/page.tsx`

- [ ] **Step 1: Write the Availability tab component**

Create `apps/ops/src/app/(app)/yt-channels/_components/AvailabilityTab.tsx`:

```tsx
'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader, Button } from '@/components/ui'
import { REGION_NAMES, countriesForRegion, regionForCountry, type RegionName } from '@/lib/where-to-watch/regions'

interface ChannelOpt { id: string; name: string; abbreviation: string }
interface Rule { id: string; country_iso2: string; source: string; note: string | null }
interface Suggestion { country: string; reasons: string[]; ytBlockedCount?: number; ytSampleSize?: number }
interface Payload { rules: Rule[]; watchOn: Record<string, string[]>; suggestions: Suggestion[]; observedAt: string | null }

const SOURCE_LABEL: Record<string, string> = {
  seed: 'Preset', yt_api: 'Detected on YouTube', broadcaster: 'From broadcaster list', manual: 'Added manually',
}

function reasonText(s: Suggestion): string {
  const bits: string[] = []
  if (s.reasons.includes('yt_api') && s.ytSampleSize) {
    bits.push(`YouTube blocked this channel in ${s.ytBlockedCount} of the last ${s.ytSampleSize} recorded matches`)
  }
  if (s.reasons.includes('broadcaster')) bits.push('has a local broadcaster but the stream isn’t blocked yet')
  return bits.join(' · ')
}

export default function AvailabilityTab() {
  const [channels, setChannels] = useState<ChannelOpt[]>([])
  const [channelId, setChannelId] = useState<string | null>(null)
  const [data, setData] = useState<Payload | null>(null)
  const [search, setSearch] = useState('')
  const [regionFilter, setRegionFilter] = useState<'all' | RegionName>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load channel list once.
  useEffect(() => {
    fetch('/api/internal/youtube-channels').then(r => r.json()).then((j: { channels: ChannelOpt[] }) => {
      setChannels(j.channels)
      if (j.channels[0]) setChannelId(j.channels[0].id)
    }).catch(e => setError(String(e)))
  }, [])

  const load = useCallback(async () => {
    if (!channelId) return
    setError(null)
    try {
      const res = await fetch(`/api/internal/channel-region-rules?channelId=${channelId}`)
      if (!res.ok) throw new Error(`load failed: ${res.status}`)
      setData(await res.json() as Payload)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [channelId])

  useEffect(() => { load() }, [load])

  const blockCountries = useCallback(async (countries: string[], source: string) => {
    if (!channelId || countries.length === 0) return
    await fetch('/api/internal/channel-region-rules', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId, countries, source }),
    })
    await load()
  }, [channelId, load])

  const unblock = useCallback(async (id: string) => {
    await fetch(`/api/internal/channel-region-rules?id=${id}`, { method: 'DELETE' })
    await load()
  }, [load])

  const filteredRules = useMemo(() => {
    if (!data) return []
    return data.rules.filter(r => {
      if (search && !r.country_iso2.includes(search.toLowerCase())) return false
      if (regionFilter !== 'all' && regionForCountry(r.country_iso2) !== regionFilter) return false
      return true
    })
  }, [data, search, regionFilter])

  return (
    <div className="ui-page">
      <PageHeader
        title="Availability by Country"
        subtitle="Block a channel’s live YouTube stream where another company owns the rights — viewers there see the local broadcaster instead."
        actions={<Button variant="primary" onClick={() => setDialogOpen(true)} disabled={!channelId}>+ Block more countries</Button>}
      />

      {error && <div style={{ color: 'var(--live-text)', fontSize: 13, marginBottom: 12 }}>Error: {error}</div>}

      {/* channel selector */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 18 }}>
        <span className="ui-section-label">Channel</span>
        {channels.map(c => (
          <button key={c.id} className="ui-chip" data-on={c.id === channelId} onClick={() => setChannelId(c.id)}>{c.name}</button>
        ))}
      </div>

      {/* suggestions */}
      {data && data.suggestions.length > 0 && (
        <div className="ui-panel" style={{ borderColor: 'var(--orange-border)', background: 'var(--orange-bg)', marginBottom: 22 }}>
          <div className="ui-panel-pad">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <strong style={{ fontSize: 13 }}>We found {data.suggestions.length} countries that may need to be blocked</strong>
              <Button size="sm" variant="primary" onClick={() => blockCountries(data.suggestions.map(s => s.country), 'yt_api')}>
                Block all {data.suggestions.length}
              </Button>
            </div>
            {data.suggestions.map(s => (
              <div key={s.country} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderTop: '1px solid var(--border-inner)', fontSize: 13 }}>
                <span><strong>{s.country.toUpperCase()}</strong> — <span style={{ color: 'var(--text-2)' }}>{reasonText(s)}</span></span>
                <Button size="sm" onClick={() => blockCountries([s.country], s.reasons.includes('yt_api') ? 'yt_api' : 'broadcaster')}>
                  Block {s.country.toUpperCase()}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <input className="ui-input" placeholder="Search blocked countries…" style={{ flex: 1 }} value={search} onChange={e => setSearch(e.target.value)} />
        <select className="ui-select" style={{ width: 200 }} value={regionFilter} onChange={e => setRegionFilter(e.target.value as 'all' | RegionName)}>
          <option value="all">All regions</option>
          {REGION_NAMES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {/* rules table */}
      <div className="ui-table-wrap">
        <table className="ui-table">
          <thead><tr><th>Country</th><th>How it was added</th><th>Viewers here watch on</th><th>Note</th><th /></tr></thead>
          <tbody>
            {filteredRules.map(r => (
              <tr key={r.id}>
                <td>{r.country_iso2.toUpperCase()}</td>
                <td><span className="ui-pill" data-tone={r.source === 'yt_api' ? 'men' : 'neutral'}>{SOURCE_LABEL[r.source] ?? r.source}</span></td>
                <td style={{ color: 'var(--text-2)' }}>{(data?.watchOn[r.country_iso2] ?? []).join(' · ') || '—'}</td>
                <td style={{ color: 'var(--text-3)' }}>{r.note ?? '—'}</td>
                <td style={{ textAlign: 'right' }}><Button size="sm" variant="ghost" onClick={() => unblock(r.id)}>Unblock</Button></td>
              </tr>
            ))}
            {filteredRules.length === 0 && (
              <tr><td colSpan={5} style={{ color: 'var(--text-3)', padding: 24, textAlign: 'center' }}>No blocked countries.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {dialogOpen && (
        <BlockDialog
          alreadyBlocked={new Set((data?.rules ?? []).map(r => r.country_iso2))}
          onClose={() => setDialogOpen(false)}
          onBlock={async (countries) => { await blockCountries(countries, 'manual'); setDialogOpen(false) }}
        />
      )}
    </div>
  )
}

function BlockDialog(props: {
  alreadyBlocked: Set<string>
  onClose: () => void
  onBlock: (countries: string[]) => void
}) {
  const [region, setRegion] = useState<RegionName>(REGION_NAMES[0])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const countries = countriesForRegion(region).filter(c => !props.alreadyBlocked.has(c))

  const toggle = (cc: string) => setPicked(p => {
    const next = new Set(p); next.has(cc) ? next.delete(cc) : next.add(cc); return next
  })

  return (
    <div className="ui-cmd-scrim" onClick={props.onClose}>
      <div className="ui-cmd" style={{ padding: 18 }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Block more countries</h3>
        <div className="ui-section-label" style={{ marginBottom: 8 }}>Block an entire region at once</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {REGION_NAMES.map(r => (
            <button key={r} className="ui-chip" data-on={r === region}
              onClick={() => { setRegion(r); setPicked(new Set(countriesForRegion(r).filter(c => !props.alreadyBlocked.has(c)))) }}>
              {r} — {countriesForRegion(r).length}
            </button>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, maxHeight: 220, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
          {countries.map(cc => (
            <label key={cc} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, padding: '5px 7px' }}>
              <input type="checkbox" checked={picked.has(cc)} onChange={() => toggle(cc)} /> {cc.toUpperCase()}
            </label>
          ))}
          {countries.length === 0 && <span style={{ color: 'var(--text-3)', fontSize: 13 }}>All countries in this region are already blocked.</span>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{picked.size} selected</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" onClick={props.onClose}>Cancel</Button>
            <Button variant="primary" disabled={picked.size === 0} onClick={() => props.onBlock([...picked])}>Block {picked.size} countries</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

> If `@/lib/where-to-watch/regions` doesn't resolve from `apps/ops`, copy `regions.ts` into `apps/ops/src/lib/where-to-watch/regions.ts` (same as the region-blocks note in Task 8) and import from there.

- [ ] **Step 2: Write the tab-switcher shell**

Create `apps/ops/src/app/(app)/yt-channels/_components/YtChannelsShell.tsx`:

```tsx
'use client'
import { useState } from 'react'
import YtChannelsTab from './YtChannelsTab'
import AvailabilityTab from './AvailabilityTab'

export default function YtChannelsShell() {
  const [tab, setTab] = useState<'channels' | 'availability'>('channels')
  return (
    <div>
      <div style={{ display: 'flex', gap: 22, padding: '14px 32px 0', borderBottom: '1px solid var(--border)' }}>
        {([['channels', 'Channels'], ['availability', 'Availability by Country']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '9px 2px', fontSize: 14, fontWeight: 600,
            fontFamily: 'var(--font)',
            color: tab === key ? 'var(--lime-text)' : 'var(--text-3)',
            borderBottom: tab === key ? '2px solid var(--lime)' : '2px solid transparent',
          }}>{label}</button>
        ))}
      </div>
      {tab === 'channels' ? <YtChannelsTab /> : <AvailabilityTab />}
    </div>
  )
}
```

- [ ] **Step 3: Point the page at the shell**

Replace `apps/ops/src/app/(app)/yt-channels/page.tsx` body:

```tsx
// apps/ops/src/app/(app)/yt-channels/page.tsx
// YouTube Channels — list/add/edit/delete + per-channel geo availability.

import YtChannelsShell from './_components/YtChannelsShell'

export const metadata = { title: 'YT Channels · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default function YtChannelsPage() {
  return <YtChannelsShell />
}
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/ops && npx tsc --noEmit 2>&1 | grep -i "yt-channels\|AvailabilityTab\|YtChannelsShell" | head`
Expected: no output.

- [ ] **Step 5: Manual verification (operator UI)**

Start the ops app dev server. Sign in as an operator. Navigate to **YT Channels**.
- Confirm two tabs: **Channels** and **Availability by Country**.
- On the Availability tab: select **FIP Tour** → the seeded LatAm countries show with "Preset". Toggle the theme — verify light + dark both read cleanly (no hardcoded colors).
- Click **+ Block more countries** → pick a region → block one country → confirm it appears in the table.
- **Unblock** it → confirm it disappears.
- If `observed_region_blocks` has been populated by a cron run, confirm the suggestions panel renders with the "X of the last Y" copy.

- [ ] **Step 6: Commit**

```bash
git add "apps/ops/src/app/(app)/yt-channels"
git commit -m "feat(wtw): Availability by Country admin tab"
```

---

## Task 10: Full verification sweep

- [ ] **Step 1: Run the where-to-watch unit suite**

Run: `npx vitest run src/lib/__tests__/regions.test.ts src/lib/__tests__/region-blocks.test.ts src/lib/__tests__/group-builder.test.ts`
Expected: all PASS.

- [ ] **Step 2: Lint + typecheck the root app**

Run: `npm run lint && npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: clean (no new errors in touched files).

- [ ] **Step 3: Manual end-to-end (runtime)**

With the main app dev server running, open a match on a Premier/FIP tournament that has a live YouTube stream. Using a `geo-country=ar` cookie (devtools → Application → Cookies, set `geo-country` to `ar`), confirm the "Where to watch" affordance **does not** offer the YouTube live link and instead shows the Latin America broadcaster(s). Switch the cookie to `es` and confirm the YouTube link returns.

- [ ] **Step 4: Final commit (if any fixups)**

```bash
git add -A
git commit -m "test(wtw): verification fixups for geo-aware where-to-watch"
```

---

## Self-Review Notes

- **Spec coverage:** data model (T1), region map (T2), runtime block (T3), suggestion helpers (T4), YouTube capture (T5), cron observation (T6), runtime wiring (T7), ops API (T8), ops UI incl. region search + preview-style "watch on" column (T9), tests throughout + sweep (T10). The preview block from the spec is represented by the read-only "Viewers here watch on" column; a dedicated visual preview card can be added later if the operator wants it (non-blocking).
- **Cross-app imports:** Tasks 8 & 9 flag the `apps/ops` → root `src` alias risk explicitly with a copy-fallback and a verify step.
- **No auto-blocking:** observed data only ever feeds suggestions; authoritative blocks come from `channel_region_rules` written by operator actions or the seed.
```

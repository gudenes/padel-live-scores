# Where-to-Watch SEO implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-rendered crawlable Where-to-Watch info (BroadcastEvent JSON-LD + sr-only sentence) to match + tournament pages so Google can populate its "where to watch" carousel and rank our pages for broadcast-intent queries.

**Architecture:** Three new pure/library modules — a JSON-LD builder, an sr-only summary builder, and a server-side Supabase fetch — invoked from the two existing server-side layouts (`match/[id]/layout.tsx` and `tournaments/[id]/layout.tsx`) which already SSR a `SportsEvent` JSON-LD object. Visible UI is unchanged.

**Tech Stack:** TypeScript, Next.js 16 App Router (server components for layouts), Supabase client, next-intl (5 locales), Vitest for unit tests.

Spec: [`docs/superpowers/specs/2026-05-16-where-to-watch-seo.md`](../specs/2026-05-16-where-to-watch-seo.md).

---

## File structure

**New files:**

```
src/lib/where-to-watch/
  build-broadcast-jsonld.ts        — pure: (channelMeta, liveStreams, broadcasters) → BroadcastEvent[]
  build-seo-summary.ts             — pure: (broadcasters, options) → structured summary data
  fetch-seo-broadcasters.ts        — server query helper

src/lib/__tests__/
  build-broadcast-jsonld.test.ts   — unit tests
  build-seo-summary.test.ts        — unit tests
```

**Modified files:**

```
src/messages/{en,es,pt,it,fr}.json
  — Append one key inside the existing `whereToWatch` block:
    `seo.summary` (ICU template with plural branches)

src/app/[locale]/match/[id]/layout.tsx
  — Add parallel fetchSeoBroadcasters call
  — Inject `publication: buildBroadcastJsonLd(...)` into the SportsEvent JSON-LD object
  — Append the SEO sentence to the existing sr-only header

src/app/[locale]/(app)/tournaments/[id]/layout.tsx
  — Same three changes
```

---

## Task 1: Build `buildBroadcastJsonLd` (TDD)

**Files:**
- Create: `src/lib/__tests__/build-broadcast-jsonld.test.ts`
- Create: `src/lib/where-to-watch/build-broadcast-jsonld.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/__tests__/build-broadcast-jsonld.test.ts
import { describe, it, expect } from 'vitest'
import { buildBroadcastJsonLd, type ChannelMetaForSeo, type LiveStreamForSeo, type BroadcasterForSeo } from '@/lib/where-to-watch/build-broadcast-jsonld'

const ppChannel: ChannelMetaForSeo = {
  id: 'uuid-pp',
  channelId: 'UCK59dYVs3Wgwoe73nDTH6jw',
  name: 'Premier Padel',
  abbreviation: 'PP',
}

const movistar: BroadcasterForSeo = {
  name: 'Movistar Plus+',
  url: 'https://www.movistarplus.es/deportes',
  country_iso2: 'es',
}
const redBullEs: BroadcasterForSeo = {
  name: 'Red Bull TV',
  url: 'https://www.redbull.com/tv',
  country_iso2: 'es',
}
const redBullIt: BroadcasterForSeo = { ...redBullEs, country_iso2: 'it' }

const ppLiveStream: LiveStreamForSeo = {
  videoId: 'vid1',
  title: 'BA P1 — Centre Court',
}

describe('buildBroadcastJsonLd', () => {
  it('returns empty array when channelMeta is null', () => {
    const out = buildBroadcastJsonLd({
      channelMeta: null,
      liveStreams: [],
      broadcasters: [movistar],
    })
    expect(out).toEqual([])
  })

  it('emits a YT BroadcastEvent when channelMeta is provided, even with no live streams', () => {
    const out = buildBroadcastJsonLd({
      channelMeta: ppChannel,
      liveStreams: [],
      broadcasters: [],
    })
    expect(out).toHaveLength(1)
    expect(out[0]['@type']).toBe('BroadcastEvent')
    expect(out[0].isLiveBroadcast).toBe(false)
    expect(out[0].publishedOn['@type']).toBe('BroadcastService')
    expect(out[0].publishedOn.name).toBe('Premier Padel')
    expect(out[0].publishedOn.url).toBe('https://www.youtube.com/channel/UCK59dYVs3Wgwoe73nDTH6jw')
  })

  it('marks the YT entry isLiveBroadcast=true when liveStreams is non-empty', () => {
    const out = buildBroadcastJsonLd({
      channelMeta: ppChannel,
      liveStreams: [ppLiveStream],
      broadcasters: [],
    })
    expect(out[0].isLiveBroadcast).toBe(true)
    expect(out[0].videoFormat).toBe('HD')
  })

  it('appends one BroadcastEvent per broadcaster row with areaServed', () => {
    const out = buildBroadcastJsonLd({
      channelMeta: ppChannel,
      liveStreams: [],
      broadcasters: [movistar, redBullEs, redBullIt],
    })
    // 1 YT + 3 broadcasters
    expect(out).toHaveLength(4)

    const movistarEntry = out[1]
    expect(movistarEntry.publishedOn.name).toBe('Movistar Plus+')
    expect(movistarEntry.publishedOn.url).toBe('https://www.movistarplus.es/deportes')
    expect(movistarEntry.publishedOn.areaServed).toEqual({ '@type': 'Country', name: 'Spain' })
    expect(movistarEntry.isLiveBroadcast).toBe(false)
    expect(movistarEntry.name).toBe('Watch on Movistar Plus+ in Spain')
  })

  it('uses the uppercased ISO when the country code is unknown to the name map', () => {
    const odd: BroadcasterForSeo = { ...movistar, country_iso2: 'zz' }
    const out = buildBroadcastJsonLd({
      channelMeta: ppChannel,
      liveStreams: [],
      broadcasters: [odd],
    })
    expect(out[1].publishedOn.areaServed?.name).toBe('ZZ')
  })

  it('preserves broadcaster order (caller pre-sorts by country, then display_order)', () => {
    const out = buildBroadcastJsonLd({
      channelMeta: ppChannel,
      liveStreams: [],
      broadcasters: [redBullIt, movistar, redBullEs],
    })
    // YT first, then broadcasters in input order
    expect(out.slice(1).map(e => e.publishedOn.name)).toEqual(['Red Bull TV', 'Movistar Plus+', 'Red Bull TV'])
    expect(out.slice(1).map(e => e.publishedOn.areaServed?.name)).toEqual(['Italy', 'Spain', 'Spain'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/GuDenes/Projects/padel-live-scores/.worktrees/wtw-banner && \
  npx vitest run src/lib/__tests__/build-broadcast-jsonld.test.ts
```
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `build-broadcast-jsonld.ts`**

```typescript
// src/lib/where-to-watch/build-broadcast-jsonld.ts
//
// Pure builder: turns the SEO-side fetch payload (channel meta + live YT
// streams + broadcasters) into a schema.org BroadcastEvent[] array. Used
// inside the existing SportsEvent JSON-LD on match + tournament layouts.

const ISO2_TO_NAME: Record<string, string> = {
  es: 'Spain', it: 'Italy', fr: 'France', de: 'Germany', gb: 'United Kingdom',
  us: 'United States', ar: 'Argentina', mx: 'Mexico', br: 'Brazil',
  pt: 'Portugal', nl: 'Netherlands', be: 'Belgium', se: 'Sweden', no: 'Norway',
  dk: 'Denmark', fi: 'Finland', pl: 'Poland', ch: 'Switzerland', at: 'Austria',
  ie: 'Ireland', gr: 'Greece', tr: 'Turkey', il: 'Israel', sa: 'Saudi Arabia',
  ae: 'UAE', qa: 'Qatar', eg: 'Egypt', ma: 'Morocco', za: 'South Africa',
  jp: 'Japan', kr: 'South Korea', cn: 'China', in: 'India', au: 'Australia',
}

export interface ChannelMetaForSeo {
  id: string                 // youtube_channels.id (uuid)
  channelId: string          // youtube_channels.channel_id (UC...)
  name: string
  abbreviation: string
}

export interface LiveStreamForSeo {
  videoId: string
  title: string
}

export interface BroadcasterForSeo {
  name: string
  url: string
  country_iso2: string
}

export interface BroadcastServiceEntry {
  '@type': 'BroadcastService'
  name: string
  broadcastDisplayName?: string
  url: string
  areaServed?: { '@type': 'Country'; name: string }
  broadcaster: { '@type': 'Organization'; name: string }
}

export interface BroadcastEventEntry {
  '@type': 'BroadcastEvent'
  name: string
  isLiveBroadcast: boolean
  videoFormat?: string
  publishedOn: BroadcastServiceEntry
}

export interface BuildBroadcastJsonLdInput {
  channelMeta: ChannelMetaForSeo | null
  liveStreams: LiveStreamForSeo[]
  broadcasters: BroadcasterForSeo[]
}

function countryName(iso2: string): string {
  return ISO2_TO_NAME[iso2.toLowerCase()] ?? iso2.toUpperCase()
}

export function buildBroadcastJsonLd(input: BuildBroadcastJsonLdInput): BroadcastEventEntry[] {
  const { channelMeta, liveStreams, broadcasters } = input
  if (!channelMeta) return []

  const isLive = liveStreams.length > 0
  const ytUrl = `https://www.youtube.com/channel/${channelMeta.channelId}`

  const ytEntry: BroadcastEventEntry = {
    '@type': 'BroadcastEvent',
    name: `${channelMeta.name} on YouTube`,
    isLiveBroadcast: isLive,
    ...(isLive ? { videoFormat: 'HD' } : {}),
    publishedOn: {
      '@type': 'BroadcastService',
      name: channelMeta.name,
      broadcastDisplayName: channelMeta.name,
      url: ytUrl,
      broadcaster: { '@type': 'Organization', name: channelMeta.name },
    },
  }

  const broadcasterEntries: BroadcastEventEntry[] = broadcasters.map((b) => {
    const country = countryName(b.country_iso2)
    return {
      '@type': 'BroadcastEvent',
      name: `Watch on ${b.name} in ${country}`,
      isLiveBroadcast: false,
      publishedOn: {
        '@type': 'BroadcastService',
        name: b.name,
        url: b.url,
        areaServed: { '@type': 'Country', name: country },
        broadcaster: { '@type': 'Organization', name: b.name },
      },
    }
  })

  return [ytEntry, ...broadcasterEntries]
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/__tests__/build-broadcast-jsonld.test.ts
```
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/where-to-watch/build-broadcast-jsonld.ts src/lib/__tests__/build-broadcast-jsonld.test.ts
git commit -m "feat(seo): pure buildBroadcastJsonLd helper with unit tests"
```

---

## Task 2: Build `buildSeoSummary` (TDD)

**Files:**
- Create: `src/lib/__tests__/build-seo-summary.test.ts`
- Create: `src/lib/where-to-watch/build-seo-summary.ts`

This is a pure structural function. It groups broadcasters by name, counts countries, applies the named/country caps, and returns structured data. The layout then composes the sentence with the next-intl translator.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/__tests__/build-seo-summary.test.ts
import { describe, it, expect } from 'vitest'
import { buildSeoSummary, type BroadcasterForSummary } from '@/lib/where-to-watch/build-seo-summary'

const movistarES: BroadcasterForSummary = { name: 'Movistar Plus+', country_iso2: 'es' }
const redBull = (iso: string): BroadcasterForSummary => ({ name: 'Red Bull TV', country_iso2: iso })
const skySport = (iso: string): BroadcasterForSummary => ({ name: 'Sky Sport', country_iso2: iso })
const directv = (iso: string): BroadcasterForSummary => ({ name: 'DirecTV', country_iso2: iso })

describe('buildSeoSummary', () => {
  it('returns empty data on no broadcasters', () => {
    const out = buildSeoSummary({ broadcasters: [] })
    expect(out.named).toEqual([])
    expect(out.remainingCount).toBe(0)
  })

  it('groups broadcasters by name and sorts by country count (most first)', () => {
    const out = buildSeoSummary({
      broadcasters: [
        movistarES,
        redBull('es'), redBull('it'), redBull('de'), redBull('gb'), redBull('us'),
        skySport('it'), skySport('de'),
      ],
    })
    expect(out.named.map(b => b.name)).toEqual(['Red Bull TV', 'Sky Sport', 'Movistar Plus+'])
  })

  it('shows up to 4 countries per broadcaster, then sets extraCountryCount', () => {
    const out = buildSeoSummary({
      broadcasters: [
        redBull('es'), redBull('it'), redBull('de'), redBull('gb'),
        redBull('us'), redBull('ar'), redBull('br'), redBull('mx'),
      ],
    })
    expect(out.named[0].countriesShown).toEqual(['Spain', 'Italy', 'Germany', 'United Kingdom'])
    expect(out.named[0].extraCountryCount).toBe(4)
  })

  it('caps to 5 named broadcasters; remainder counted in remainingCount', () => {
    // 7 distinct broadcaster names, 1 country each
    const broadcasters: BroadcasterForSummary[] = [
      { name: 'A', country_iso2: 'es' },
      { name: 'B', country_iso2: 'es' },
      { name: 'C', country_iso2: 'es' },
      { name: 'D', country_iso2: 'es' },
      { name: 'E', country_iso2: 'es' },
      { name: 'F', country_iso2: 'es' },
      { name: 'G', country_iso2: 'es' },
    ]
    const out = buildSeoSummary({ broadcasters })
    expect(out.named).toHaveLength(5)
    expect(out.named.map(b => b.name)).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(out.remainingCount).toBe(2)
  })

  it('counts remaining as TOTAL broadcasters beyond the cap, not country rows', () => {
    // F appears in 2 countries — counts as 1 broadcaster in the remainder
    const broadcasters: BroadcasterForSummary[] = [
      { name: 'A', country_iso2: 'es' },
      { name: 'B', country_iso2: 'es' },
      { name: 'C', country_iso2: 'es' },
      { name: 'D', country_iso2: 'es' },
      { name: 'E', country_iso2: 'es' },
      { name: 'F', country_iso2: 'es' }, { name: 'F', country_iso2: 'it' },
      { name: 'G', country_iso2: 'es' },
    ]
    const out = buildSeoSummary({ broadcasters })
    expect(out.remainingCount).toBe(2) // F + G, not F-es + F-it + G
  })

  it('respects custom maxNamedBroadcasters / maxCountriesPerBroadcaster', () => {
    const out = buildSeoSummary({
      broadcasters: [
        redBull('es'), redBull('it'), redBull('de'),
        skySport('it'), skySport('de'),
        directv('ar'),
      ],
      maxNamedBroadcasters: 2,
      maxCountriesPerBroadcaster: 2,
    })
    expect(out.named).toHaveLength(2)
    expect(out.named[0].name).toBe('Red Bull TV')
    expect(out.named[0].countriesShown).toEqual(['Spain', 'Italy'])
    expect(out.named[0].extraCountryCount).toBe(1)
    expect(out.remainingCount).toBe(1) // DirecTV
  })

  it('uppercases unknown ISO codes', () => {
    const out = buildSeoSummary({
      broadcasters: [{ name: 'Local TV', country_iso2: 'zz' }],
    })
    expect(out.named[0].countriesShown).toEqual(['ZZ'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/__tests__/build-seo-summary.test.ts
```
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `build-seo-summary.ts`**

```typescript
// src/lib/where-to-watch/build-seo-summary.ts
//
// Pure structural builder for the sr-only "where to watch" sentence.
// Groups broadcasters by name, sorts by country coverage, applies caps,
// and returns data the layout passes to next-intl's translator.

const ISO2_TO_NAME: Record<string, string> = {
  es: 'Spain', it: 'Italy', fr: 'France', de: 'Germany', gb: 'United Kingdom',
  us: 'United States', ar: 'Argentina', mx: 'Mexico', br: 'Brazil',
  pt: 'Portugal', nl: 'Netherlands', be: 'Belgium', se: 'Sweden', no: 'Norway',
  dk: 'Denmark', fi: 'Finland', pl: 'Poland', ch: 'Switzerland', at: 'Austria',
  ie: 'Ireland', gr: 'Greece', tr: 'Turkey', il: 'Israel', sa: 'Saudi Arabia',
  ae: 'UAE', qa: 'Qatar', eg: 'Egypt', ma: 'Morocco', za: 'South Africa',
  jp: 'Japan', kr: 'South Korea', cn: 'China', in: 'India', au: 'Australia',
}

export interface BroadcasterForSummary {
  name: string
  country_iso2: string
}

export interface NamedBroadcaster {
  name: string
  countriesShown: string[]
  extraCountryCount: number
}

export interface SeoSummaryData {
  named: NamedBroadcaster[]
  remainingCount: number
}

export interface BuildSeoSummaryInput {
  broadcasters: BroadcasterForSummary[]
  maxNamedBroadcasters?: number
  maxCountriesPerBroadcaster?: number
}

function countryName(iso2: string): string {
  return ISO2_TO_NAME[iso2.toLowerCase()] ?? iso2.toUpperCase()
}

export function buildSeoSummary(input: BuildSeoSummaryInput): SeoSummaryData {
  const {
    broadcasters,
    maxNamedBroadcasters = 5,
    maxCountriesPerBroadcaster = 4,
  } = input

  // Group by broadcaster name preserving first-seen country order.
  const byName = new Map<string, string[]>()
  for (const b of broadcasters) {
    const arr = byName.get(b.name) ?? []
    const country = countryName(b.country_iso2)
    if (!arr.includes(country)) arr.push(country)
    byName.set(b.name, arr)
  }

  // Sort broadcasters by descending country count, then by name for stability.
  const sortedNames = [...byName.entries()].sort((a, b) => {
    if (b[1].length !== a[1].length) return b[1].length - a[1].length
    return a[0].localeCompare(b[0])
  })

  const named: NamedBroadcaster[] = sortedNames
    .slice(0, maxNamedBroadcasters)
    .map(([name, countries]) => ({
      name,
      countriesShown: countries.slice(0, maxCountriesPerBroadcaster),
      extraCountryCount: Math.max(0, countries.length - maxCountriesPerBroadcaster),
    }))

  const remainingCount = Math.max(0, sortedNames.length - maxNamedBroadcasters)

  return { named, remainingCount }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/__tests__/build-seo-summary.test.ts
```
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/where-to-watch/build-seo-summary.ts src/lib/__tests__/build-seo-summary.test.ts
git commit -m "feat(seo): pure buildSeoSummary helper with unit tests"
```

---

## Task 3: Add i18n key (5 locales)

**Files:**
- Modify: `src/messages/{en,es,pt,it,fr}.json`

One new key inside the existing `whereToWatch` block. ICU plural for the suffix.

- [ ] **Step 1: Append to en.json**

Find the closing `}` of the `whereToWatch` block in `src/messages/en.json`. Insert before it (with comma after the previous key):

```json
,
    "seoSummary": "Watch {target} live on {list}{extra, plural, =0 {} one { and # other regional broadcaster} other { and # other regional broadcasters}}."
```

- [ ] **Step 2: Spanish (`es.json`)**

```json
,
    "seoSummary": "Mira {target} en directo en {list}{extra, plural, =0 {} one { y # otra emisora regional} other { y # otras emisoras regionales}}."
```

- [ ] **Step 3: Portuguese (`pt.json`)**

```json
,
    "seoSummary": "Assista {target} ao vivo em {list}{extra, plural, =0 {} one { e # outra emissora regional} other { e # outras emissoras regionais}}."
```

- [ ] **Step 4: Italian (`it.json`)**

```json
,
    "seoSummary": "Guarda {target} live su {list}{extra, plural, =0 {} one { e # altra emittente regionale} other { e # altre emittenti regionali}}."
```

- [ ] **Step 5: French (`fr.json`)**

```json
,
    "seoSummary": "Regardez {target} en direct sur {list}{extra, plural, =0 {} one { et # autre diffuseur régional} other { et # autres diffuseurs régionaux}}."
```

- [ ] **Step 6: Verify JSON still parses**

```bash
cd /Users/GuDenes/Projects/padel-live-scores/.worktrees/wtw-banner && \
  for f in src/messages/{en,es,pt,it,fr}.json; do node -e "require('./$f')" && echo "$f OK"; done
```
Expected: each line ends with "OK".

- [ ] **Step 7: Commit**

```bash
git add src/messages/
git commit -m "i18n(seo): seoSummary key for sr-only where-to-watch sentence"
```

---

## Task 4: Build `fetchSeoBroadcasters` server helper

**Files:**
- Create: `src/lib/where-to-watch/fetch-seo-broadcasters.ts`

- [ ] **Step 1: Write the helper**

```typescript
// src/lib/where-to-watch/fetch-seo-broadcasters.ts
//
// Server-side fetch for the SEO layer (BroadcastEvent JSON-LD + sr-only
// sentence). Scoped to a single channel abbreviation (PP / FIP), returns
// channel meta + active broadcasters + currently-live YT streams for the
// circuit. Called from match + tournament server layouts.

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ChannelMetaForSeo,
  LiveStreamForSeo,
  BroadcasterForSeo,
} from './build-broadcast-jsonld'

export interface SeoBroadcastersPayload {
  channelMeta: ChannelMetaForSeo | null
  liveStreams: LiveStreamForSeo[]
  broadcasters: BroadcasterForSeo[]
}

const STALE_MS = 30 * 60 * 1000

export async function fetchSeoBroadcasters(
  supabase: SupabaseClient,
  channelAbbr: string | null,
): Promise<SeoBroadcastersPayload> {
  if (!channelAbbr) {
    return { channelMeta: null, liveStreams: [], broadcasters: [] }
  }

  const [chRes, liveRes, broadcasterRes] = await Promise.all([
    supabase
      .from('youtube_channels')
      .select('id, channel_id, name, abbreviation')
      .eq('is_active', true)
      .eq('abbreviation', channelAbbr)
      .maybeSingle(),
    supabase
      .from('youtube_channel_live')
      .select(`video_id, title, channel:youtube_channels!inner(abbreviation, is_active)`)
      .gt('last_seen_at', new Date(Date.now() - STALE_MS).toISOString())
      .eq('channel.is_active', true)
      .eq('channel.abbreviation', channelAbbr),
    // Broadcasters: needs the youtube_channels join filter, but cheaper
    // to filter by channel_id once we know it. Issue this second query
    // after the channel lookup resolves; in a parallel Promise.all the
    // first round wins anyway.
    supabase
      .from('broadcasters')
      .select(`name, url, country_iso2, channel:youtube_channels!inner(abbreviation, is_active)`)
      .eq('active', true)
      .eq('channel.is_active', true)
      .eq('channel.abbreviation', channelAbbr)
      .order('country_iso2', { ascending: true })
      .order('display_order', { ascending: true }),
  ])

  if (chRes.error) console.error('[fetchSeoBroadcasters] channel query failed:', chRes.error.message)
  if (liveRes.error) console.error('[fetchSeoBroadcasters] live query failed:', liveRes.error.message)
  if (broadcasterRes.error) console.error('[fetchSeoBroadcasters] broadcasters query failed:', broadcasterRes.error.message)

  const channelMeta: ChannelMetaForSeo | null = chRes.data
    ? {
        id: chRes.data.id as string,
        channelId: chRes.data.channel_id as string,
        name: chRes.data.name as string,
        abbreviation: chRes.data.abbreviation as string,
      }
    : null

  const liveStreams: LiveStreamForSeo[] = (liveRes.data ?? []).map((r: any) => ({
    videoId: r.video_id as string,
    title: r.title as string,
  }))

  const broadcasters: BroadcasterForSeo[] = (broadcasterRes.data ?? []).map((r: any) => ({
    name: r.name as string,
    url: r.url as string,
    country_iso2: r.country_iso2 as string,
  }))

  return { channelMeta, liveStreams, broadcasters }
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep "fetch-seo-broadcasters"
```
Expected: empty.

- [ ] **Step 3: Commit**

```bash
git add src/lib/where-to-watch/fetch-seo-broadcasters.ts
git commit -m "feat(seo): fetchSeoBroadcasters server helper"
```

---

## Task 5: Wire into match layout

**Files:**
- Modify: `src/app/[locale]/match/[id]/layout.tsx`

The match layout is already a server component that builds `SportsEvent` JSON-LD around line 202 and emits an sr-only header around line 260. We add the broadcaster fetch in parallel with the existing match query, then inject the new fields.

- [ ] **Step 1: Add imports near the top**

Add after the existing `buildMatchSummary` import (around line 8):

```typescript
import { fetchSeoBroadcasters } from '@/lib/where-to-watch/fetch-seo-broadcasters'
import { buildBroadcastJsonLd } from '@/lib/where-to-watch/build-broadcast-jsonld'
import { buildSeoSummary } from '@/lib/where-to-watch/build-seo-summary'
import { levelToChannelAbbr } from '@/lib/where-to-watch/circuit-map'
import { getTranslations } from 'next-intl/server'
```

(If `getTranslations` is already imported, skip that line — check first with `grep -n "from 'next-intl/server'" src/app/\[locale\]/match/\[id\]/layout.tsx`.)

- [ ] **Step 2: Fetch SEO data in parallel with the existing match fetch**

Find the line where the existing match query resolves (the `match` variable is set). Right after the `tournament` variable is available, derive the channel abbreviation and call the SEO fetch.

The exact insertion depends on the existing structure — look for where `tournament?.level` is in scope but BEFORE the `jsonLd` assignment around line 202. Add:

```typescript
const seoChannelAbbr = levelToChannelAbbr(tournament?.level ?? null)
const seoData = await fetchSeoBroadcasters(supabase, seoChannelAbbr)
```

If you want true parallelism with the existing match query, wrap both in `Promise.all`. But for simplicity, sequential is fine here — the SEO fetch is one cheap query and the match query already ran.

- [ ] **Step 3: Add `publication` to the SportsEvent JSON-LD**

Find the existing `jsonLd = { '@type': 'SportsEvent', ... }` block around line 202. Add a new field at the end of the object:

```typescript
jsonLd =
  match && tournament && startDate
    ? {
        '@context': 'https://schema.org',
        '@type': 'SportsEvent',
        name: `${p1} vs ${p2}`,
        startDate,
        ...(endDate ? { endDate } : {}),
        location: {
          '@type': 'Place',
          name: tournament.name,
          ...(tournament.country ? { address: tournament.country } : {}),
        },
        sport: 'Padel',
        ...(competitor.length > 0 ? { competitor } : {}),
        // NEW: BroadcastEvent[] for Google's "where to watch" carousel
        ...(seoData.channelMeta
          ? { publication: buildBroadcastJsonLd(seoData) }
          : {}),
      }
    : null
```

- [ ] **Step 4: Append the sr-only sentence**

Find the existing return block (around line 252). The sr-only `<header>` contains `<h1>` + a facts list. Compose a one-sentence summary from `seoData` and the `t` translator, then add a `<p>` after the facts list.

After the existing summary computation (after the `summary = buildMatchSummary(...)` call), add:

```typescript
const seoSentence = await (async () => {
  if (!seoData.channelMeta) return null
  const summaryData = buildSeoSummary({ broadcasters: seoData.broadcasters })
  // Build the list: YT channel first, then named broadcasters with country tags.
  const parts: string[] = [`${seoData.channelMeta.name} YouTube`]
  for (const b of summaryData.named) {
    const countries = b.countriesShown.join(', ')
    parts.push(
      b.extraCountryCount > 0
        ? `${b.name} (${countries}, +${b.extraCountryCount} more)`
        : `${b.name} (${countries})`,
    )
  }
  const list = parts.join(', ')
  const target = h1Text ?? `${p1} vs ${p2}`
  const t = await getTranslations({ locale, namespace: 'whereToWatch' })
  return t('seoSummary', { target, list, extra: summaryData.remainingCount })
})()
```

(`locale` should already be in scope from the route params. If not, derive from `params`.)

Then in the JSX, inside the existing `<header className="sr-only">` block, add a `<p>` after the facts list:

```tsx
{summary ? (
  <header className="sr-only">
    <h1>{summary.headline}</h1>
    {summary.facts.length > 0 && (
      <ul>
        {summary.facts.map((fact) => (
          <li key={fact}>{fact}</li>
        ))}
      </ul>
    )}
    {seoSentence && <p>{seoSentence}</p>}
  </header>
) : (
  // existing else branch
)}
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -E "match/\[id\]/layout" | head -5
```
Expected: empty.

- [ ] **Step 6: Commit**

```bash
git add 'src/app/[locale]/match/[id]/layout.tsx'
git commit -m "feat(seo): BroadcastEvent JSON-LD + sr-only sentence on match layout"
```

---

## Task 6: Wire into tournament layout

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/layout.tsx`

Mirror Task 5's changes on the tournament layout (around line 105 for jsonLd, similar `<header className="sr-only">` if present).

- [ ] **Step 1: Read the file to confirm structure**

```bash
cd /Users/GuDenes/Projects/padel-live-scores/.worktrees/wtw-banner && \
  grep -n "SportsEvent\|jsonLd\|sr-only\|<header\|h1Text\|getTranslations" src/app/\[locale\]/\(app\)/tournaments/\[id\]/layout.tsx | head -20
```

- [ ] **Step 2: Add imports**

Same 5 imports as Task 5 Step 1 (skip any already present).

- [ ] **Step 3: Fetch SEO data**

After the tournament fetch resolves, before the jsonLd assignment:

```typescript
const seoChannelAbbr = levelToChannelAbbr(tournament?.level ?? null)
const seoData = await fetchSeoBroadcasters(supabase, seoChannelAbbr)
```

- [ ] **Step 4: Add `publication` to the SportsEvent JSON-LD**

Find the existing `jsonLd = { '@type': 'SportsEvent', ... }` block (around line 108). Add the same conditional field:

```typescript
...(seoData.channelMeta
  ? { publication: buildBroadcastJsonLd(seoData) }
  : {}),
```

- [ ] **Step 5: Append the sr-only sentence (if a sr-only block exists)**

```typescript
const seoSentence = await (async () => {
  if (!seoData.channelMeta) return null
  const summaryData = buildSeoSummary({ broadcasters: seoData.broadcasters })
  const parts: string[] = [`${seoData.channelMeta.name} YouTube`]
  for (const b of summaryData.named) {
    const countries = b.countriesShown.join(', ')
    parts.push(
      b.extraCountryCount > 0
        ? `${b.name} (${countries}, +${b.extraCountryCount} more)`
        : `${b.name} (${countries})`,
    )
  }
  const list = parts.join(', ')
  const target = tournament?.name ?? 'this tournament'
  const t = await getTranslations({ locale, namespace: 'whereToWatch' })
  return t('seoSummary', { target, list, extra: summaryData.remainingCount })
})()
```

If the tournament layout doesn't have an existing `<header className="sr-only">`, add one at the top of the rendered JSX wrapping `{seoSentence && <p>{seoSentence}</p>}`. Otherwise append a `<p>` inside the existing one — mirror the match layout structure.

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -E "tournaments/\[id\]/layout" | head -5
```
Expected: empty.

- [ ] **Step 7: Commit**

```bash
git add 'src/app/[locale]/(app)/tournaments/[id]/layout.tsx'
git commit -m "feat(seo): BroadcastEvent JSON-LD + sr-only sentence on tournament layout"
```

---

## Task 7: Verification

This is a check, not code — no commits.

- [ ] **Step 1: Spawn the worktree dev server** (if not already running on 3011)

```bash
cd /Users/GuDenes/Projects/padel-live-scores/.worktrees/wtw-banner && \
  npx next dev -p 3011 > /tmp/next-seo.log 2>&1 &
sleep 5 && grep "Ready" /tmp/next-seo.log
```

- [ ] **Step 2: Curl a Premier match page; confirm JSON-LD has `publication`**

Pick a Premier match (`level=p1/p2/major/finals`):

```bash
curl -s "http://localhost:3011/match/<some-premier-match-id>" | \
  python3 -c "
import re, sys, json
html = sys.stdin.read()
m = re.search(r'application/ld\+json[^>]*>([^<]+)<', html)
if not m:
    print('No JSON-LD found')
    sys.exit(1)
data = json.loads(m.group(1))
print('Type:', data.get('@type'))
pubs = data.get('publication', [])
print(f'publication entries: {len(pubs)}')
for p in pubs[:3]:
    svc = p.get('publishedOn', {})
    area = svc.get('areaServed', {}).get('name', '—')
    print(f'  - {svc.get(\"name\")} (live={p.get(\"isLiveBroadcast\")}, area={area})')
"
```
Expected: `publication entries: ~399` (PP YT + ~398 broadcaster rows). First entry is `Premier Padel (live=False, area=—)`. Rest are broadcasters with their country tags.

- [ ] **Step 3: Confirm sr-only sentence is in the HTML**

```bash
curl -s "http://localhost:3011/match/<some-premier-match-id>" | \
  grep -oE 'Watch [^<]{1,200}regional broadcaster[s]?\.' | head -1
```
Expected: returns a sentence like `Watch X vs Y live on Premier Padel YouTube, Red Bull TV (...), ..., and 393 other regional broadcasters.`

- [ ] **Step 4: Same checks on a tournament URL**

```bash
curl -s "http://localhost:3011/tournaments/<some-tournament-id>" | \
  python3 -c "..."  # same script as Step 2
```

- [ ] **Step 5: Same checks on a FIP tournament URL**

```bash
# Find a FIP tournament:
# fip_bronze / fip_silver / fip_gold / fip_platinum etc.
curl -s "http://localhost:3011/tournaments/<some-fip-tournament-id>" | \
  python3 -c "..."  # same script
```
Expected: `publication entries: 1` (FIP YT only — no regional broadcasters in DB for the FIP circuit).

- [ ] **Step 6: Confirm UNKNOWN-circuit pages skip the extras**

Find a tournament with `level` outside the mapped set (e.g. `wpt_1000`):

```bash
curl -s "http://localhost:3011/tournaments/<wpt-tournament-id>" | \
  grep -c "publication"
```
Expected: `0` (no publication array, no SEO sentence) — graceful degradation.

- [ ] **Step 7: Run Rich Results test once deployed**

Manual: paste the deployed match URL into `https://search.google.com/test/rich-results`. Expected: SportsEvent recognized with a "Watch the broadcast" section showing the broadcaster list. No errors.

---

## Self-review notes

**Spec coverage:**
- JSON-LD shape → Task 1 (builder + tests) + Tasks 5/6 (integration).
- sr-only sentence → Task 2 (summary data) + Task 3 (i18n) + Tasks 5/6 (compose + emit).
- Data flow / parallel fetch → Task 4 (helper) + Tasks 5/6 (call site).
- Option B from brainstorming (all classified broadcasters) → fetchSeoBroadcasters has no country filter; builder includes all rows.
- Graceful degradation on unknown circuits → handled in fetchSeoBroadcasters (returns empty when `channelAbbr === null`); both builders return empty when `channelMeta === null`. Verified in Task 7 Step 6.
- 5 locales for the sentence → Task 3.

**Type consistency:**
- `ChannelMetaForSeo`, `LiveStreamForSeo`, `BroadcasterForSeo` defined in `build-broadcast-jsonld.ts`, re-exported via `fetch-seo-broadcasters.ts` and consumed unchanged by layouts.
- `BroadcasterForSummary` in `build-seo-summary.ts` is structurally compatible with `BroadcasterForSeo` (subset: only `name` + `country_iso2`). Layouts can pass `BroadcasterForSeo[]` directly.

**No placeholders.** Each task has complete code blocks; the only "around line N" hints in the layout integration tasks point to the existing code, not future code to write.

**Out of scope (per spec):** dedicated landing pages, FAQ JSON-LD, country-name localization, cleanup of the unused `bannerWatchIn` key from a previous spec.

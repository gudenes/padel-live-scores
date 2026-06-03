# Ops-Managed Ad Banners + Network Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manage sponsor ad banners (per-country, weighted rotation, global default) and a global AdSense/AdMob config from the ops dashboard, with the public site reading them live — replacing the `src/lib/sponsors.ts` code config.

**Architecture:** Two new Supabase tables (`ad_banners`, `ad_network_config`) + a Storage bucket `ad-banners`. The public app exposes a cached `GET /api/ads/active` that returns active banners + the network config; a pure `pickBanner()` resolver chooses a weighted-random banner client-side by country. The ops app (`apps/ops/`) gets a dedicated "Ads" page with CRUD + image upload, reusing the existing Brands/equipment-upload patterns (Auth.js operator session + `serviceClient`).

**Tech Stack:** Next.js 16 (App Router) in two apps (`/` main public, `apps/ops/` admin), React 19, TypeScript, Supabase (Postgres + Storage), Vitest. Worktree: `/Volumes/Crucial/dev/padel-live-scores/.claude/worktrees/sponsor-ad-slots`. Tests: `npx vitest run <file>`. All commits happen from the controller in the worktree.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `supabase/migrations/20260603000000_ops_ad_banners.sql` (create) | Tables, index, storage bucket + policy, seed |
| `src/lib/ad-banner-resolver.ts` (create) | `AdBanner`/`AdNetworkConfig`/`AdSlotId` types + pure `pickBanner()` |
| `src/lib/__tests__/ad-banner-resolver.test.ts` (create) | Resolver unit tests |
| `src/app/api/ads/active/route.ts` (create) | Public cached read of active banners + network config |
| `src/hooks/useActiveBanner.ts` (create) | Client hook: fetch `/api/ads/active`, cache |
| `src/components/ads/SponsorCard.tsx` (modify) | Take an `AdBanner` instead of config `Sponsor` |
| `src/components/ads/NetworkAdSlot.tsx` (modify) | Import `AdSlotId` from resolver |
| `src/components/ads/AdSlot.tsx` (modify) | Take a resolved `banner` prop |
| `src/components/ads/StickyAdBanner.tsx` (modify) | Resolve via `useActiveBanner` + `pickBanner` |
| `src/lib/sponsors.ts` (delete) | Replaced by resolver + DB |
| `src/lib/__tests__/sponsors.test.ts` (delete) | Replaced |
| `apps/ops/src/app/api/internal/ad-banners/route.ts` (create) | Banner CRUD (operator) |
| `apps/ops/src/app/api/internal/ad-network-config/route.ts` (create) | Network config read/update |
| `apps/ops/src/app/api/internal/upload-ad-banner-image/route.ts` (create) | Banner image upload |
| `apps/ops/src/app/(app)/ads/page.tsx` (create) | Ops page wrapper |
| `apps/ops/src/app/(app)/ads/_components/AdsTab.tsx` (create) | Ops UI: banners table/form + network config |
| `apps/ops/src/lib/sidebar-areas.tsx` (modify) | Add "Ad Banners" nav entry |

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260603000000_ops_ad_banners.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260603000000_ops_ad_banners.sql
-- Ops-managed ad banners (per-country, weighted rotation, global default) +
-- a singleton AdSense/AdMob config. Replaces the src/lib/sponsors.ts config.

CREATE TABLE IF NOT EXISTS ad_banners (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  country_code TEXT CHECK (country_code ~ '^[A-Z]{2}$'),  -- NULL = global default
  slot         TEXT NOT NULL DEFAULT 'sticky-bottom',
  image_url    TEXT NOT NULL,
  click_url    TEXT NOT NULL,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  weight       INTEGER NOT NULL DEFAULT 1 CHECK (weight >= 1),
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- Multiple active banners may share a (slot, country); they rotate by weight.
CREATE INDEX IF NOT EXISTS idx_ad_banners_active ON ad_banners (slot) WHERE active;

ALTER TABLE ad_banners ENABLE ROW LEVEL SECURITY;  -- service-key only

CREATE TABLE IF NOT EXISTS ad_network_config (
  key                  TEXT PRIMARY KEY DEFAULT 'default' CHECK (key = 'default'),
  web_enabled          BOOLEAN NOT NULL DEFAULT FALSE,
  adsense_publisher_id TEXT,
  adsense_slot_id      TEXT,
  native_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  admob_ios_app_id     TEXT,
  admob_android_app_id TEXT,
  admob_banner_unit_id TEXT,
  updated_at           TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE ad_network_config ENABLE ROW LEVEL SECURITY;  -- service-key only
INSERT INTO ad_network_config (key) VALUES ('default') ON CONFLICT DO NOTHING;

-- Storage bucket for uploaded banner creatives (public read).
INSERT INTO storage.buckets (id, name, public)
VALUES ('ad-banners', 'ad-banners', TRUE)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read ad-banners" ON storage.objects;
CREATE POLICY "Public read ad-banners" ON storage.objects
  FOR SELECT USING (bucket_id = 'ad-banners');

-- Seed the current placeholder so nothing disappears when the code config goes.
INSERT INTO ad_banners (name, country_code, slot, image_url, click_url, active)
VALUES ('AceProGrip', 'ES', 'sticky-bottom',
        '/sponsors/aceprogrip-banner.svg', 'https://www.aceprogrip.es/', TRUE)
ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: Apply the migration to Supabase**

This repo applies migrations against the hosted Supabase via a one-off Node script using `DATABASE_URL` from `.env.local` (the `pg` package is installed). Create `_tmp-apply.mjs` in the worktree root:

```js
import { readFileSync } from 'node:fs'
import pg from 'pg'
const sql = readFileSync('./supabase/migrations/20260603000000_ops_ad_banners.sql', 'utf8')
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
await c.query(sql)
const t = await c.query(`select table_name from information_schema.tables where table_name in ('ad_banners','ad_network_config') order by table_name`)
const b = await c.query(`select count(*)::int n from ad_banners`)
console.log('tables:', t.rows.map(r => r.table_name).join(','), '| ad_banners rows:', b.rows[0].n)
await c.end()
```

Run: `node --env-file=.env.local _tmp-apply.mjs && rm -f _tmp-apply.mjs`
Expected: `tables: ad_banners,ad_network_config | ad_banners rows: 1`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260603000000_ops_ad_banners.sql
git commit -m "feat: ad_banners + ad_network_config tables, storage bucket, seed"
```

---

## Task 2: Resolver + types (`pickBanner`)

**Files:**
- Create: `src/lib/ad-banner-resolver.ts`
- Test: `src/lib/__tests__/ad-banner-resolver.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/ad-banner-resolver.test.ts
import { describe, it, expect } from 'vitest'
import { pickBanner, type AdBanner } from '@/lib/ad-banner-resolver'

function banner(p: Partial<AdBanner>): AdBanner {
  return {
    id: p.id ?? 'b', name: p.name ?? 'B', country_code: p.country_code ?? null,
    slot: 'sticky-bottom', image_url: '/x.svg', click_url: 'https://x',
    active: p.active ?? true, weight: p.weight ?? 1,
  }
}

describe('pickBanner', () => {
  const es = banner({ id: 'es', country_code: 'ES' })
  const global = banner({ id: 'g', country_code: null })

  it('prefers an exact country match over global', () => {
    expect(pickBanner([global, es], 'ES')?.id).toBe('es')
  })

  it('falls back to the global default when no country match', () => {
    expect(pickBanner([global, es], 'PT')?.id).toBe('g')
  })

  it('returns null when nothing matches and no global', () => {
    expect(pickBanner([es], 'PT')).toBeNull()
    expect(pickBanner([], 'ES')).toBeNull()
  })

  it('ignores inactive banners', () => {
    expect(pickBanner([banner({ id: 'es', country_code: 'ES', active: false })], 'ES')).toBeNull()
  })

  it('weighted rotation: rand near 0 picks the first, near 1 the last', () => {
    const a = banner({ id: 'a', country_code: 'ES', weight: 1 })
    const b = banner({ id: 'b', country_code: 'ES', weight: 3 })
    expect(pickBanner([a, b], 'ES', () => 0)?.id).toBe('a')      // first slice
    expect(pickBanner([a, b], 'ES', () => 0.999)?.id).toBe('b')  // last slice
  })

  it('a single candidate is always returned regardless of rand', () => {
    const a = banner({ id: 'a', country_code: 'ES' })
    expect(pickBanner([a], 'ES', () => 0.5)?.id).toBe('a')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/ad-banner-resolver.test.ts`
Expected: FAIL — cannot resolve `@/lib/ad-banner-resolver`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/ad-banner-resolver.ts
// DB-backed ad banner types + pure resolver. Replaces the old code config.

export type AdSlotId = 'sticky-bottom'

export interface AdBanner {
  id: string
  name: string
  country_code: string | null // null = global default
  slot: string
  image_url: string
  click_url: string
  active: boolean
  weight: number
}

export interface AdNetworkConfig {
  web_enabled: boolean
  adsense_publisher_id: string | null
  adsense_slot_id: string | null
  native_enabled: boolean
  admob_ios_app_id: string | null
  admob_android_app_id: string | null
  admob_banner_unit_id: string | null
}

/**
 * Choose a banner for the visitor's country: exact-country candidates win;
 * else the global-default candidates; else null. Within the chosen set, pick
 * a weighted-random banner. `rand` is injectable for deterministic tests.
 */
export function pickBanner(
  banners: AdBanner[],
  country: string | null,
  rand: () => number = Math.random,
): AdBanner | null {
  const active = banners.filter((b) => b.active)
  const cc = (country ?? '').toUpperCase()
  let set = cc ? active.filter((b) => b.country_code === cc) : []
  if (set.length === 0) set = active.filter((b) => b.country_code === null)
  if (set.length === 0) return null

  const total = set.reduce((sum, b) => sum + Math.max(1, b.weight), 0)
  let r = rand() * total
  for (const b of set) {
    r -= Math.max(1, b.weight)
    if (r < 0) return b
  }
  return set[set.length - 1]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/ad-banner-resolver.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ad-banner-resolver.ts src/lib/__tests__/ad-banner-resolver.test.ts
git commit -m "feat: add ad banner types + weighted pickBanner resolver"
```

---

## Task 3: Public read route `/api/ads/active`

**Files:**
- Create: `src/app/api/ads/active/route.ts`

- [ ] **Step 1: Write the route**

```ts
// src/app/api/ads/active/route.ts
// Public, cached read of active banners for a slot + the global network config.
// Country-agnostic so one cached response serves every visitor; the client
// picks the banner for its country via pickBanner().

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import type { AdBanner, AdNetworkConfig } from '@/lib/ad-banner-resolver'

export async function GET(req: NextRequest) {
  const slot = req.nextUrl.searchParams.get('slot') ?? 'sticky-bottom'
  const supabase = createServerClient()

  try {
    const [{ data: banners }, { data: network }] = await Promise.all([
      supabase
        .from('ad_banners')
        .select('id, name, country_code, slot, image_url, click_url, active, weight')
        .eq('slot', slot)
        .eq('active', true),
      supabase
        .from('ad_network_config')
        .select('web_enabled, adsense_publisher_id, adsense_slot_id, native_enabled, admob_ios_app_id, admob_android_app_id, admob_banner_unit_id')
        .eq('key', 'default')
        .maybeSingle(),
    ])

    return NextResponse.json(
      { banners: (banners ?? []) as AdBanner[], network: (network ?? null) as AdNetworkConfig | null },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } },
    )
  } catch {
    // Degrade to "no ad" rather than erroring the caller.
    return NextResponse.json({ banners: [], network: null })
  }
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit 2>&1 | grep "ads/active" || echo clean`
Expected: `clean`

- [ ] **Step 3: Verify it returns the seeded banner**

Start the dev server if needed (`npx next dev -p 3010`), then:
```bash
curl -s http://localhost:3010/api/ads/active?slot=sticky-bottom | head -c 400
```
Expected: JSON with a `banners` array containing the AceProGrip ES row and a `network` object.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/ads/active/route.ts
git commit -m "feat: public cached /api/ads/active route"
```

---

## Task 4: `useActiveBanner` hook

**Files:**
- Create: `src/hooks/useActiveBanner.ts`

- [ ] **Step 1: Write the hook**

```ts
// src/hooks/useActiveBanner.ts
'use client'

import { useEffect, useState } from 'react'
import type { AdBanner, AdNetworkConfig } from '@/lib/ad-banner-resolver'

interface ActiveAds {
  banners: AdBanner[]
  network: AdNetworkConfig | null
}

// Module-level cache per slot so navigation between pages doesn't refetch.
const cache = new Map<string, ActiveAds>()
const inflight = new Map<string, Promise<ActiveAds>>()

function load(slot: string): Promise<ActiveAds> {
  const cached = cache.get(slot)
  if (cached) return Promise.resolve(cached)
  const existing = inflight.get(slot)
  if (existing) return existing
  const p = fetch(`/api/ads/active?slot=${encodeURIComponent(slot)}`)
    .then((r) => (r.ok ? r.json() : { banners: [], network: null }))
    .then((data: ActiveAds) => {
      cache.set(slot, data)
      inflight.delete(slot)
      return data
    })
    .catch(() => {
      inflight.delete(slot)
      return { banners: [], network: null } as ActiveAds
    })
  inflight.set(slot, p)
  return p
}

/** Fetch active banners + network config for a slot. Returns null until loaded. */
export function useActiveBanner(slot: string): ActiveAds | null {
  const [data, setData] = useState<ActiveAds | null>(() => cache.get(slot) ?? null)
  useEffect(() => {
    if (data) return
    let alive = true
    void load(slot).then((d) => {
      if (alive) setData(d)
    })
    return () => {
      alive = false
    }
  }, [slot, data])
  return data
}
```

- [ ] **Step 2: Verify type-check + lint**

Run: `npx tsc --noEmit 2>&1 | grep useActiveBanner || echo clean` then `npx eslint src/hooks/useActiveBanner.ts`
Expected: `clean`, lint no errors. (setState happens inside the async `.then`, not synchronously in the effect body.)

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useActiveBanner.ts
git commit -m "feat: add useActiveBanner hook (cached fetch of /api/ads/active)"
```

---

## Task 5: Swap runtime from code config to DB banners

Refactor the ad components to resolve banners from `useActiveBanner` + `pickBanner`, render an `AdBanner`, and delete `src/lib/sponsors.ts`.

**Files:**
- Modify: `src/components/ads/SponsorCard.tsx`
- Modify: `src/components/ads/NetworkAdSlot.tsx`
- Modify: `src/components/ads/AdSlot.tsx`
- Modify: `src/components/ads/StickyAdBanner.tsx`
- Delete: `src/lib/sponsors.ts`, `src/lib/__tests__/sponsors.test.ts`

- [ ] **Step 1: Rewrite `SponsorCard.tsx` to take an `AdBanner`**

```tsx
// src/components/ads/SponsorCard.tsx
'use client'

import { useEffect, useRef } from 'react'
import type { AdBanner, AdSlotId } from '@/lib/ad-banner-resolver'

function trackImpression(slot: AdSlotId, bannerId: string) {
  void fetch('/api/ads/impression', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slot, sponsorId: bannerId }),
    keepalive: true,
  }).catch(() => {})
}

function trackClick(slot: AdSlotId, bannerId: string, matchId?: string) {
  void fetch('/api/ads/click', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slot, sponsorId: bannerId, matchId: matchId ?? null }),
    keepalive: true,
  }).catch(() => {})
}

export function SponsorCard({
  banner,
  slot,
  variant,
  matchId,
}: {
  banner: AdBanner
  slot: AdSlotId
  variant: 'feed' | 'detail' | 'sticky'
  matchId?: string
}) {
  const impressionFired = useRef(false)
  useEffect(() => {
    if (impressionFired.current) return
    impressionFired.current = true
    trackImpression(slot, banner.id)
  }, [slot, banner.id])

  const isFeed = variant === 'feed'

  return (
    <a
      href={banner.click_url}
      target="_blank"
      rel="sponsored noopener noreferrer"
      onClick={() => trackClick(slot, banner.id, matchId)}
      data-ad-slot={slot}
      aria-label={`${banner.name} (sponsored)`}
      style={{
        position: 'relative',
        display: 'block',
        margin: variant === 'sticky' ? 0 : isFeed ? '6px 8px' : '12px',
        borderRadius: variant === 'sticky' ? 0 : 8,
        overflow: 'hidden',
        background: '#0b1220',
        lineHeight: 0,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={banner.image_url}
        alt={banner.name}
        style={{
          display: 'block',
          width: '100%',
          height: 'auto',
          ...(variant === 'sticky' ? { maxWidth: 320, margin: '0 auto' } : null),
        }}
      />
      <span
        style={{
          position: 'absolute', top: 3, right: 3, fontSize: 7, letterSpacing: 0.5,
          textTransform: 'uppercase', color: '#e5e7eb', background: 'rgba(0,0,0,0.5)',
          padding: '1px 4px', borderRadius: 3, fontWeight: 700, lineHeight: 1.4,
        }}
      >
        Ad
      </span>
    </a>
  )
}
```

- [ ] **Step 2: Update `NetworkAdSlot.tsx` import**

Change the import line only:

Old:
```tsx
import type { AdSlotId } from '@/lib/sponsors'
```
New:
```tsx
import type { AdSlotId } from '@/lib/ad-banner-resolver'
```

- [ ] **Step 3: Rewrite `AdSlot.tsx` to take a resolved banner**

```tsx
// src/components/ads/AdSlot.tsx
'use client'

import type { AdBanner, AdSlotId } from '@/lib/ad-banner-resolver'
import { SponsorCard } from './SponsorCard'
import { NetworkAdSlot } from './NetworkAdSlot'

/**
 * Renders a resolved banner (direct sponsor) or falls through to the stubbed
 * NetworkAdSlot seam. Resolution (country + rotation) happens upstream.
 */
export function AdSlot({
  slot,
  variant,
  banner,
  context,
}: {
  slot: AdSlotId
  variant: 'feed' | 'detail' | 'sticky'
  banner: AdBanner | null
  context?: { matchId?: string }
}) {
  if (banner) {
    return <SponsorCard banner={banner} slot={slot} variant={variant} matchId={context?.matchId} />
  }
  return <NetworkAdSlot slot={slot} variant={variant} />
}
```

- [ ] **Step 4: Update `StickyAdBanner.tsx` to resolve from the hook**

Replace the imports block (top of file) — old:
```tsx
import { getActiveSponsor } from '@/lib/sponsors'
import { useGeoCountry } from '@/hooks/useGeoCountry'
import { useConsent } from '@/hooks/useConsent'
import { AdSlot } from './AdSlot'
```
New:
```tsx
import { pickBanner } from '@/lib/ad-banner-resolver'
import { useActiveBanner } from '@/hooks/useActiveBanner'
import { useGeoCountry } from '@/hooks/useGeoCountry'
import { useConsent } from '@/hooks/useConsent'
import { AdSlot } from './AdSlot'
```

Replace the resolution lines — old:
```tsx
  const country = useGeoCountry()
  const pathname = usePathname()
  const { hasDecided } = useConsent()
  const sponsor = country ? getActiveSponsor('sticky-bottom', country) : null
```
New:
```tsx
  const country = useGeoCountry()
  const pathname = usePathname()
  const { hasDecided } = useConsent()
  const active = useActiveBanner('sticky-bottom')
  const banner = active ? pickBanner(active.banners, country) : null
```

Replace every remaining use of `sponsor` with `banner`:
- `const testingGeo = ...` stays unchanged.
- old `const visible = !!sponsor && isAdRoute(pathname) && (hasDecided || testingGeo)`
  new `const visible = !!banner && isAdRoute(pathname) && (hasDecided || testingGeo)`
- nav-measure effect dependency stays `[visible]` (unchanged).

Replace the render — old:
```tsx
      <AdSlot slot="sticky-bottom" variant="sticky" context={{ country }} />
```
New:
```tsx
      <AdSlot slot="sticky-bottom" variant="sticky" banner={banner} />
```

- [ ] **Step 5: Delete the old config**

```bash
git rm src/lib/sponsors.ts src/lib/__tests__/sponsors.test.ts
```

- [ ] **Step 6: Type-check, lint, unit tests**

Run:
```bash
npx tsc --noEmit 2>&1 | grep -E "ads/|sponsors|StickyAd" || echo clean
npx eslint src/components/ads src/hooks/useActiveBanner.ts
npx vitest run src/lib/__tests__/ad-banner-resolver.test.ts
```
Expected: `clean`; lint no errors; resolver tests pass.

- [ ] **Step 7: Verify the banner still renders from the DB**

With the dev server running, open `http://localhost:3010/matches?geo=ES` in a browser (or use Playwright). Confirm the AceProGrip banner shows pinned above the nav (now sourced from `ad_banners`), and `geo=PT` shows nothing (no global default yet).

- [ ] **Step 8: Commit**

```bash
git add src/components/ads src/hooks/useActiveBanner.ts
git commit -m "feat: resolve sticky banner from DB via useActiveBanner + pickBanner; drop code config"
```

---

## Task 6: Ops banner CRUD route

**Files:**
- Create: `apps/ops/src/app/api/internal/ad-banners/route.ts`

- [ ] **Step 1: Write the route**

```ts
// apps/ops/src/app/api/internal/ad-banners/route.ts
// Ad banner CRUD for the ops dashboard. Auth: Auth.js operator session.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

async function requireOperator() {
  const session = await auth()
  return session?.user?.isOperator ? null : NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

const COLS = 'id, name, country_code, slot, image_url, click_url, active, weight, created_at, updated_at'

export async function GET() {
  const deny = await requireOperator()
  if (deny) return deny
  const supabase = serviceClient()
  const { data, error } = await supabase.from('ad_banners').select(COLS).order('created_at', { ascending: false })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ banners: data ?? [] })
}

interface BannerInput {
  name?: string
  country_code?: string | null
  slot?: string
  image_url?: string
  click_url?: string
  active?: boolean
  weight?: number
}

function validate(b: BannerInput): string | null {
  if (!b.name || !b.name.trim()) return 'name is required'
  if (!b.image_url || !b.image_url.trim()) return 'image_url is required'
  if (!b.click_url || !b.click_url.trim()) return 'click_url is required'
  if (b.country_code != null && !/^[A-Z]{2}$/.test(b.country_code)) return 'country_code must be 2 uppercase letters or null'
  if (b.weight != null && (!Number.isInteger(b.weight) || b.weight < 1)) return 'weight must be an integer >= 1'
  return null
}

export async function POST(request: Request) {
  const deny = await requireOperator()
  if (deny) return deny
  const body = (await request.json().catch(() => ({}))) as BannerInput
  const err = validate(body)
  if (err) return Response.json({ error: err }, { status: 400 })
  const supabase = serviceClient()
  const { data, error } = await supabase
    .from('ad_banners')
    .insert({
      name: body.name!.trim(),
      country_code: body.country_code ?? null,
      slot: body.slot ?? 'sticky-bottom',
      image_url: body.image_url!.trim(),
      click_url: body.click_url!.trim(),
      active: body.active ?? true,
      weight: body.weight ?? 1,
    })
    .select(COLS)
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ banner: data })
}

export async function PATCH(request: Request) {
  const deny = await requireOperator()
  if (deny) return deny
  const body = (await request.json().catch(() => ({}))) as { id?: string; updates?: BannerInput }
  if (!body.id) return Response.json({ error: 'id is required' }, { status: 400 })
  const updates = { ...(body.updates ?? {}) } as Record<string, unknown>
  delete updates.id
  updates.updated_at = new Date().toISOString()
  const supabase = serviceClient()
  const { data, error } = await supabase.from('ad_banners').update(updates).eq('id', body.id).select(COLS).single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ banner: data })
}

export async function DELETE(request: Request) {
  const deny = await requireOperator()
  if (deny) return deny
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return Response.json({ error: 'id is required' }, { status: 400 })
  const supabase = serviceClient()
  const { error } = await supabase.from('ad_banners').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
```

- [ ] **Step 2: Type-check**

Run: `cd apps/ops && npx tsc --noEmit 2>&1 | grep ad-banners || echo clean; cd ../..`
Expected: `clean`

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/app/api/internal/ad-banners/route.ts
git commit -m "feat(ops): ad-banners CRUD route"
```

---

## Task 7: Ops network-config route

**Files:**
- Create: `apps/ops/src/app/api/internal/ad-network-config/route.ts`

- [ ] **Step 1: Write the route**

```ts
// apps/ops/src/app/api/internal/ad-network-config/route.ts
// Read/update the singleton AdSense/AdMob config. Auth: operator session.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

const COLS = 'key, web_enabled, adsense_publisher_id, adsense_slot_id, native_enabled, admob_ios_app_id, admob_android_app_id, admob_banner_unit_id, updated_at'

async function requireOperator() {
  const session = await auth()
  return session?.user?.isOperator ? null : NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

export async function GET() {
  const deny = await requireOperator()
  if (deny) return deny
  const supabase = serviceClient()
  const { data, error } = await supabase.from('ad_network_config').select(COLS).eq('key', 'default').maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ config: data })
}

const ALLOWED = [
  'web_enabled', 'adsense_publisher_id', 'adsense_slot_id',
  'native_enabled', 'admob_ios_app_id', 'admob_android_app_id', 'admob_banner_unit_id',
] as const

export async function PATCH(request: Request) {
  const deny = await requireOperator()
  if (deny) return deny
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const k of ALLOWED) if (k in body) updates[k] = body[k]
  const supabase = serviceClient()
  const { data, error } = await supabase.from('ad_network_config').update(updates).eq('key', 'default').select(COLS).single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ config: data })
}
```

- [ ] **Step 2: Type-check**

Run: `cd apps/ops && npx tsc --noEmit 2>&1 | grep ad-network-config || echo clean; cd ../..`
Expected: `clean`

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/app/api/internal/ad-network-config/route.ts
git commit -m "feat(ops): ad-network-config read/update route"
```

---

## Task 8: Ops banner image upload route

**Files:**
- Create: `apps/ops/src/app/api/internal/upload-ad-banner-image/route.ts`

- [ ] **Step 1: Write the route** (mirrors `upload-equipment-image`, bucket `ad-banners`)

```ts
// apps/ops/src/app/api/internal/upload-ad-banner-image/route.ts
// Multipart upload of an ad banner creative to the `ad-banners` bucket as
// banner-{bannerId}.{ext}; returns the public URL. Auth: operator session.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
const MAX_BYTES = 2 * 1024 * 1024
const EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg',
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const bannerId = String(form.get('bannerId') ?? '')
  const file = form.get('file')

  if (!isUuid(bannerId)) return Response.json({ error: 'bannerId must be a uuid' }, { status: 400 })
  if (!(file instanceof File)) return Response.json({ error: 'file is required' }, { status: 400 })
  if (!ALLOWED_MIME.has(file.type)) {
    return Response.json({ error: `Unsupported file type: ${file.type}` }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: `File too large (max ${MAX_BYTES} bytes)` }, { status: 400 })
  }

  const supabase = serviceClient()
  const filePath = `banner-${bannerId}.${EXT[file.type]}`
  const buffer = await file.arrayBuffer()
  const { error } = await supabase.storage
    .from('ad-banners')
    .upload(filePath, buffer, { contentType: file.type, upsert: true })
  if (error) return Response.json({ error: 'upload failed', detail: error.message }, { status: 500 })

  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/ad-banners/${filePath}`
  return Response.json({ url })
}
```

- [ ] **Step 2: Type-check**

Run: `cd apps/ops && npx tsc --noEmit 2>&1 | grep upload-ad-banner || echo clean; cd ../..`
Expected: `clean`

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/app/api/internal/upload-ad-banner-image/route.ts
git commit -m "feat(ops): upload-ad-banner-image route (ad-banners bucket)"
```

---

## Task 9: Ops "Ads" page, UI, and nav entry

**Files:**
- Create: `apps/ops/src/app/(app)/ads/page.tsx`
- Create: `apps/ops/src/app/(app)/ads/_components/AdsTab.tsx`
- Modify: `apps/ops/src/lib/sidebar-areas.tsx`

- [ ] **Step 1: Create the page wrapper**

```tsx
// apps/ops/src/app/(app)/ads/page.tsx
import AdsTab from './_components/AdsTab'

export const metadata = { title: 'Ad Banners · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default function AdsPage() {
  return <AdsTab />
}
```

- [ ] **Step 2: Create the AdsTab component**

```tsx
// apps/ops/src/app/(app)/ads/_components/AdsTab.tsx
'use client'

import { useEffect, useRef, useState } from 'react'

interface Banner {
  id: string
  name: string
  country_code: string | null
  slot: string
  image_url: string
  click_url: string
  active: boolean
  weight: number
}
interface NetworkConfig {
  web_enabled: boolean
  adsense_publisher_id: string | null
  adsense_slot_id: string | null
  native_enabled: boolean
  admob_ios_app_id: string | null
  admob_android_app_id: string | null
  admob_banner_unit_id: string | null
}

const EMPTY: Omit<Banner, 'id'> = {
  name: '', country_code: null, slot: 'sticky-bottom',
  image_url: '', click_url: '', active: true, weight: 1,
}

export default function AdsTab() {
  const [banners, setBanners] = useState<Banner[]>([])
  const [editing, setEditing] = useState<Banner | (Omit<Banner, 'id'> & { id?: string }) | null>(null)
  const [config, setConfig] = useState<NetworkConfig | null>(null)
  const [msg, setMsg] = useState<string>('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function refresh() {
    const [b, c] = await Promise.all([
      fetch('/api/internal/ad-banners').then((r) => r.json()),
      fetch('/api/internal/ad-network-config').then((r) => r.json()),
    ])
    setBanners(b.banners ?? [])
    setConfig(c.config ?? null)
  }
  useEffect(() => { void refresh() }, [])

  async function saveBanner() {
    if (!editing) return
    const isNew = !('id' in editing) || !editing.id
    const res = isNew
      ? await fetch('/api/internal/ad-banners', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editing) })
      : await fetch('/api/internal/ad-banners', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: (editing as Banner).id, updates: editing }) })
    const data = await res.json()
    if (!res.ok) { setMsg(data.error ?? 'save failed'); return }
    setMsg('Saved.')
    setEditing(null)
    await refresh()
  }

  async function uploadImage(file: File) {
    if (!editing || !('id' in editing) || !editing.id) {
      setMsg('Save the banner first, then upload an image.')
      return
    }
    setUploading(true)
    const fd = new FormData()
    fd.append('bannerId', editing.id)
    fd.append('file', file)
    const res = await fetch('/api/internal/upload-ad-banner-image', { method: 'POST', body: fd })
    const data = await res.json()
    setUploading(false)
    if (!res.ok) { setMsg(data.error ?? 'upload failed'); return }
    setEditing({ ...editing, image_url: data.url })
    setMsg('Image uploaded — click Save to persist.')
  }

  async function deleteBanner(id: string) {
    await fetch(`/api/internal/ad-banners?id=${id}`, { method: 'DELETE' })
    await refresh()
  }

  async function saveConfig() {
    if (!config) return
    const res = await fetch('/api/internal/ad-network-config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) })
    setMsg(res.ok ? 'Network config saved.' : 'Config save failed.')
  }

  const countryCounts = banners.reduce<Record<string, number>>((m, b) => {
    if (b.active) { const k = b.country_code ?? 'GLOBAL'; m[k] = (m[k] ?? 0) + 1 }
    return m
  }, {})

  return (
    <div className="ui-page">
      <h1>Ad Banners</h1>
      {msg && <p className="subtitle">{msg}</p>}

      <button onClick={() => setEditing({ ...EMPTY })}>+ New banner</button>

      <table>
        <thead><tr><th>Name</th><th>Country</th><th>Active</th><th>Weight</th><th>Preview</th><th></th></tr></thead>
        <tbody>
          {banners.map((b) => {
            const key = b.country_code ?? 'GLOBAL'
            const rotating = b.active && (countryCounts[key] ?? 0) > 1
            return (
              <tr key={b.id}>
                <td>{b.name}</td>
                <td>{b.country_code ?? 'Global'}{rotating ? ' (rotating)' : ''}</td>
                <td>{b.active ? 'Yes' : 'No'}</td>
                <td>{b.weight}</td>
                <td>{b.image_url ? <img src={b.image_url} alt={b.name} style={{ height: 24 }} /> : '—'}</td>
                <td>
                  <button onClick={() => setEditing(b)}>Edit</button>
                  <button onClick={() => deleteBanner(b.id)}>Delete</button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {editing && (
        <div style={{ border: '1px solid #333', padding: 12, marginTop: 12 }}>
          <h3>{('id' in editing && editing.id) ? 'Edit banner' : 'New banner'}</h3>
          <label>Name <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
          <label>Country (blank = Global default) <input value={editing.country_code ?? ''} onChange={(e) => setEditing({ ...editing, country_code: e.target.value.trim() ? e.target.value.toUpperCase() : null })} placeholder="ES" maxLength={2} /></label>
          <label>Click URL <input value={editing.click_url} onChange={(e) => setEditing({ ...editing, click_url: e.target.value })} /></label>
          <label>Weight <input type="number" min={1} value={editing.weight} onChange={(e) => setEditing({ ...editing, weight: Math.max(1, Number(e.target.value) || 1) })} /></label>
          <label><input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> Active</label>
          <div>
            Image: {editing.image_url ? <img src={editing.image_url} alt="" style={{ height: 24 }} /> : '— none —'}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f) }} />
            <button disabled={!('id' in editing && editing.id) || uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? 'Uploading…' : 'Upload image'}
            </button>
            {!('id' in editing && editing.id) && <span> (save first to enable upload)</span>}
          </div>
          <button onClick={saveBanner}>Save</button>
          <button onClick={() => setEditing(null)}>Cancel</button>
        </div>
      )}

      <h2 style={{ marginTop: 24 }}>Network Ads (AdSense / AdMob)</h2>
      <p className="subtitle">Stored for later — rendering is not wired yet.</p>
      {config && (
        <div style={{ border: '1px solid #333', padding: 12 }}>
          <h3>Web (AdSense)</h3>
          <label><input type="checkbox" checked={config.web_enabled} onChange={(e) => setConfig({ ...config, web_enabled: e.target.checked })} /> Enabled</label>
          <label>Publisher ID <input value={config.adsense_publisher_id ?? ''} onChange={(e) => setConfig({ ...config, adsense_publisher_id: e.target.value || null })} placeholder="ca-pub-…" /></label>
          <label>Ad slot ID <input value={config.adsense_slot_id ?? ''} onChange={(e) => setConfig({ ...config, adsense_slot_id: e.target.value || null })} /></label>
          <h3>Native (AdMob)</h3>
          <label><input type="checkbox" checked={config.native_enabled} onChange={(e) => setConfig({ ...config, native_enabled: e.target.checked })} /> Enabled</label>
          <label>iOS app ID <input value={config.admob_ios_app_id ?? ''} onChange={(e) => setConfig({ ...config, admob_ios_app_id: e.target.value || null })} /></label>
          <label>Android app ID <input value={config.admob_android_app_id ?? ''} onChange={(e) => setConfig({ ...config, admob_android_app_id: e.target.value || null })} /></label>
          <label>Banner ad-unit ID <input value={config.admob_banner_unit_id ?? ''} onChange={(e) => setConfig({ ...config, admob_banner_unit_id: e.target.value || null })} /></label>
          <button onClick={saveConfig}>Save network config</button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Add the nav entry**

In `apps/ops/src/lib/sidebar-areas.tsx`, find the `AREAS` array entry whose `pages` include `{ href: '/brands', ... }` and `{ href: '/partners', ... }` (the catalogs area). Add a page to that area's `pages` array:

```tsx
      { href: '/ads', label: 'Ad Banners' },
```
(Place it right after the `/partners` entry. If brands/partners live in different areas, add it to the same area as `/partners`.)

- [ ] **Step 4: Type-check + lint the ops app**

Run:
```bash
cd apps/ops && npx tsc --noEmit 2>&1 | grep -E "ads/|AdsTab|sidebar-areas" || echo clean; cd ../..
cd apps/ops && npx eslint "src/app/(app)/ads/_components/AdsTab.tsx" "src/app/(app)/ads/page.tsx" src/lib/sidebar-areas.tsx 2>&1 | tail -5; cd ../..
```
Expected: `clean`; lint no errors.

- [ ] **Step 5: Commit**

```bash
git add "apps/ops/src/app/(app)/ads" apps/ops/src/lib/sidebar-areas.tsx
git commit -m "feat(ops): Ads page (banner CRUD + upload + network config) and nav entry"
```

---

## Task 10: End-to-end local verification

**Files:** none (verification only)

- [ ] **Step 1: Unit + type + lint sweep (public app)**

Run:
```bash
npx vitest run src/lib/__tests__/ad-banner-resolver.test.ts
npx tsc --noEmit 2>&1 | grep -E "ads/|ad-banner|useActiveBanner|StickyAd" || echo clean
npx eslint src/components/ads src/hooks/useActiveBanner.ts src/lib/ad-banner-resolver.ts src/app/api/ads
```
Expected: tests pass; `clean`; lint clean.

- [ ] **Step 2: Run the ops app and exercise CRUD**

The ops app is a separate Next app. Start it (from `apps/ops/`, its own dev script/port — check `apps/ops/package.json`), sign in as an operator, open the **Ads** page. Then:
1. Create a banner: name "Test Global", country blank (Global), click URL `https://example.com`, Save.
2. Upload an image (PNG/SVG ≤2 MB) → confirm the preview updates and the public URL is a `…/storage/v1/object/public/ad-banners/banner-<id>.…` link → Save.
3. Confirm it appears in the table with country "Global".
4. Edit the AceProGrip ES row's weight to 2, Save.
5. Save the Network Ads config with a dummy `ca-pub-test` publisher id; reload the page and confirm it persisted.

- [ ] **Step 3: Verify live resolution on the public site**

With the public dev server running and a global-default banner now present:
1. `http://localhost:3010/matches?geo=ES` → AceProGrip (ES) banner shows.
2. `http://localhost:3010/matches?geo=PT` → the "Test Global" default banner shows (country fallback).
3. In ops, toggle the ES banner inactive, Save; wait ~60s (cache) or restart the public dev server; reload `?geo=ES` → it falls back to the global default.
4. Click a banner → confirm an `ad_clicks` row is written with `sponsor_id` = the banner's `id` (query Supabase).

- [ ] **Step 4: Final commit (only if verification fixes were needed)**

```bash
git add -A
git commit -m "chore: verification fixes for ops ad banners"
```
(Skip if nothing changed.)

---

## Self-Review

**Spec coverage:**
- `ad_banners` + `ad_network_config` + bucket + seed → Task 1 ✓
- Weighted `pickBanner` (country → global → none) → Task 2 ✓
- Cached `/api/ads/active` → Task 3 ✓
- `useActiveBanner` hook → Task 4 ✓
- Runtime swap off code config (SponsorCard/AdSlot/StickyAdBanner; delete sponsors.ts) → Task 5 ✓
- Ops banner CRUD → Task 6 ✓; network config → Task 7 ✓; image upload → Task 8 ✓
- Dedicated "Ads" page + nav entry → Task 9 ✓
- Multiple-per-country weighted rotation → Tasks 1 (no unique index, weight col), 2 (weighted pick), 9 (weight field + "rotating" hint) ✓
- AdSense/AdMob config-only (no rendering) → Tasks 1/7/9 store + edit; rendering deferred ✓
- Tracking now keyed by banner id → Task 5 (SponsorCard sends `sponsorId: banner.id`) ✓
- Local verification → Task 10 ✓

**Placeholder scan:** No TBD/TODO-as-work. Every code step has complete code.

**Type consistency:** `AdBanner`/`AdNetworkConfig`/`AdSlotId` defined in Task 2 are imported identically in Tasks 3, 4, 5. `pickBanner(banners, country, rand?)` signature matches its use in Task 5. The ops route response shapes (`{ banners }`, `{ banner }`, `{ config }`) match the `AdsTab` fetch handlers in Task 9. Tracking payload `{ slot, sponsorId, matchId }` matches the existing `/api/ads/{click,impression}` routes (unchanged) — `sponsorId` now carries the banner id, which those routes store in the existing `ad_clicks.sponsor_id` / `ad_impressions.sponsor_id` text columns.

**Note for implementer:** the `AdsTab` UI uses plain HTML elements for brevity; if the ops design-system primitives (`Panel`, `DataTable`, `Field`, `Button` from `apps/ops/src/components/ui/`) are expected for visual consistency, swap them in during Task 9 — the data flow is unchanged.

# Sponsor Ad Slots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reusable ad-slot placeholders that render a direct-sold sponsor (AceProGrip) in the matches feed (every 6 matches) and at the bottom of the match-detail Stats tab, with click + impression tracking and a stubbed AdSense/AdMob seam.

**Architecture:** A config-driven sponsor registry (`src/lib/sponsors.ts`) plus a pure injection-cadence helper (`src/lib/ad-injection.ts`) feed a client `AdSlot` component. `AdSlot` resolves the active sponsor and renders either `SponsorCard` (direct fill, with tracking) or `NetworkAdSlot` (stubbed network seam, renders nothing today). Engagement is logged through two fire-and-forget API routes backed by `ad_clicks` (rows) and `ad_impressions` (daily aggregate), mirroring the existing `racket_clicks` affiliate pattern.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Supabase (Postgres + RLS), Vitest, inline-style components matching the existing codebase conventions.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/lib/sponsors.ts` (create) | Sponsor type + registry + `getActiveSponsor(slot)` resolver. Pure. |
| `src/lib/__tests__/sponsors.test.ts` (create) | Unit tests for the resolver. |
| `src/lib/ad-injection.ts` (create) | Pure cadence math: `shouldInjectAdAfter(pos, cadence)` + `AD_FEED_CADENCE`. |
| `src/lib/__tests__/ad-injection.test.ts` (create) | Unit tests for the cadence math. |
| `supabase/migrations/20260601000000_ad_slots.sql` (create) | `ad_clicks`, `ad_impressions`, `increment_ad_impression()` fn, RLS. |
| `src/app/api/ads/click/route.ts` (create) | POST → insert `ad_clicks` row. |
| `src/app/api/ads/impression/route.ts` (create) | POST → rpc `increment_ad_impression`. |
| `src/components/ads/NetworkAdSlot.tsx` (create) | Stubbed network seam (AdSense/AdMob), renders null today. |
| `src/components/ads/SponsorCard.tsx` (create) | The direct-sponsor creative (feed + detail variants) + tracking. |
| `src/components/ads/AdSlot.tsx` (create) | Resolver: sponsor → `SponsorCard`, else `NetworkAdSlot`. |
| `public/sponsors/aceprogrip.svg` (create) | Placeholder creative asset (operator swaps later). |
| `src/components/MatchesTournamentGroup.tsx` (modify) | Inject `AdSlot` after every 6th global match. |
| `src/components/MatchesDayShell.tsx` (modify) | Thread cumulative match index to each group. |
| `src/app/[locale]/match/[id]/page.tsx` (modify) | Add `AdSlot` to the bottom of the recap/Stats tab. |

---

## Task 1: Sponsor config + resolver

**Files:**
- Create: `src/lib/sponsors.ts`
- Test: `src/lib/__tests__/sponsors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/sponsors.test.ts
import { describe, it, expect } from 'vitest'
import { getActiveSponsor, SPONSORS, type AdSlotId } from '@/lib/sponsors'

describe('getActiveSponsor', () => {
  it('returns AceProGrip for the feed-inline slot', () => {
    const s = getActiveSponsor('feed-inline')
    expect(s?.id).toBe('aceprogrip')
    expect(s?.url).toBe('https://www.aceprogrip.es/')
    expect(s?.creativeImage).toBe('/sponsors/aceprogrip.svg')
  })

  it('returns AceProGrip for the match-detail-stats slot', () => {
    expect(getActiveSponsor('match-detail-stats')?.id).toBe('aceprogrip')
  })

  it('returns null when no sponsor is assigned to the slot', () => {
    expect(getActiveSponsor('no-such-slot' as AdSlotId)).toBeNull()
  })

  it('every sponsor declares at least one slot', () => {
    for (const s of SPONSORS) expect(s.slots.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/sponsors.test.ts`
Expected: FAIL — cannot resolve module `@/lib/sponsors`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/sponsors.ts
// Config-driven sponsor registry. Sponsor *definitions* live in code (no DB);
// only engagement (clicks/impressions) is persisted. Adding a partner = add an
// entry here. Weighted rotation across multiple sponsors is a later extension.

export type AdSlotId = 'feed-inline' | 'match-detail-stats'

export interface Sponsor {
  id: string
  name: string
  /** Path under /public, e.g. '/sponsors/aceprogrip.svg'. */
  creativeImage: string
  headline: string
  ctaText: string
  url: string
  /** Which ad slots this sponsor is eligible to fill. */
  slots: AdSlotId[]
  /** Relative weight for future multi-sponsor rotation. */
  weight: number
}

export const SPONSORS: Sponsor[] = [
  {
    id: 'aceprogrip',
    name: 'AceProGrip',
    creativeImage: '/sponsors/aceprogrip.svg',
    headline: 'Grip like the pros',
    ctaText: 'Shop grips',
    url: 'https://www.aceprogrip.es/',
    slots: ['feed-inline', 'match-detail-stats'],
    weight: 1,
  },
]

/**
 * Resolve the active sponsor for a slot. Returns the first eligible sponsor
 * (single sponsor today). When none is assigned, returns null so the caller
 * can fall back to a network ad.
 */
export function getActiveSponsor(slot: AdSlotId): Sponsor | null {
  const candidates = SPONSORS.filter((s) => s.slots.includes(slot))
  return candidates.length > 0 ? candidates[0] : null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/sponsors.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/sponsors.ts src/lib/__tests__/sponsors.test.ts
git commit -m "feat: add sponsor registry + getActiveSponsor resolver"
```

---

## Task 2: Ad injection cadence helper

**Files:**
- Create: `src/lib/ad-injection.ts`
- Test: `src/lib/__tests__/ad-injection.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/ad-injection.test.ts
import { describe, it, expect } from 'vitest'
import { shouldInjectAdAfter, AD_FEED_CADENCE } from '@/lib/ad-injection'

describe('shouldInjectAdAfter', () => {
  it('defaults to a cadence of 6', () => {
    expect(AD_FEED_CADENCE).toBe(6)
  })

  it('injects after every 6th match (1-based position)', () => {
    expect(shouldInjectAdAfter(6)).toBe(true)
    expect(shouldInjectAdAfter(12)).toBe(true)
    expect(shouldInjectAdAfter(18)).toBe(true)
  })

  it('does not inject between the cadence boundaries', () => {
    expect(shouldInjectAdAfter(1)).toBe(false)
    expect(shouldInjectAdAfter(5)).toBe(false)
    expect(shouldInjectAdAfter(7)).toBe(false)
  })

  it('never injects at or below position 0', () => {
    expect(shouldInjectAdAfter(0)).toBe(false)
    expect(shouldInjectAdAfter(-6)).toBe(false)
  })

  it('honors a custom cadence', () => {
    expect(shouldInjectAdAfter(4, 4)).toBe(true)
    expect(shouldInjectAdAfter(6, 4)).toBe(false)
  })

  it('never injects when cadence is non-positive', () => {
    expect(shouldInjectAdAfter(6, 0)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/ad-injection.test.ts`
Expected: FAIL — cannot resolve module `@/lib/ad-injection`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/ad-injection.ts
// Pure cadence math for injecting feed-inline ads between match cards.
// Position is 1-based across the whole day's feed (not per tournament group).

export const AD_FEED_CADENCE = 6

export function shouldInjectAdAfter(
  position1Based: number,
  cadence: number = AD_FEED_CADENCE,
): boolean {
  if (position1Based <= 0) return false
  if (cadence <= 0) return false
  return position1Based % cadence === 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/ad-injection.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ad-injection.ts src/lib/__tests__/ad-injection.test.ts
git commit -m "feat: add feed ad-injection cadence helper"
```

---

## Task 3: Database migration

**Files:**
- Create: `supabase/migrations/20260601000000_ad_slots.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260601000000_ad_slots.sql
-- Sponsor ad-slot engagement tracking.
--   ad_clicks       : one row per sponsor click (mirrors racket_clicks)
--   ad_impressions  : daily aggregate counter per (slot, sponsor_id, date)
-- API routes write through the service key (bypasses RLS); no anon policies
-- are granted, so anon reads/writes are denied by default.

CREATE TABLE IF NOT EXISTS ad_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot TEXT NOT NULL,
  sponsor_id TEXT NOT NULL,
  match_id UUID REFERENCES matches(id) ON DELETE SET NULL,
  user_id UUID,
  locale TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_clicks_sponsor ON ad_clicks (sponsor_id);
CREATE INDEX IF NOT EXISTS idx_ad_clicks_slot ON ad_clicks (slot);
CREATE INDEX IF NOT EXISTS idx_ad_clicks_created ON ad_clicks (created_at);

CREATE TABLE IF NOT EXISTS ad_impressions (
  slot TEXT NOT NULL,
  sponsor_id TEXT NOT NULL,
  date DATE NOT NULL DEFAULT current_date,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (slot, sponsor_id, date)
);

-- Atomic upsert-increment used by /api/ads/impression.
CREATE OR REPLACE FUNCTION increment_ad_impression(p_slot TEXT, p_sponsor_id TEXT)
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO ad_impressions (slot, sponsor_id, date, count)
  VALUES (p_slot, p_sponsor_id, current_date, 1)
  ON CONFLICT (slot, sponsor_id, date)
  DO UPDATE SET count = ad_impressions.count + 1;
$$;

ALTER TABLE ad_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_impressions ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Apply the migration locally**

Run the migration against the Supabase project the dev server uses. Use the same mechanism the team already uses for other migrations (e.g. `supabase db push`, the Supabase SQL editor, or `psql` against the project). If unsure, paste the SQL into the Supabase dashboard SQL editor and run it.

Expected: `ad_clicks`, `ad_impressions` tables and `increment_ad_impression` function created with no errors.

- [ ] **Step 3: Verify the function works**

In the Supabase SQL editor run:

```sql
select increment_ad_impression('feed-inline', 'aceprogrip');
select * from ad_impressions;
```

Expected: one row `('feed-inline','aceprogrip', <today>, 1)`. Run the `select increment_...` line again → `count` becomes 2.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260601000000_ad_slots.sql
git commit -m "feat: add ad_clicks + ad_impressions tables and increment fn"
```

---

## Task 4: Tracking API routes

**Files:**
- Create: `src/app/api/ads/click/route.ts`
- Create: `src/app/api/ads/impression/route.ts`

- [ ] **Step 1: Write the click route**

```ts
// src/app/api/ads/click/route.ts
// Public endpoint — logs a sponsor ad click. Fire-and-forget insert; the
// browser already has the destination URL from sponsor config, so this route
// only records the event and returns { ok: true }.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase'
import { auth } from '@/auth'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const slot: string | undefined = body?.slot
  const sponsorId: string | undefined = body?.sponsorId
  const matchId: string | undefined = body?.matchId

  if (!slot || !sponsorId) {
    return NextResponse.json({ error: 'Missing slot or sponsorId' }, { status: 400 })
  }

  const session = await auth()
  const userId = session?.user?.id ?? null
  const cookieStore = await cookies()
  const locale = cookieStore.get('NEXT_LOCALE')?.value ?? null

  const supabase = createServerClient()
  void supabase.from('ad_clicks').insert({
    slot,
    sponsor_id: sponsorId,
    match_id: matchId ?? null,
    user_id: userId,
    locale,
  })

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Write the impression route**

```ts
// src/app/api/ads/impression/route.ts
// Public endpoint — increments today's impression counter for (slot, sponsor).
// Fire-and-forget; uses the atomic increment_ad_impression RPC.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const slot: string | undefined = body?.slot
  const sponsorId: string | undefined = body?.sponsorId

  if (!slot || !sponsorId) {
    return NextResponse.json({ error: 'Missing slot or sponsorId' }, { status: 400 })
  }

  const supabase = createServerClient()
  void supabase.rpc('increment_ad_impression', {
    p_slot: slot,
    p_sponsor_id: sponsorId,
  })

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Verify both routes locally**

Start the dev server (`npm run dev`) if not running, then:

```bash
curl -s -X POST http://localhost:3002/api/ads/impression \
  -H 'Content-Type: application/json' \
  -d '{"slot":"feed-inline","sponsorId":"aceprogrip"}'

curl -s -X POST http://localhost:3002/api/ads/click \
  -H 'Content-Type: application/json' \
  -d '{"slot":"feed-inline","sponsorId":"aceprogrip","matchId":null}'
```

Expected: both return `{"ok":true}`. Confirm in Supabase that `ad_impressions.count` incremented and a new `ad_clicks` row exists. Also confirm a missing-field call returns 400:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3002/api/ads/click \
  -H 'Content-Type: application/json' -d '{}'
```
Expected: `400`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/ads/click/route.ts src/app/api/ads/impression/route.ts
git commit -m "feat: add ad click + impression tracking routes"
```

---

## Task 5: NetworkAdSlot stub (the network seam)

**Files:**
- Create: `src/components/ads/NetworkAdSlot.tsx`

- [ ] **Step 1: Write the stub component**

```tsx
// src/components/ads/NetworkAdSlot.tsx
'use client'

import type { AdSlotId } from '@/lib/sponsors'

/**
 * Programmatic-network fill seam. Rendered by AdSlot when no direct sponsor is
 * assigned to a slot. Renders nothing today — this is the integration point
 * for AdSense (web) / AdMob (native Capacitor).
 *
 * When wiring a network later:
 *   - Detect platform (web vs Capacitor native).
 *   - TODO(ads-network): web  -> mount an AdSense unit keyed by `slot`.
 *   - TODO(ads-network): native -> mount an AdMob banner keyed by `slot`.
 * Keep this component's external contract (props) stable so AdSlot does not
 * need to change when networks are added.
 */
export function NetworkAdSlot(_props: {
  slot: AdSlotId
  variant: 'feed' | 'detail'
}) {
  return null
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no new errors from this file. (Unused-prop lint is avoided by the `_props` prefix.)

- [ ] **Step 3: Commit**

```bash
git add src/components/ads/NetworkAdSlot.tsx
git commit -m "feat: add stubbed NetworkAdSlot network seam"
```

---

## Task 6: SponsorCard creative + tracking

**Files:**
- Create: `src/components/ads/SponsorCard.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/ads/SponsorCard.tsx
'use client'

import { useEffect, useRef } from 'react'
import type { AdSlotId, Sponsor } from '@/lib/sponsors'

function trackImpression(slot: AdSlotId, sponsorId: string) {
  void fetch('/api/ads/impression', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slot, sponsorId }),
    keepalive: true,
  }).catch(() => {})
}

function trackClick(slot: AdSlotId, sponsorId: string, matchId?: string) {
  void fetch('/api/ads/click', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slot, sponsorId, matchId: matchId ?? null }),
    keepalive: true,
  }).catch(() => {})
}

const BLUE = '#3b82f6'
const MUTED = '#6B7280'

export function SponsorCard({
  sponsor,
  slot,
  variant,
  matchId,
}: {
  sponsor: Sponsor
  slot: AdSlotId
  variant: 'feed' | 'detail'
  matchId?: string
}) {
  // Fire one impression per mount. Guard against React 18/19 StrictMode
  // double-invocation in dev.
  const impressionFired = useRef(false)
  useEffect(() => {
    if (impressionFired.current) return
    impressionFired.current = true
    trackImpression(slot, sponsor.id)
  }, [slot, sponsor.id])

  const isFeed = variant === 'feed'

  return (
    <a
      href={sponsor.url}
      target="_blank"
      rel="sponsored noopener noreferrer"
      onClick={() => trackClick(slot, sponsor.id, matchId)}
      data-ad-slot={slot}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        textDecoration: 'none',
        color: 'inherit',
        background: 'linear-gradient(135deg, #1e293b, #0b1220)',
        border: '1px solid rgba(59,130,246,0.35)',
        borderRadius: 12,
        padding: isFeed ? '12px 14px' : '10px 12px',
        margin: isFeed ? '6px 8px' : '12px',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={sponsor.creativeImage}
        alt={sponsor.name}
        width={isFeed ? 44 : 36}
        height={isFeed ? 44 : 36}
        style={{ borderRadius: 8, flexShrink: 0, objectFit: 'cover' }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 8,
            letterSpacing: 1,
            textTransform: 'uppercase',
            color: MUTED,
            fontWeight: 700,
          }}
        >
          Sponsored
        </div>
        <div style={{ fontSize: isFeed ? 14 : 13, fontWeight: 800, color: '#f8fafc', marginTop: 2 }}>
          {sponsor.name}
        </div>
        <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 1 }}>{sponsor.headline}</div>
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color: BLUE, flexShrink: 0 }}>
        {sponsor.ctaText} {'→'}
      </span>
    </a>
  )
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add src/components/ads/SponsorCard.tsx
git commit -m "feat: add SponsorCard creative with click/impression tracking"
```

---

## Task 7: AdSlot resolver component

**Files:**
- Create: `src/components/ads/AdSlot.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/ads/AdSlot.tsx
'use client'

import { getActiveSponsor, type AdSlotId } from '@/lib/sponsors'
import { SponsorCard } from './SponsorCard'
import { NetworkAdSlot } from './NetworkAdSlot'

/**
 * Placeholder ad slot. Resolves the active direct sponsor for `slot`; if one
 * exists it renders the SponsorCard creative, otherwise it falls through to
 * the (currently stubbed) NetworkAdSlot seam for AdSense/AdMob.
 */
export function AdSlot({
  slot,
  variant,
  context,
}: {
  slot: AdSlotId
  variant: 'feed' | 'detail'
  context?: { matchId?: string }
}) {
  const sponsor = getActiveSponsor(slot)
  if (sponsor) {
    return (
      <SponsorCard
        sponsor={sponsor}
        slot={slot}
        variant={variant}
        matchId={context?.matchId}
      />
    )
  }
  return <NetworkAdSlot slot={slot} variant={variant} />
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ads/AdSlot.tsx
git commit -m "feat: add AdSlot resolver (sponsor or network seam)"
```

---

## Task 8: Placeholder creative asset

**Files:**
- Create: `public/sponsors/aceprogrip.svg`

- [ ] **Step 1: Create the placeholder SVG**

```svg
<!-- public/sponsors/aceprogrip.svg -->
<svg xmlns="http://www.w3.org/2000/svg" width="88" height="88" viewBox="0 0 88 88">
  <rect width="88" height="88" rx="12" fill="#0b1220"/>
  <rect x="1" y="1" width="86" height="86" rx="11" fill="none" stroke="#3b82f6" stroke-width="2"/>
  <text x="44" y="50" font-family="Arial, sans-serif" font-size="22" font-weight="800"
        fill="#f8fafc" text-anchor="middle">APG</text>
</svg>
```

Note for the operator: this is a placeholder. Drop the real AceProGrip creative at `public/sponsors/aceprogrip.svg` (or replace with a `.png`/`.jpg` and update `creativeImage` in `src/lib/sponsors.ts`).

- [ ] **Step 2: Commit**

```bash
git add public/sponsors/aceprogrip.svg
git commit -m "feat: add placeholder AceProGrip sponsor creative"
```

---

## Task 9: Wire AdSlot into the matches feed

The feed renders tournament groups; each group maps its own matches (active section, then a divider, then finished section). To get a *global* every-6 cadence we pass each group the cumulative count of matches rendered in all prior groups (`adStartIndex`), then compute each match's 1-based global position inside the group.

**Files:**
- Modify: `src/components/MatchesTournamentGroup.tsx`
- Modify: `src/components/MatchesDayShell.tsx`

- [ ] **Step 1: Add imports + `adStartIndex` prop to MatchesTournamentGroup**

In `src/components/MatchesTournamentGroup.tsx`, change the React import (line 24) and add the new imports below the existing `bucketDayMatches` import (line 35):

Old:
```ts
import { useState } from 'react'
```
New:
```ts
import { Fragment, useState } from 'react'
```

Add after line 36 (`import { isPremierTier } from '@/lib/tournament-tier'`):
```ts
import { AdSlot } from '@/components/ads/AdSlot'
import { shouldInjectAdAfter } from '@/lib/ad-injection'
```

- [ ] **Step 2: Add the `adStartIndex` prop to the component signature**

Old (line 184):
```tsx
export default function MatchesTournamentGroup({ group }: { group: TournamentGroupData }) {
```
New:
```tsx
export default function MatchesTournamentGroup({
  group,
  adStartIndex = 0,
}: {
  group: TournamentGroupData
  /** Cumulative match count rendered in all prior groups — drives the global
   *  every-6 feed-ad cadence. */
  adStartIndex?: number
}) {
```

- [ ] **Step 3: Inject the ad after qualifying matches in the ACTIVE section**

Old (lines 404–418):
```tsx
        {active.map(m => {
          const s = bucketStatus(m.status)
          const status: 'live' | 'upcoming' | 'finished' = s ?? 'upcoming'
          return (
            <MatchEntry
              key={m.id}
              match={m}
              status={status}
              locale={group.locale}
              userTz={group.userTz}
              tournamentLevel={group.tournamentLevel}
              dayBucketIso={group.dayBucketIso}
            />
          )
        })}
```
New:
```tsx
        {active.map((m, i) => {
          const s = bucketStatus(m.status)
          const status: 'live' | 'upcoming' | 'finished' = s ?? 'upcoming'
          const globalPos = adStartIndex + i + 1
          return (
            <Fragment key={m.id}>
              <MatchEntry
                match={m}
                status={status}
                locale={group.locale}
                userTz={group.userTz}
                tournamentLevel={group.tournamentLevel}
                dayBucketIso={group.dayBucketIso}
              />
              {shouldInjectAdAfter(globalPos) && (
                <AdSlot slot="feed-inline" variant="feed" />
              )}
            </Fragment>
          )
        })}
```

- [ ] **Step 4: Inject the ad after qualifying matches in the FINISHED section**

Old (lines 471–481):
```tsx
        {finished.map(m => (
          <MatchEntry
            key={m.id}
            match={m}
            status="finished"
            locale={group.locale}
            userTz={group.userTz}
            tournamentLevel={group.tournamentLevel}
            dayBucketIso={group.dayBucketIso}
          />
        ))}
```
New:
```tsx
        {finished.map((m, j) => {
          const globalPos = adStartIndex + active.length + j + 1
          return (
            <Fragment key={m.id}>
              <MatchEntry
                match={m}
                status="finished"
                locale={group.locale}
                userTz={group.userTz}
                tournamentLevel={group.tournamentLevel}
                dayBucketIso={group.dayBucketIso}
              />
              {shouldInjectAdAfter(globalPos) && (
                <AdSlot slot="feed-inline" variant="feed" />
              )}
            </Fragment>
          )
        })}
```

- [ ] **Step 5: Thread `adStartIndex` from the shell**

In `src/components/MatchesDayShell.tsx`, replace the `groups.map(...)` block (lines 545–563) so a running total is accumulated before each group.

Old:
```tsx
              {groups.map((g) => (
                <MatchesTournamentGroup
                  key={g.tournamentId}
                  group={{
                    tournamentId: g.tournamentId,
                    tournamentName: g.tournamentName,
                    tournamentLevel: g.tournamentLevel,
                    tournamentCountry: g.tournamentCountry,
                    tournamentStartsAt: g.tournamentStartsAt,
                    tournamentEndsAt: g.tournamentEndsAt,
                    tournamentStatus: g.tournamentStatus,
                    matches: g.matches as never,
                    isPremier: g.isPremier,
                    locale,
                    userTz,
                    dayBucketIso: activeIso,
                  }}
                />
              ))}
```
New:
```tsx
              {(() => {
                let running = 0
                return groups.map((g) => {
                  const adStartIndex = running
                  running += g.matches.length
                  return (
                    <MatchesTournamentGroup
                      key={g.tournamentId}
                      adStartIndex={adStartIndex}
                      group={{
                        tournamentId: g.tournamentId,
                        tournamentName: g.tournamentName,
                        tournamentLevel: g.tournamentLevel,
                        tournamentCountry: g.tournamentCountry,
                        tournamentStartsAt: g.tournamentStartsAt,
                        tournamentEndsAt: g.tournamentEndsAt,
                        tournamentStatus: g.tournamentStatus,
                        matches: g.matches as never,
                        isPremier: g.isPremier,
                        locale,
                        userTz,
                        dayBucketIso: activeIso,
                      }}
                    />
                  )
                })
              })()}
```

- [ ] **Step 6: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Verify in the running app**

With `npm run dev` running, open `http://localhost:3002/matches` (use the desktop/mobile preview) on a day with **≥6 matches across tournaments**.
Expected: an AceProGrip card appears after the 6th match card (and again after the 12th), styled as a feed card. Note the known limitation: client-side match filters hide individual cards via CSS but do not re-flow ad positions — acceptable for v1.

- [ ] **Step 8: Commit**

```bash
git add src/components/MatchesTournamentGroup.tsx src/components/MatchesDayShell.tsx
git commit -m "feat: inject feed sponsor ad every 6 matches"
```

---

## Task 10: Wire AdSlot into the match-detail Stats tab

**Files:**
- Modify: `src/app/[locale]/match/[id]/page.tsx`

- [ ] **Step 1: Add the import**

Near the other component imports at the top of `src/app/[locale]/match/[id]/page.tsx`, add:
```ts
import { AdSlot } from '@/components/ads/AdSlot'
```

- [ ] **Step 2: Render the ad at the bottom of the recap/Stats panel**

Old (lines 1137–1139):
```tsx
                {t.key === 'recap' && isFinished && (
                  <MatchStatsView matchId={match.id} breaks={breaks} />
                )}
```
New:
```tsx
                {t.key === 'recap' && (
                  <>
                    {isFinished && <MatchStatsView matchId={match.id} breaks={breaks} />}
                    <AdSlot
                      slot="match-detail-stats"
                      variant="detail"
                      context={{ matchId: match.id }}
                    />
                  </>
                )}
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Verify in the running app**

With the dev server running, open a finished match detail page, select the **Stats** tab, and scroll to the bottom.
Expected: the slimmer AceProGrip banner renders below the stats. Clicking it opens `https://www.aceprogrip.es/` in a new tab.

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/match/[id]/page.tsx"
git commit -m "feat: add sponsor ad to match-detail Stats tab"
```

---

## Task 11: End-to-end local verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit test suite for the new modules**

Run:
```bash
npx vitest run src/lib/__tests__/sponsors.test.ts src/lib/__tests__/ad-injection.test.ts
```
Expected: all tests pass.

- [ ] **Step 2: Type-check + lint**

Run:
```bash
npx tsc --noEmit && npm run lint
```
Expected: no new errors introduced by this feature.

- [ ] **Step 3: Verify tracking end-to-end in the browser**

With `npm run dev` running:
1. Load `/matches` on a busy day; confirm the feed ad renders after match 6.
2. Open browser devtools → Network. Confirm a `POST /api/ads/impression` fires when the ad scrolls into render.
3. Click the ad; confirm a `POST /api/ads/click` fires and `aceprogrip.es` opens in a new tab.
4. In Supabase, confirm `ad_impressions.count` incremented and a new `ad_clicks` row exists (with `slot='feed-inline'`, `sponsor_id='aceprogrip'`).
5. Repeat the click check on the match-detail Stats tab (`slot='match-detail-stats'`, `match_id` populated).

Expected: all five confirmations pass. This satisfies the project's "test locally always" rule.

- [ ] **Step 4: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "chore: verification fixes for sponsor ad slots"
```
(Skip if no changes were needed.)

---

## Self-Review

**Spec coverage:**
- Sponsor config (`src/lib/sponsors.ts`) → Task 1 ✓
- `AdSlot` component → Task 7 ✓
- `SponsorCard` (feed + detail variants) → Task 6 ✓
- `NetworkAdSlot` seam → Task 5 ✓
- `ad_clicks` + `ad_impressions` migrations → Task 3 ✓
- `/api/ads/click` + `/api/ads/impression` → Task 4 ✓
- Feed wiring, every 6, global cadence → Tasks 2 + 9 ✓
- Detail wiring, bottom of Stats tab → Task 10 ✓
- Placeholder asset → Task 8 ✓
- Local verification (per user rule) → Tasks 9.7, 10.4, 11 ✓
- Out-of-scope items (real AdSense/AdMob, consent, ops UI, rotation) → correctly deferred; seam left in Task 5 ✓

**Placeholder scan:** No TBD/TODO-as-work. The only `TODO(ads-network)` markers are intentional seam documentation in the deferred-by-design stub, not unfinished plan steps.

**Type consistency:** `AdSlotId` and `Sponsor` defined in Task 1 are used identically in Tasks 5–7. `getActiveSponsor` (Task 1), `shouldInjectAdAfter`/`AD_FEED_CADENCE` (Task 2) match their usages in Tasks 7 and 9. `AdSlot` props (`slot`, `variant`, `context`) are consistent across Tasks 7, 9, 10. Tracking route bodies (`{ slot, sponsorId, matchId }` / `{ slot, sponsorId }`) match the `fetch` payloads in `SponsorCard` (Task 6).

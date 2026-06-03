# Sponsor Ad Slots — Design

**Date:** 2026-06-01
**Status:** Approved (design)

## Goal

Add reusable ad-slot placeholders to the app that today render a **direct-sold sponsor** (first partner: [AceProGrip](https://www.aceprogrip.es/)), with a clean seam to drop in programmatic networks later — **Google AdSense** on the web/PWA and **AdMob** in the native Capacitor app.

The placeholder is the *slot*; the *fill* is swappable. This iteration ships direct-sponsor fill + tracking only. Network integration is deferred but the architecture leaves a ready seam.

## Placements (validated via mockups)

1. **Matches feed** — an ad card injected **between match cards, after every 6th match** across the day's feed (global cadence, not per-tournament-group).
2. **Match detail page** — an ad placed at the **bottom of the Stats/recap tab content** (inside the tab panel, below existing content).

## Components

### 1. Sponsor config — `src/lib/sponsors.ts`

Typed, config-driven. No DB for sponsor *definitions* (those live in code; only engagement is in the DB).

```ts
export type AdSlotId = 'feed-inline' | 'match-detail-stats'

export interface Sponsor {
  id: string                 // 'aceprogrip'
  name: string               // 'AceProGrip'
  creativeImage: string      // '/sponsors/aceprogrip.png'
  headline: string           // 'Grip like the pros'
  ctaText: string            // 'Shop grips'
  url: string                // 'https://www.aceprogrip.es/'
  slots: AdSlotId[]          // which slots this sponsor fills
  weight: number             // for future weighted rotation (single sponsor now)
}

export const SPONSORS: Sponsor[]
export function getActiveSponsor(slot: AdSlotId): Sponsor | null
```

`getActiveSponsor` returns the (single, for now) sponsor assigned to a slot. Weighted rotation across multiple sponsors is a trivial later extension using `weight`.

AceProGrip seeded. Creative asset lives at `public/sponsors/aceprogrip.*` — the real asset is supplied by the operator; implementation drops a placeholder image so the slot renders.

### 2. `AdSlot` — `src/components/ads/AdSlot.tsx` (client component)

The placeholder primitive.

Props:
- `slot: AdSlotId`
- `variant: 'feed' | 'detail'` — visual styling for the placement context
- `context?: { matchId?: string }` — passed to tracking

Logic:
1. `getActiveSponsor(slot)` → if a direct sponsor exists, render **`SponsorCard`**.
2. Else render **`NetworkAdSlot`** (the seam — see below).

Client component because it owns the click handler and the on-mount impression effect.

### 3. `SponsorCard` — `src/components/ads/SponsorCard.tsx`

The visible creative. "Sponsored" label, brand image + headline, CTA button. Two visual variants:
- `feed` — full card matching match-card styling, sits in the feed list.
- `detail` — slimmer banner for the bottom of the Stats tab.

Interaction:
- Renders as a link to `sponsor.url` with `target="_blank"` and `rel="sponsored noopener noreferrer"`.
- On click → fire `POST /api/ads/click` (fire-and-forget) **then** allow navigation.
- On mount → fire `POST /api/ads/impression` once (fire-and-forget).

### 4. `NetworkAdSlot` — `src/components/ads/NetworkAdSlot.tsx` (seam, stubbed)

Renders nothing visible today. Documents the integration seam with a clean interface:
- Detect platform (web vs native Capacitor).
- Web → mount AdSense unit for the slot.
- Native → mount AdMob banner for the slot.

A single `TODO(ads-network)` comment marks where each network mounts. No accounts, scripts, or consent flows in this iteration.

### 5. Tracking (mirrors the `racket_clicks` affiliate pattern)

Two migrations under `supabase/migrations/`:

- **`ad_clicks`** — one row per click:
  `id uuid pk`, `slot text`, `sponsor_id text`, `match_id uuid null`, `locale text null`, `created_at timestamptz default now()`.
- **`ad_impressions`** — daily aggregate to avoid row explosion:
  `slot text`, `sponsor_id text`, `date date`, `count int`, with unique `(slot, sponsor_id, date)`; impression writes do an upsert that increments `count`.

API routes (server, use service key, fire-and-forget from client):
- `POST /api/ads/click` — body `{ slot, sponsorId, matchId? }`, inserts an `ad_clicks` row (reads `locale` from cookie/header).
- `POST /api/ads/impression` — body `{ slot, sponsorId }`, upsert-increments today's `ad_impressions` row.

Both are best-effort: failures never block UI or navigation.

## Wiring into placements

### Feed (every 6, global cadence)
The feed renders tournament groups, each mapping its own matches. To get a *global* every-6 cadence, thread a running match index:
- [MatchesDayShell.tsx](../../../src/components/MatchesDayShell.tsx) computes a cumulative match count before each group and passes a `startIndex` to each `MatchesTournamentGroup`.
- [MatchesTournamentGroup.tsx](../../../src/components/MatchesTournamentGroup.tsx) uses `startIndex + localIndex` as the global position; after every card whose global position is a multiple of 6, it renders `<AdSlot slot="feed-inline" variant="feed" />`.

The cadence constant (`6`) lives in one place for easy tuning.

### Detail (bottom of Stats tab)
In [match/[id]/page.tsx](../../../src/app/[locale]/match/[id]/page.tsx), append `<AdSlot slot="match-detail-stats" variant="detail" context={{ matchId }} />` to the end of the Stats/recap tab panel content.

## Testing / verification

Per project convention, **verify locally in the running app** before calling this done:
- `npm run dev` (localhost:3002).
- Feed: open a day with ≥6 matches, confirm an AceProGrip card appears after the 6th match and styling matches the feed.
- Detail: open a match, scroll the Stats tab, confirm the slimmer sponsor banner renders at the bottom.
- Click the sponsor → confirm it opens `aceprogrip.es` in a new tab and an `ad_clicks` row is written.
- Confirm an `ad_impressions` row increments on view.
- Unit-test the pure pieces: `getActiveSponsor` resolution and the every-6 injection index math.

## Out of scope (deferred — seam left ready)

- Real AdSense (web) / AdMob (native) integration, including the Capacitor AdMob plugin and native rebuild.
- Consent / GDPR / ATT flows.
- Ops UI to manage sponsors (config-in-code is fine for one partner).
- Weighted multi-sponsor rotation (data model supports it via `weight`).
- Frequency capping / per-user suppression / premium ad-free tier.

# Match Share + OG Image — Design Spec

**Date:** 2026-04-05
**Status:** Approved
**Concept:** B — Brand + Match Info with Player Photos

---

## Overview

Add a share button to the match detail page header (top-right) that uses `navigator.share()` to open the native share sheet. Generate a dynamic OG image per match using Next.js built-in `ImageResponse` so WhatsApp/Telegram/Twitter show a rich preview card.

## Share Button

- **Location:** Match detail header (`src/app/match/[id]/page.tsx`), top-right corner
- **Icon:** Share/export SVG icon (box with upward arrow), 20px, white
- **Style:** 36x36px button, same styling as back button
- **Behavior:**
  1. Calls `navigator.share({ title, text, url })` with match summary
  2. Falls back to `navigator.clipboard.writeText(url)` + toast on desktop/unsupported browsers
  3. URL: `https://padelnachos.com/match/{id}`

## OG Image Layout (1200x630)

Match card style — pairs stacked vertically, scores on the right:

```
┌─────────────────────────────────────────────┐
│              [PadelNachos Logo]              │
│                                             │
│  [LIVE] (only if live)                      │
│                                             │
│  🇪🇸 [avatar][avatar]  Bellver / Merino  6 6 │
│           vs                                │
│  🇮🇹 [avatar][avatar]  Vano / Clasca     3 4 │
│                                             │
│  FIP GOLD ALMATY · SEMI-FINAL · APR 5       │
│                              padelnachos.com │
└─────────────────────────────────────────────┘
```

**Layout details:**
- Dark background (`#0A0A0A` → `#1A1A1A` gradient)
- PadelNachos logo centered at top (small, 28px height)
- Each pair row: flags + overlapping avatar circles (44px) + player last names + set scores right-aligned
- Winner pair: green name text (`#7ED321`), green avatar border
- Loser pair: muted name text (`#6B7280`), gray avatar border
- Live matches: red "LIVE" badge, red scores
- Finished matches: green scores for winner, muted for loser
- Tournament + round + date at bottom center
- "padelnachos.com" watermark bottom-right

**Data needed:**
- Player names (last name only for brevity), country flags, avatar_url
- Set scores
- Tournament name, round
- Match status (live/finished)
- Winner pair (1 or 2)

## API Route

**`src/app/api/og/match/[id]/route.tsx`** — Edge runtime

Uses Next.js built-in `ImageResponse` from `next/og`:
1. Fetch match data from Supabase (server-side, service key)
2. Render JSX → image using `ImageResponse`
3. Return 1200x630 PNG
4. Cache with `Cache-Control: public, max-age=60` (1 min for live, longer for finished)

## Match Page Metadata

The match page is currently `'use client'`. To add dynamic OG metadata:
- Create `src/app/match/[id]/layout.tsx` (server component) with `generateMetadata`
- Fetch match data server-side and return OG tags:
  - `og:title`: "Bellver/Merino won 6-3, 6-4 — FIP Gold Almaty SF"
  - `og:description`: "Follow live padel scores on PadelNachos"
  - `og:image`: `/api/og/match/{id}`
  - `twitter:card`: "summary_large_image"

## Native Share

```typescript
const shareMatch = async () => {
  const url = `https://padelnachos.com/match/${match.id}`
  const title = `${pair1Label} vs ${pair2Label}`
  const text = isFinished
    ? `${winnerLabel} won ${scoreText} — ${tournament.name} ${match.round}`
    : isLive
      ? `LIVE: ${pair1Label} vs ${pair2Label} ${scoreText} — ${tournament.name}`
      : `${pair1Label} vs ${pair2Label} — ${tournament.name} ${match.round}`

  if (navigator.share) {
    await navigator.share({ title, text, url })
  } else {
    await navigator.clipboard.writeText(url)
    // Show brief toast: "Link copied!"
  }
}
```

## Out of Scope

- Share from match cards on other pages (only match detail page for now)
- Custom share image download/save
- Share to specific platforms (Twitter, Instagram stories)
- Share tournaments or player profiles

# Match-detail Where-to-Watch banner implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone Where-to-Watch banner on `/match/[id]` (positioned right below the hero) that opens the same popup we shipped on the matches list and tournament pages, scoped to the match's tournament circuit. Replaces the existing `MatchStreamCard`.

**Architecture:** New thin `<WhereToWatchBanner>` trigger component that re-uses the existing `<WhereToWatchPopup>` machinery. The match page (client component) gains a small `useEffect` to fetch live channels / broadcasters / channel meta scoped to this match's circuit — same pattern as the tournament page. `MatchStreamCard`, `resolveStreamForMatch`, and the `NEXT_PUBLIC_FIP_STREAMS_ENABLED` flag are removed.

**Tech Stack:** Next.js 16 App Router (client component for the match page), React 19, Supabase client, next-intl (5 locales).

Spec: [`docs/superpowers/specs/2026-05-16-match-detail-where-to-watch-banner.md`](../specs/2026-05-16-match-detail-where-to-watch-banner.md).

---

## File structure

**New file:**

```
src/components/where-to-watch/
  WhereToWatchBanner.tsx           — full-width trigger row + popup orchestration
```

**Modified files:**

```
src/app/[locale]/match/[id]/page.tsx
  — Remove: streamTier state, resolveStreamForMatch effect, <MatchStreamCard> import + JSX
  — Add:    WTW state (4 setState) + tournamentChannelAbbr useMemo + fetch useEffect
  — Add:    <WhereToWatchBanner /> JSX at the same line where MatchStreamCard was

src/messages/{en,es,pt,it,fr}.json
  — Append 3 keys under whereToWatch: bannerLiveCount, bannerWatchIn, bannerWhere
```

**Deleted files:**

```
src/components/MatchStreamCard.tsx
```

`src/lib/fip-stream-resolver.ts` becomes unreferenced after MatchStreamCard is gone, but the cleanup is a follow-up (it's used by no other consumer; safe to delete in a separate PR if desired).

---

## Task 1: Build `WhereToWatchBanner`

**Files:**
- Create: `src/components/where-to-watch/WhereToWatchBanner.tsx`

- [ ] **Step 1: Write the component**

```typescript
// src/components/where-to-watch/WhereToWatchBanner.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  buildGroups,
  type LiveChannel,
  type BroadcasterRow,
  type ChannelMeta,
} from '@/lib/where-to-watch/group-builder'
import { WhereToWatchPopup } from './WhereToWatchPopup'

const LOCALSTORAGE_KEY = 'preferred-country'

// Same iso2 → display-name map used in ChannelGroup / Popup. Duplicated
// here so the banner can render "Watch in {region}" copy without
// reaching back into the popup. ~36 entries — small enough to inline.
const ISO2_TO_NAME: Record<string, string> = {
  es: 'Spain', it: 'Italy', fr: 'France', de: 'Germany', gb: 'United Kingdom',
  us: 'United States', ar: 'Argentina', mx: 'Mexico', br: 'Brazil',
  pt: 'Portugal', nl: 'Netherlands', be: 'Belgium', se: 'Sweden', no: 'Norway',
  dk: 'Denmark', fi: 'Finland', pl: 'Poland', ch: 'Switzerland', at: 'Austria',
  ie: 'Ireland', gr: 'Greece', tr: 'Turkey', il: 'Israel', sa: 'Saudi Arabia',
  ae: 'UAE', qa: 'Qatar', eg: 'Egypt', ma: 'Morocco', za: 'South Africa',
  jp: 'Japan', kr: 'South Korea', cn: 'China', in: 'India', au: 'Australia',
}

const ORANGE = '#F5A623'
const CLIP_BANNER = 'polygon(0% 4%, 99% 0%, 100% 96%, 1% 100%)'
const CLIP_CTA = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

const HIDDEN_STATUSES = new Set(['finished', 'walkover', 'retired'])

export interface WhereToWatchBannerProps {
  matchStatus: string | null | undefined
  liveChannels: LiveChannel[]
  broadcasters: BroadcasterRow[]
  channelsMeta: ChannelMeta[]
  todayCircuits: string[]
  geoCountry: string | null
}

export function WhereToWatchBanner({
  matchStatus, liveChannels, broadcasters, channelsMeta, todayCircuits, geoCountry,
}: WhereToWatchBannerProps) {
  const t = useTranslations('whereToWatch')
  const [open, setOpen] = useState(false)

  const [preferredCountry, setPreferredCountry] = useState<string | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const stored = window.localStorage.getItem(LOCALSTORAGE_KEY)
      if (stored) setPreferredCountry(stored.toLowerCase())
    } catch { /* localStorage disabled */ }
  }, [])

  const effectiveCountry = preferredCountry ?? geoCountry

  const groups = useMemo(
    () => buildGroups({
      liveChannels,
      broadcasters,
      channelsMeta,
      todayCircuits: new Set(todayCircuits),
      country: effectiveCountry,
    }),
    [liveChannels, broadcasters, channelsMeta, todayCircuits, effectiveCountry],
  )

  // Hide on finished/walkover/retired matches OR when there's nothing to show.
  if (matchStatus && HIDDEN_STATUSES.has(matchStatus)) return null
  if (groups.length === 0) return null

  const liveStreamCount = groups.reduce((sum, g) => sum + g.liveStreams.length, 0)
  const broadcasterCount = groups.reduce((sum, g) => sum + g.broadcasters.length, 0)
  const regionName = effectiveCountry
    ? (ISO2_TO_NAME[effectiveCountry.toLowerCase()] ?? effectiveCountry.toUpperCase())
    : null

  // State-aware copy.
  let copy: React.ReactNode
  if (liveStreamCount > 0) {
    copy = t('bannerLiveCount', { count: liveStreamCount })
  } else if (broadcasterCount > 0 && regionName) {
    copy = t('bannerWatchIn', { region: regionName })
  } else {
    copy = t('bannerWhere')
  }

  const handleCountryChange = (iso2: string) => {
    setPreferredCountry(iso2.toLowerCase())
    try {
      window.localStorage.setItem(LOCALSTORAGE_KEY, iso2.toLowerCase())
    } catch { /* ignore */ }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('eyebrow')}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          width: 'calc(100% - 32px)',
          margin: '0 16px 14px',
          padding: '10px 12px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          clipPath: CLIP_BANNER,
          color: '#D8D8DD',
          fontFamily: 'inherit',
          cursor: 'pointer',
          textAlign: 'left',
          touchAction: 'manipulation',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        {/* YT-style play glyph — matches the pill + popup eyebrow */}
        <span style={{
          width: 20, height: 14, borderRadius: 2.5, background: '#FF0000',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <svg viewBox="0 0 24 24" width="9" height="9" fill="#fff" aria-hidden="true">
            <path d="M8 5v14l11-7z"/>
          </svg>
        </span>

        <span style={{ flex: 1, fontSize: 11, color: '#D8D8DD', lineHeight: 1.35 }}>
          {copy}
        </span>

        <span style={{
          fontSize: 10, fontWeight: 800, letterSpacing: 0.5,
          textTransform: 'uppercase',
          color: ORANGE,
          padding: '5px 9px',
          border: `1px solid rgba(245,166,35,0.4)`,
          clipPath: CLIP_CTA,
          flexShrink: 0,
        }}>
          {t('watchCta')} →
        </span>
      </button>

      <WhereToWatchPopup
        open={open}
        onClose={() => setOpen(false)}
        groups={groups}
        country={effectiveCountry}
        isAutoDetected={!preferredCountry && !!geoCountry}
        onCountryChange={handleCountryChange}
      />
    </>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "WhereToWatchBanner"`
Expected: empty output.

- [ ] **Step 3: Commit**

```bash
git add src/components/where-to-watch/WhereToWatchBanner.tsx
git commit -m "feat(where-to-watch): WhereToWatchBanner trigger for match detail"
```

---

## Task 2: Add i18n strings (5 locales)

**Files:**
- Modify: `src/messages/{en,es,pt,it,fr}.json`

- [ ] **Step 1: Append to `en.json` inside the `whereToWatch` namespace**

Locate the closing `}` of the `whereToWatch` block in `src/messages/en.json` and add right before it:

```json
,
    "bannerLiveCount": "Watch live · {count, plural, one {# option} other {# options}}",
    "bannerWatchIn": "Watch in {region}",
    "bannerWhere": "Where to watch"
```

- [ ] **Step 2: Append to `es.json`**

```json
,
    "bannerLiveCount": "Ver en directo · {count, plural, one {# opción} other {# opciones}}",
    "bannerWatchIn": "Ver en {region}",
    "bannerWhere": "Dónde ver"
```

- [ ] **Step 3: Append to `pt.json`**

```json
,
    "bannerLiveCount": "Assistir ao vivo · {count, plural, one {# opção} other {# opções}}",
    "bannerWatchIn": "Assistir em {region}",
    "bannerWhere": "Onde assistir"
```

- [ ] **Step 4: Append to `it.json`**

```json
,
    "bannerLiveCount": "Guarda live · {count, plural, one {# opzione} other {# opzioni}}",
    "bannerWatchIn": "Guarda in {region}",
    "bannerWhere": "Dove guardare"
```

- [ ] **Step 5: Append to `fr.json`**

```json
,
    "bannerLiveCount": "Regarder en direct · {count, plural, one {# option} other {# options}}",
    "bannerWatchIn": "Regarder en {region}",
    "bannerWhere": "Où regarder"
```

- [ ] **Step 6: Verify all 5 JSON files still parse**

Run:
```bash
for f in src/messages/{en,es,pt,it,fr}.json; do node -e "require('./$f')" && echo "$f OK"; done
```
Expected: each line ends with "OK".

- [ ] **Step 7: Commit**

```bash
git add src/messages/
git commit -m "i18n(where-to-watch): banner copy in 5 locales"
```

---

## Task 3: Wire data fetch into match page

**Files:**
- Modify: `src/app/[locale]/match/[id]/page.tsx`

The match page is a client component. Mirror the pattern already in `src/app/[locale]/(app)/tournaments/[id]/page.tsx` (V3Overview sub-component) — read the geo-country cookie client-side, fetch the three queries in parallel via Supabase, set local state. No server-side wiring needed.

- [ ] **Step 1: Add imports near the top**

After the existing imports (around line 42 where `MatchStreamCard` is currently imported), add:

```typescript
import { WhereToWatchBanner } from '@/components/where-to-watch/WhereToWatchBanner'
import { levelToChannelAbbr } from '@/lib/where-to-watch/circuit-map'
import type { LiveChannel as WtwLiveChannel, BroadcasterRow, ChannelMeta } from '@/lib/where-to-watch/group-builder'
```

The `WtwLiveChannel` alias avoids colliding with anything else in scope (the page is large; defensive).

- [ ] **Step 2: Add WTW state + circuit lookup**

Inside the `MatchPage` component body, near the other `useState` declarations (around line 75 where `streamTier` lives today), add:

```typescript
const [wtwBroadcasters, setWtwBroadcasters] = useState<BroadcasterRow[]>([])
const [wtwLiveChannels, setWtwLiveChannels] = useState<WtwLiveChannel[]>([])
const [wtwChannelsMeta, setWtwChannelsMeta] = useState<ChannelMeta[]>([])
const [wtwGeoCountry, setWtwGeoCountry] = useState<string | null>(null)
```

After the `match` state is settled (after the existing `useEffect` blocks that load match data), add the circuit lookup:

```typescript
const tournamentChannelAbbr = useMemo(
  () => levelToChannelAbbr((match as any)?.tournament?.level),
  [match],
)
```

- [ ] **Step 3: Add the WTW fetch useEffect**

After the circuit lookup, add:

```typescript
useEffect(() => {
  const cookieMatch = typeof document !== 'undefined'
    ? document.cookie.match(/(?:^|;\s*)geo-country=([^;]*)/)
    : null
  const country = cookieMatch?.[1]?.toLowerCase() || null
  setWtwGeoCountry(country)

  if (!tournamentChannelAbbr) {
    setWtwBroadcasters([])
    setWtwLiveChannels([])
    setWtwChannelsMeta([])
    return
  }

  let cancelled = false
  const STALE_MS = 30 * 60 * 1000

  const broadcastersP = supabase
    .from('broadcasters')
    .select('id, name, url, logo_url, is_free, display_order, country_iso2, channel_id')
    .eq('active', true)
    .not('channel_id', 'is', null)
    .order('country_iso2', { ascending: true })
    .order('display_order', { ascending: true })
    .order('is_free', { ascending: false })

  const liveChannelsP = supabase
    .from('youtube_channel_live')
    .select(`video_id, title, channel:youtube_channels!inner(id, name, abbreviation, color_hex, display_order)`)
    .gt('last_seen_at', new Date(Date.now() - STALE_MS).toISOString())
    .eq('channel.is_active', true)
    .eq('channel.abbreviation', tournamentChannelAbbr)

  const channelsMetaP = supabase
    .from('youtube_channels')
    .select('id, name, abbreviation, color_hex, display_order')
    .eq('is_active', true)
    .eq('abbreviation', tournamentChannelAbbr)

  Promise.all([broadcastersP, liveChannelsP, channelsMetaP]).then(([bRes, lcRes, cmRes]) => {
    if (cancelled) return
    setWtwBroadcasters(((bRes.data ?? []) as BroadcasterRow[]))
    const liveRows = (lcRes.data ?? []).map((r: any) => {
      const ch = Array.isArray(r.channel) ? r.channel[0] : r.channel
      if (!ch) return null
      return {
        videoId: r.video_id as string,
        title: r.title as string,
        channel: {
          id: ch.id as string,
          name: ch.name as string,
          abbreviation: ch.abbreviation as string,
          colorHex: ch.color_hex as string,
          displayOrder: ch.display_order as number,
        },
      }
    }).filter((x: WtwLiveChannel | null): x is WtwLiveChannel => x !== null)
    setWtwLiveChannels(liveRows)
    const channelsMeta = (cmRes.data ?? []).map((r: any) => ({
      id: r.id as string,
      name: r.name as string,
      abbreviation: r.abbreviation as string,
      colorHex: r.color_hex as string,
      displayOrder: r.display_order as number,
    }))
    setWtwChannelsMeta(channelsMeta)
  }).catch(err => {
    if (!cancelled) console.warn('[match:wtw] fetch failed:', err)
  })

  return () => { cancelled = true }
}, [tournamentChannelAbbr])
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -E "match/\[id\]/page" | head -5
```
Expected: empty output (other pre-existing scripts/*.ts errors are fine and unrelated).

- [ ] **Step 5: Commit**

```bash
git add 'src/app/[locale]/match/[id]/page.tsx'
git commit -m "feat(match-detail): client-side fetch for Where-to-Watch banner data"
```

---

## Task 4: Render the banner in place of `MatchStreamCard`

**Files:**
- Modify: `src/app/[locale]/match/[id]/page.tsx`

- [ ] **Step 1: Find the current MatchStreamCard render**

Run: `grep -n "MatchStreamCard\|FIP_STREAMS_ENABLED" src/app/\[locale\]/match/\[id\]/page.tsx`

You'll see something like (around line 940-947):

```tsx
{/* ── Stream card (FIP-tier matches only) ──────────────────── */}
{process.env.NEXT_PUBLIC_FIP_STREAMS_ENABLED === 'true' && streamTier && (
  <div /* container */>
    <MatchStreamCard
      streamTier={streamTier}
      matchCourt={match.court}
      matchScheduledAt={match.scheduled_at}
    />
  </div>
)}
```

- [ ] **Step 2: Replace with the new banner**

Substitute that whole block with:

```tsx
{/* ── Where to Watch banner ────────────────────────────────── */}
<WhereToWatchBanner
  matchStatus={match.status}
  liveChannels={wtwLiveChannels}
  broadcasters={wtwBroadcasters}
  channelsMeta={wtwChannelsMeta}
  todayCircuits={tournamentChannelAbbr ? [tournamentChannelAbbr] : []}
  geoCountry={wtwGeoCountry}
/>
```

The banner self-hides when there's nothing to show — no outer conditional needed.

- [ ] **Step 3: Remove the now-unused `streamTier` state + effect + imports**

In the same file:

1. Remove the `useState` line `const [streamTier, setStreamTier] = useState<StreamTier | null>(null)` (around line 75).
2. Remove the `useEffect` block that calls `resolveStreamForMatch(...)` and `setStreamTier(...)` (around line 240).
3. Remove the imports for `MatchStreamCard`, `resolveStreamForMatch`, and `StreamTier`:

```typescript
// REMOVE THESE THREE LINES:
import { MatchStreamCard } from '@/components/MatchStreamCard'
import { resolveStreamForMatch } from '@/lib/fip-stream-resolver'
import type { StreamTier } from '@/lib/fip-stream-resolver'
```

Use `grep -n "MatchStreamCard\|resolveStreamForMatch\|StreamTier\|streamTier" src/app/\[locale\]/match/\[id\]/page.tsx` to confirm zero remaining references.

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -E "match/\[id\]/page" | head -5
```
Expected: empty.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/[locale]/match/[id]/page.tsx'
git commit -m "feat(match-detail): replace MatchStreamCard with WhereToWatchBanner"
```

---

## Task 5: Delete `MatchStreamCard`

**Files:**
- Delete: `src/components/MatchStreamCard.tsx`

- [ ] **Step 1: Confirm no remaining consumers**

```bash
grep -rn "MatchStreamCard" src/ --include="*.tsx" --include="*.ts"
```
Expected: only matches inside `src/components/MatchStreamCard.tsx` itself.

- [ ] **Step 2: Delete the file**

```bash
git rm src/components/MatchStreamCard.tsx
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -E "MatchStreamCard" | head -5
```
Expected: empty.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(match-detail): remove superseded MatchStreamCard"
```

> Note: `src/lib/fip-stream-resolver.ts` and the `NEXT_PUBLIC_FIP_STREAMS_ENABLED` env var are still unreferenced after this. They can be removed in a separate cleanup PR; the spec explicitly leaves them out of scope.

---

## Task 6: Manual verification

This is a check, not code — no commits. Run the dev server (`npm run dev`, port 3002) and walk through each state. Use a `geo-country` cookie set via DevTools (`document.cookie = 'geo-country=es; path=/; max-age=86400'`) to simulate region detection in local dev.

- [ ] **State 1 — Spanish user, Premier YT live:** Navigate to a live Premier match (e.g. find a live `p1` match via `/matches/today`). The banner should appear right below the hero with copy "Ver en directo · 2 opciones" (or whatever the live count is). Tap → popup opens with the PP block (LIVE chip, YT streams, Movistar/Red Bull nested).

- [ ] **State 2 — Spanish user, Premier match scheduled, no current YT:** Navigate to a future Premier match. Banner shows "Ver en {region}" if broadcasters exist, OR "Dónde ver" otherwise. Tap → popup with PP block (no LIVE chip, "Assista Premier Padel em:" + broadcasters).

- [ ] **State 3 — US user (no broadcasters), Premier YT live:** Set `geo-country=us`. Banner shows "Ver en directo · N opciones" (live YT only). Popup: PP block with streams, no regional section.

- [ ] **State 4 — FIP live match, no broadcasters anywhere:** Find a live FIP match. Banner shows "Ver en directo · 1 opción" with the FIP YT stream in the popup.

- [ ] **State 5 — Finished match:** Banner hidden.

- [ ] **State 6 — Walkover or retired match:** Banner hidden (status in HIDDEN_STATUSES set).

- [ ] **State 7 — No tournament level:** Banner hidden (no `tournamentChannelAbbr`).

- [ ] **State 8 — Region picker reachable:** Tap the banner → popup → footer "Alterar →" or "Set your region →" → picker opens with search + flags + alphabetical list.

- [ ] **State 9 — Replaces MatchStreamCard:** Confirm no double-render at the same vertical slot. Grep `MatchStreamCard` in `src/` returns nothing.

- [ ] **State 10 — Locale switch:** Switch URL to `/es/match/...` and `/pt/match/...` — banner copy localizes correctly with the new keys.

---

## Self-review notes

- **Spec coverage:**
  - Position below the hero → Task 4 (replaces MatchStreamCard at the same slot).
  - Hide rule (finished/walkover/retired + empty groups) → encoded in `WhereToWatchBanner` (Task 1).
  - State-aware copy (3 variants + hide) → Task 1 + Task 2 (i18n keys).
  - Data fetch (client-side, scoped to circuit) → Task 3.
  - MatchStreamCard removal → Tasks 4 + 5.
  - i18n in 5 locales → Task 2.
  - Verification across 8+ states → Task 6.
- **Type consistency:** `WtwLiveChannel` alias is the same shape as `LiveChannel` from group-builder (just renamed locally to avoid potential naming collision in the large match page file). All other types (`BroadcasterRow`, `ChannelMeta`) are imported as-is.
- **No placeholders.** Each code step has the full source. No "similar to …" cross-references.
- **`watchCta` re-use:** The banner CTA pulls `whereToWatch.watchCta` (the YouTube row "VER"/"WATCH" key shipped in the previous PR). No new key needed.

# Rank-updated nudge — design

**Date:** 2026-05-18
**Status:** approved, ready for plan
**Visual reference:** Variant A from `.superpowers/brainstorm/.../variants.html` (rendered during the 2026-05-18 brainstorm session)

## Problem

When the FIP rankings refresh on Monday mornings (now driven by the padelgod worker, see [2026-05-18-padelgod-rankings-migration-design.md](2026-05-18-padelgod-rankings-migration-design.md)), there's no in-app signal that the rankings page has fresh data. A user has to remember to check, or they re-open the app and assume the data they saw last week is still current.

The bottom nav already carries two badges — unread-news count on `Home`, live-match count on `Scores` — both of which are **counters** rendered as small red squares. Rankings refresh once a week and don't have a meaningful count to surface, so a counter shape is the wrong primitive.

## Decision

Add a small **green dot** in the `RANKING` tab icon corner whenever the latest published ranking week is newer than the user's last visit to `/rankings`. No number, no animation. Auto-clears on visit.

The dot is visually distinct from the existing red unread-count badges — green (matches the active-tab color) instead of red, solid dot instead of square pill — so users learn its semantic ("something new this week") at a glance.

## Scope

**In:**

1. New hook `src/hooks/useRankingsLastVisit.ts` — mirrors [`useFeedLastVisit`](../../../src/hooks/useFeedLastVisit.ts). Stores `rankings_last_visited_week` in localStorage as a `"YYYY-WW"` ISO-year/week string. Exposes `useRankingsLastVisit(): string | null` and `markRankingsVisited(week: string): void`.
2. New Supabase probe in [`BottomNavV3.tsx`](../../../src/components/nav/BottomNavV3.tsx)'s existing `fetchBadges` (60-second poll). Reads the latest published week from `player_ranking_snapshots`.
3. New `showRankingNudge` derived state in `BottomNavV3.tsx`: `latestRankingsWeek !== null && latestRankingsWeek !== lastVisitedWeek`.
4. New conditional in the tab render block — alongside the existing badges for `scores` and `home` — that renders a `.v3-nav-rank-dot` element when `tab.key === 'ranking' && showRankingNudge`.
5. New CSS rule for `.v3-nav-rank-dot` in the inline `NAV_STYLES` constant of `BottomNavV3.tsx`.
6. Call `markRankingsVisited(latestRankingsWeek)` from the `/rankings` page on mount (paralleling `markFeedVisited()` on `/feed`).
7. One i18n key `nav.rankUpdated` shipped in all 5 locales for the dot's `aria-label`.

**Out:**

- Per-user push notification when a new week publishes (separate feature; see roadmap).
- Highlighting which players' ranks changed in the rankings list (already covered by the existing `ranking_move` field on player rows + arrow indicators in the table).
- Animation, pulse, sparkle, or text labels on the dot (rejected during brainstorm in favour of the quietest variant).
- Counting "changed since last visit" — would surface a number, defeats the point of an ambient indicator.

## Visual treatment

```css
.v3-nav-rank-dot {
  position: absolute;
  top: 0px;
  right: 1px;
  width: 8px;
  height: 8px;
  background: #7ED321;   /* same green as active tab + ink-bar */
  border-radius: 50%;
  box-shadow: 0 0 0 2px rgba(10,10,10,0.96);   /* dark ring so dot pops against icon strokes */
  z-index: 3;
}
```

No keyframe animation — the dot just appears/disappears with the parent's render cycle. `prefers-reduced-motion` users see identical behaviour (nothing to suppress).

The dot lives inside the existing `<div className="v3-nav-icon">` wrapper so it inherits the icon's positioning and animations (the "kick" animation on tab activation also bounces the dot, which is desired — feels native).

## Data flow

```
                    Mondays at FIP publish time
                              │
                              ▼
              padelgod worker writes new rows to
              public.player_ranking_snapshots
                  (source='padelgod-fip')
                              │
                              ▼
   BottomNavV3.tsx fetchBadges polls every 60s:
     ┌──────────────────────────────────────────┐
     │ SELECT year, week                        │
     │ FROM player_ranking_snapshots            │
     │ WHERE source = 'padelgod-fip'            │
     │ ORDER BY year DESC, week DESC            │
     │ LIMIT 1                                  │
     └──────────────────────────────────────────┘
                              │
                              ▼
              latestRankingsWeek = "2026-22"
                              │
                              ▼
       useRankingsLastVisit() → "2026-21"  (last visit)
                              │
                              ▼
              showRankingNudge = (different)
                              │
                              ▼
           BottomNav renders .v3-nav-rank-dot
                              │
                              ▼
       User taps RANKING → /rankings page mounts
                              │
                              ▼
       markRankingsVisited("2026-22")  →  localStorage updates
                              │
                              ▼
       Next render: latest === lastVisited  →  dot hidden
```

**Probe cost:** one indexed query per minute against `player_ranking_snapshots` (already indexed on `(player_id, type, year, week)` for the upsert conflict key, plus the secondary indexes used by the rankings page). Negligible.

**Result freshness:** worst case the dot appears ≤60s after a fresh padelgod write lands. Acceptable since the rankings page itself is a manual user action — they don't need real-time push semantics.

## Hook contract

`src/hooks/useRankingsLastVisit.ts` mirrors `useFeedLastVisit.ts`:

```ts
const KEY = 'rankings_last_visited_week'
const EVENT = 'rankings-last-visit-changed'

function getSnapshot(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(KEY)
}

function getServerSnapshot(): null {
  return null
}

function subscribe(callback: () => void): () => void { /* same as feed hook */ }

export function useRankingsLastVisit(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

export function markRankingsVisited(week: string): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(KEY, week)
  window.dispatchEvent(new CustomEvent(EVENT, { detail: week }))
}
```

**Difference from `useFeedLastVisit`:**
- Returns `string | null` instead of `string` — first-time users have no stored value. Returning `null` means the comparison `latestRankingsWeek !== lastVisitedWeek` is `true` whenever the API has any week populated, so the dot shows once for new users until they tap RANKING. Desired onboarding nudge.
- `markRankingsVisited` takes the explicit `week` argument rather than writing `now()` — the stored value is the year-week ISO string, not a timestamp.

## Component changes

[`src/components/nav/BottomNavV3.tsx`](../../../src/components/nav/BottomNavV3.tsx):

1. Import `useRankingsLastVisit`.
2. Add a `latestRankingsWeek` state alongside `liveCount` and `newsCount` (around line 138).
3. Extend `fetchBadges` (around line 285) to add the third Supabase query and update `latestRankingsWeek`.
4. Derive `showRankingNudge = latestRankingsWeek != null && latestRankingsWeek !== lastVisitedWeek`.
5. In the tab render block (around line 374), add:
   ```tsx
   {tab.key === 'ranking' && showRankingNudge && (
     <div className="v3-nav-rank-dot" aria-label={t('rankUpdated')} />
   )}
   ```
6. Add the `.v3-nav-rank-dot` CSS rule to `NAV_STYLES`.

[`src/app/[locale]/(app)/rankings/page.tsx`](../../../src/app/[locale]/(app)/rankings/page.tsx) — already a `'use client'` component:

Call `markRankingsVisited(currentWeek)` in a `useEffect` that fires once on mount, where `currentWeek` is the ISO year-week string of the latest snapshot the page has rendered. The component already fetches rankings; the year/week is derivable from the response. Format as `"${year}-${String(week).padStart(2, '0')}"` to match the BottomNav probe's string format.

## i18n

One new key in `src/messages/{en,es,pt,it,fr}.json`:

```json
{
  "nav": {
    "rankUpdated": "Rankings updated"      // en
    "rankUpdated": "Ranking actualizado"   // es
    "rankUpdated": "Ranking atualizado"    // pt
    "rankUpdated": "Classifica aggiornata" // it
    "rankUpdated": "Classement mis à jour" // fr
  }
}
```

Used only as the dot's `aria-label` for screen readers. Not rendered visually.

## Testing

**Unit:**
- `src/hooks/__tests__/useRankingsLastVisit.test.ts` (new file):
  - First read returns `null` when localStorage is empty
  - `markRankingsVisited('2026-21')` writes the value + fires the custom event
  - Subsequent read returns `'2026-21'`
  - SSR `getServerSnapshot()` returns `null`

**Manual:**
- Open the app on a fresh browser profile → dot appears on RANKING tab
- Tap RANKING → dot disappears, doesn't return on re-open
- Manually clear `rankings_last_visited_week` in DevTools → dot reappears
- Simulate a "new week" by manually setting localStorage to an older week string → dot reappears

**Visual:**
- Mockup `variants.html` (already exists in the brainstorm session dir) is the canonical visual reference for Variant A.

## Why this stays small

Zero new tables, zero new API routes, one new hook (≤40 lines mirroring `useFeedLastVisit`), one extra Supabase query per minute (indexed, cheap), ~15 lines added to `BottomNavV3.tsx`, ~10 lines of CSS, one i18n key in 5 files, one new test file.

## Open questions

None — all design choices were locked during the 2026-05-18 brainstorm session:

- **Trigger semantics:** "new this week" (week-level ambient indicator), not a counter or time-bounded fresh indicator.
- **Visual:** Variant A — 8px solid green dot, no animation, no text.
- **State source:** localStorage-backed hook mirroring `useFeedLastVisit`'s shape.
- **Latest-week probe:** piggybacks on the existing `fetchBadges` 60s poll in `BottomNavV3.tsx` rather than a separate hook/interval.

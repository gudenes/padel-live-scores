# Swipe Tab Navigation — Design Spec

**Date:** 2026-04-13
**Status:** Approved for implementation

## Overview

Add horizontal snap-swipe navigation to internal page tabs. Content follows the user's finger in real-time and snaps to the nearest tab on release. Scroll position is preserved per tab. Tap navigation continues to work as a fallback.

**Core goal:** Make tab switching feel native and effortless — like swiping between iOS home screens.

## Scope

### In scope
- **Matches page** tabs: Live / Upcoming / Results
- **Match detail page** subtabs: Players / H2H / Stats (+ Recap when finished)
- Reusable hook + wrapper component for both pages
- Scroll position preservation per tab
- Tab bar indicator follows swipe in real-time
- `prefers-reduced-motion` support

### Out of scope
- Bottom nav swipe (Home/Matches/Following/Feed — stays tap-only)
- Tournament detail tabs
- Rankings tabs
- Prefetching adjacent tab data
- External gesture libraries

## Architecture

### Reusable hook: `useSwipeTabs`

Location: `src/hooks/useSwipeTabs.ts`

Encapsulates all touch tracking logic. Returns everything the wrapper component needs.

```typescript
interface UseSwipeTabsOptions {
  count: number              // number of tabs
  initial?: number           // starting tab index (default 0)
  onTabChange?: (idx: number) => void  // callback when tab changes (for lazy fetch etc)
  threshold?: number         // swipe distance as fraction of viewport width (default 0.2)
}

interface UseSwipeTabsReturn {
  currentTab: number
  goTo: (idx: number) => void
  trackStyle: React.CSSProperties        // applied to the sliding track div
  handlers: {                             // spread onto the viewport div
    onTouchStart: (e: TouchEvent) => void
    onTouchMove: (e: TouchEvent) => void
    onTouchEnd: () => void
  }
  progress: number    // 0-based float indicating position (e.g. 1.3 = 30% between tab 1 and 2)
  isDragging: boolean
}
```

**State machine:**
```
idle → touchstart → detecting (first 8px) → swiping | scrolling
swiping → touchend → snapping (CSS transition) → idle
scrolling → touchend → idle (no action)
```

### Gesture handling

**Angle lock (critical for scroll conflict prevention):**
- On `touchstart`: record `startX`, `startY`
- On `touchmove`: until locked, accumulate delta
- When `abs(dx) > 8 OR abs(dy) > 8`: lock direction
  - `abs(dx) > abs(dy)` → horizontal swipe mode, call `e.preventDefault()` to block scroll
  - Otherwise → vertical scroll mode, ignore all further moves
- This 8px dead zone prevents accidental triggers

**Snap threshold:**
- On `touchend`: if `abs(totalDx) > viewport_width * 0.2` → advance to next/prev tab
- Otherwise → snap back to current tab

**Edge clamping:**
- Can't swipe left past tab 0 or right past last tab
- Resistance: allow up to 30% of viewport overshoot with 0.3x dampening, then snap back

**CSS transition for snap:**
- `transition: transform 350ms cubic-bezier(0.25, 0.1, 0.25, 1)`
- Removed during active drag (`isDragging` flag)

**Reduced motion:**
- Check `window.matchMedia('(prefers-reduced-motion: reduce)').matches`
- If true: skip transition, set transform instantly on `goTo`

### Wrapper component: `SwipeTabView`

Location: `src/components/SwipeTabView.tsx`

```typescript
interface SwipeTabViewProps {
  tabs: { key: string; label: string }[]
  currentTab: number
  onTabChange: (idx: number) => void
  children: React.ReactNode[]  // one child per tab panel
  preserveScroll?: boolean     // default true
}
```

**Renders:**
1. Tab bar with buttons — active tab has green underline that slides with swipe progress
2. Viewport div (overflow: hidden) with touch handlers
3. Track div (display: flex, width: N * 100%) containing all panels
4. Each panel is 100% / N width, `overflow-y: auto` for independent scrolling

**Scroll preservation:**
- On tab change: save `scrollTop` of departing panel to a `Map<number, number>`
- On tab arrive: restore `scrollTop` from the map (or 0 if first visit)
- Implemented via refs to each panel div

**Tab bar indicator animation:**
- The green underline `div` uses `transform: translateX()` driven by `progress` from the hook
- During drag: indicator slides smoothly following the finger
- On snap: indicator transitions with the same 350ms cubic-bezier

### Integration points

#### Matches page (`src/app/(app)/matches/page.tsx`)

Current state:
- `const [tab, setTab] = useState<'live' | 'upcoming' | 'results'>('live')`
- Tab buttons with `onClick={() => setTab(t.key)}`
- Content conditionally rendered: `{tab === 'live' && <LiveContent />}`

Changes:
- Replace conditional rendering with `SwipeTabView` wrapping all 3 content sections
- All 3 panels always mounted (required for swipe peek), but only the active one gets data subscriptions
- `setTab` called from `onTabChange` callback
- Auto-tab-selection on load (live → upcoming → results) still works via `goTo` in useEffect
- Gender filter (M/W/All) and league filter stay above the swipe area (not swipeable)

#### Match detail page (`src/app/match/[id]/page.tsx`)

Current state:
- `const [subTab, setSubTab] = useState<SubTab>('live')`
- Dynamic tab list based on match status (scheduled vs live vs finished)
- H2H data fetched on tab click via `handleSubTab`

Changes:
- Replace conditional rendering with `SwipeTabView`
- `onTabChange` triggers the same lazy fetch logic (H2H on first visit)
- Tab list is dynamic — hook's `count` changes based on match status
- Spinner shown inside H2H panel while loading (same as current)

## Animations

| Moment | Animation | Duration | Easing |
|--------|-----------|----------|--------|
| Finger drag | Track follows finger | Real-time | None (1:1 tracking) |
| Snap to tab | Track slides to position | 350ms | cubic-bezier(0.25, 0.1, 0.25, 1) |
| Edge overshoot | Dampened drag (0.3x) | Real-time | None |
| Edge snap back | Return to edge | 350ms | cubic-bezier(0.25, 0.1, 0.25, 1) |
| Tab indicator | Slides with progress | Real-time / 350ms | Matches track |
| Reduced motion | Instant transform | 0ms | None |

## Brand Alignment

- Tab bar uses existing chunky shapes and green (#7ED321) active color
- No new visual elements — swipe is purely behavioral
- Tab underline indicator already exists, just made dynamic

## Data Requirements

No new database tables. No API changes. Everything uses existing:
- Existing tab state management (`useState`)
- Existing data fetching patterns (lazy H2H fetch)
- Existing scroll infrastructure (native browser scroll)

## Performance Considerations

- All tab panels are mounted simultaneously for swipe peek
- Only active tab runs data subscriptions (Supabase realtime for live matches)
- Non-adjacent panels (more than 1 away from current) can skip re-renders via React.memo
- Touch event handlers use `passive: false` only for `touchmove` (needed for `preventDefault`)
- No external library — total bundle impact ~2KB

## Accessibility

- Tab buttons remain keyboard-navigable (Enter/Space to switch)
- `role="tablist"` / `role="tab"` / `role="tabpanel"` ARIA attributes
- `aria-selected` on active tab
- `prefers-reduced-motion: reduce` skips all transition animations
- Swipe is enhancement only — full functionality via tap

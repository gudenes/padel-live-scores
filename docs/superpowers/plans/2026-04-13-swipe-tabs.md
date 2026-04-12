# Swipe Tab Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add horizontal snap-swipe navigation to internal page tabs on the Matches page and Match Detail page, with scroll preservation and real-time tab indicator tracking.

**Architecture:** A reusable `useSwipeTabs` hook handles all touch gesture tracking (angle lock, snap threshold, edge clamping). A `SwipeTabView` wrapper component renders the tab bar with sliding indicator, viewport, and track. Both pages integrate by wrapping their tab content in `SwipeTabView` instead of conditional rendering.

**Tech Stack:** React 19, TypeScript, pure touch events (no external library), CSS transitions, inline styles (matching existing app pattern).

**Spec:** `docs/superpowers/specs/2026-04-13-swipe-tabs-design.md`

---

## File Structure

```
src/hooks/useSwipeTabs.ts           # Touch gesture hook (angle lock, snap, edge clamp)
src/components/SwipeTabView.tsx     # Tab bar + viewport + track wrapper
src/app/(app)/matches/page.tsx      # Replace conditional tab rendering with SwipeTabView
src/app/match/[id]/page.tsx         # Replace conditional subtab rendering with SwipeTabView
```

---

### Task 1: Create `useSwipeTabs` Hook

**Files:**
- Create: `src/hooks/useSwipeTabs.ts`

- [ ] **Step 1: Create the hook file with types and core state**

```typescript
// src/hooks/useSwipeTabs.ts
'use client'

import { useState, useRef, useCallback, useMemo } from 'react'

interface UseSwipeTabsOptions {
  count: number
  initial?: number
  onTabChange?: (idx: number) => void
  threshold?: number // fraction of viewport width, default 0.2
}

interface UseSwipeTabsReturn {
  currentTab: number
  goTo: (idx: number) => void
  trackStyle: React.CSSProperties
  handlers: {
    onTouchStart: (e: React.TouchEvent) => void
    onTouchMove: (e: React.TouchEvent) => void
    onTouchEnd: () => void
  }
  progress: number
  isDragging: boolean
}

const SNAP_EASING = 'cubic-bezier(0.25, 0.1, 0.25, 1)'
const SNAP_DURATION = '350ms'
const DEAD_ZONE = 8 // px before direction lock
const EDGE_DAMPEN = 0.3

export function useSwipeTabs({
  count,
  initial = 0,
  onTabChange,
  threshold = 0.2,
}: UseSwipeTabsOptions): UseSwipeTabsReturn {
  const [currentTab, setCurrentTab] = useState(initial)
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState(0) // px offset during drag

  const startX = useRef(0)
  const startY = useRef(0)
  const locked = useRef<'horizontal' | 'vertical' | null>(null)
  const viewportWidth = useRef(0)
  const prefersReduced = useRef(false)

  // Check reduced motion on mount-ish (ref stays stable)
  if (typeof window !== 'undefined' && prefersReduced.current === false) {
    prefersReduced.current = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  }

  const goTo = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(count - 1, idx))
    setCurrentTab(prev => {
      if (prev !== clamped) onTabChange?.(clamped)
      return clamped
    })
    setDragOffset(0)
    setIsDragging(false)
    locked.current = null
  }, [count, onTabChange])

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0]
    startX.current = touch.clientX
    startY.current = touch.clientY
    locked.current = null
    viewportWidth.current = (e.currentTarget as HTMLElement).offsetWidth
    setIsDragging(false)
    setDragOffset(0)
  }, [])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0]
    const dx = touch.clientX - startX.current
    const dy = touch.clientY - startY.current

    // Direction lock: first 8px determines horizontal vs vertical
    if (!locked.current) {
      if (Math.abs(dx) > DEAD_ZONE || Math.abs(dy) > DEAD_ZONE) {
        locked.current = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical'
        if (locked.current === 'horizontal') {
          setIsDragging(true)
        }
      }
      return
    }

    if (locked.current !== 'horizontal') return

    // Prevent vertical scroll while swiping
    e.preventDefault()

    // Edge clamping with dampening
    let offset = dx
    const atLeftEdge = currentTab === 0 && dx > 0
    const atRightEdge = currentTab === count - 1 && dx < 0
    if (atLeftEdge || atRightEdge) {
      offset = dx * EDGE_DAMPEN
    }

    setDragOffset(offset)
  }, [currentTab, count])

  const onTouchEnd = useCallback(() => {
    if (!locked.current || locked.current !== 'horizontal') {
      locked.current = null
      return
    }

    const w = viewportWidth.current || 1
    const swipeRatio = Math.abs(dragOffset) / w

    if (swipeRatio > threshold) {
      if (dragOffset < 0 && currentTab < count - 1) {
        goTo(currentTab + 1)
      } else if (dragOffset > 0 && currentTab > 0) {
        goTo(currentTab - 1)
      } else {
        // Edge — snap back
        setDragOffset(0)
        setIsDragging(false)
        locked.current = null
      }
    } else {
      // Below threshold — snap back
      setDragOffset(0)
      setIsDragging(false)
      locked.current = null
    }
  }, [dragOffset, threshold, currentTab, count, goTo])

  // Track transform: base position + drag offset
  const baseTranslate = -(currentTab * 100) / count
  const dragTranslate = viewportWidth.current
    ? (dragOffset / viewportWidth.current) * (100 / count)
    : 0
  const totalTranslate = baseTranslate + dragTranslate

  const noTransition = isDragging || prefersReduced.current

  const trackStyle: React.CSSProperties = useMemo(() => ({
    display: 'flex',
    width: `${count * 100}%`,
    transform: `translateX(${totalTranslate}%)`,
    transition: noTransition ? 'none' : `transform ${SNAP_DURATION} ${SNAP_EASING}`,
    willChange: isDragging ? 'transform' : 'auto',
  }), [count, totalTranslate, noTransition, isDragging])

  // Progress: 0-based float (e.g. 1.3 = 30% between tab 1 and 2)
  const progress = currentTab + (viewportWidth.current ? -dragOffset / viewportWidth.current : 0)

  const handlers = useMemo(() => ({
    onTouchStart,
    onTouchMove,
    onTouchEnd,
  }), [onTouchStart, onTouchMove, onTouchEnd])

  return { currentTab, goTo, trackStyle, handlers, progress, isDragging }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useSwipeTabs.ts
git commit -m "feat(swipe): add useSwipeTabs hook for gesture-based tab navigation"
```

---

### Task 2: Create `SwipeTabView` Component

**Files:**
- Create: `src/components/SwipeTabView.tsx`

- [ ] **Step 1: Create the component file**

```typescript
// src/components/SwipeTabView.tsx
'use client'

import { useRef, useEffect, useCallback, type ReactNode } from 'react'
import { useSwipeTabs } from '@/hooks/useSwipeTabs'

const GREEN = '#7ED321'
const MUTED = '#6B7280'
const BORDER = 'rgba(255,255,255,0.06)'
const SNAP_EASING = 'cubic-bezier(0.25, 0.1, 0.25, 1)'

interface Tab {
  key: string
  label: string
  /** Optional: custom active background color (e.g. red for Live tab) */
  activeColor?: string
  /** Optional: custom active text color */
  activeTextColor?: string
  /** Optional: badge content (e.g. live count) */
  badge?: ReactNode
}

interface SwipeTabViewProps {
  tabs: Tab[]
  currentTab: number
  onTabChange: (idx: number) => void
  children: ReactNode[]
  preserveScroll?: boolean
  /** Style variant for the tab bar buttons */
  tabBarStyle?: 'underline' | 'pill'
}

export function SwipeTabView({
  tabs,
  currentTab,
  onTabChange,
  children,
  preserveScroll = true,
  tabBarStyle = 'underline',
}: SwipeTabViewProps) {
  const { goTo, trackStyle, handlers, progress, isDragging } = useSwipeTabs({
    count: tabs.length,
    initial: currentTab,
    onTabChange,
  })

  // Sync external currentTab changes (e.g. auto-tab-selection on load)
  const prevTab = useRef(currentTab)
  useEffect(() => {
    if (currentTab !== prevTab.current) {
      goTo(currentTab)
      prevTab.current = currentTab
    }
  }, [currentTab, goTo])

  // Update prevTab when internal goTo fires
  useEffect(() => {
    prevTab.current = currentTab
  }, [currentTab])

  // Scroll preservation
  const panelRefs = useRef<(HTMLDivElement | null)[]>([])
  const scrollPositions = useRef(new Map<number, number>())
  const prevTabForScroll = useRef(currentTab)

  useEffect(() => {
    if (!preserveScroll) return
    if (prevTabForScroll.current !== currentTab) {
      // Save departing tab's scroll
      const departingPanel = panelRefs.current[prevTabForScroll.current]
      if (departingPanel) {
        scrollPositions.current.set(prevTabForScroll.current, departingPanel.scrollTop)
      }
      // Restore arriving tab's scroll
      const arrivingPanel = panelRefs.current[currentTab]
      if (arrivingPanel) {
        arrivingPanel.scrollTop = scrollPositions.current.get(currentTab) ?? 0
      }
      prevTabForScroll.current = currentTab
    }
  }, [currentTab, preserveScroll])

  const setPanelRef = useCallback((idx: number) => (el: HTMLDivElement | null) => {
    panelRefs.current[idx] = el
  }, [])

  const prefersReduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  // Tab indicator position (tracks swipe progress)
  const indicatorTranslate = progress * 100
  const indicatorTransition = isDragging || prefersReduced
    ? 'none'
    : `transform 350ms ${SNAP_EASING}`

  return (
    <div>
      {/* Tab bar */}
      {tabBarStyle === 'underline' ? (
        <div
          role="tablist"
          style={{
            display: 'flex',
            borderBottom: `0.5px solid ${BORDER}`,
            background: '#141414',
            position: 'relative',
          }}
        >
          {tabs.map((tab, i) => {
            const active = currentTab === i
            return (
              <button
                key={tab.key}
                role="tab"
                aria-selected={active}
                onClick={() => { goTo(i); onTabChange(i) }}
                style={{
                  flex: 1,
                  fontSize: 11,
                  fontWeight: active ? 700 : 500,
                  padding: '10px 4px',
                  background: 'transparent',
                  border: 'none',
                  color: active ? GREEN : MUTED,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  borderBottom: '2px solid transparent',
                }}
              >
                {tab.label}
                {tab.badge}
              </button>
            )
          })}
          {/* Sliding indicator */}
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              width: `${100 / tabs.length}%`,
              height: 2,
              background: GREEN,
              transform: `translateX(${indicatorTranslate}%)`,
              transition: indicatorTransition,
            }}
          />
        </div>
      ) : null}

      {/* Swipeable viewport */}
      <div
        role="presentation"
        style={{ overflow: 'hidden', touchAction: 'pan-y' }}
        {...handlers}
      >
        <div style={trackStyle}>
          {tabs.map((tab, i) => (
            <div
              key={tab.key}
              role="tabpanel"
              ref={setPanelRef(i)}
              style={{
                width: `${100 / tabs.length}%`,
                flexShrink: 0,
                overflowY: 'auto',
                minHeight: 200,
              }}
            >
              {children[i]}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/SwipeTabView.tsx
git commit -m "feat(swipe): add SwipeTabView wrapper component with scroll preservation"
```

---

### Task 3: Integrate SwipeTabView on Matches Page

**Files:**
- Modify: `src/app/(app)/matches/page.tsx`

The matches page currently uses `tab` state with conditional rendering. We need to:
1. Keep the existing tab bar (pill style with chunky shapes + gender toggle) — do NOT use SwipeTabView's built-in tab bar
2. Replace the conditional content rendering with SwipeTabView's swipe viewport
3. Wire up `goTo` for auto-tab-selection on load

The implementing agent should:

- [ ] **Step 1: Read the current matches page** to understand the full rendering flow. Pay attention to:
  - Line 654: `const [tab, setTab] = useState<'live' | 'upcoming' | 'results'>('live')`
  - Lines 718-724: auto-tab-selection on first load
  - Lines 830-833: `currentMatches` and `grouped` are computed from `tab`
  - Lines 910-980: existing tab bar with chunky pill buttons + gender toggle (KEEP THIS — do not replace with SwipeTabView's underline tabs)
  - Lines 982-1035: the content section rendered based on `tab` — this is what gets wrapped in SwipeTabView

- [ ] **Step 2: Import useSwipeTabs and add swipe state**

At the top of the `ScoresPageInner` component (after the existing `tab` state at line 654), add:

```typescript
import { useSwipeTabs } from '@/hooks/useSwipeTabs'
```

Add this import at the top of the file alongside the other imports.

Then inside `ScoresPageInner`, after the existing `tab` state, add a mapping from tab keys to indices:

```typescript
const TAB_KEYS = ['live', 'upcoming', 'results'] as const
const tabIndex = TAB_KEYS.indexOf(tab)

const { goTo: swipeGoTo, trackStyle, handlers: swipeHandlers, isDragging } = useSwipeTabs({
  count: 3,
  initial: tabIndex,
  onTabChange: (idx) => setTab(TAB_KEYS[idx]),
})

// Sync auto-tab-selection (from fetchData) to swipe position
useEffect(() => {
  swipeGoTo(TAB_KEYS.indexOf(tab))
}, [tab, swipeGoTo])
```

- [ ] **Step 3: Compute matches for ALL tabs (not just current)**

Currently `currentMatches` is only computed for the active tab. For swipe peek, all 3 panels need content. Change the content section to compute matches for each tab independently.

Replace the `currentMatches` and `grouped` computation (lines 830-833) with per-tab computations:

```typescript
const liveFiltered = gf(lf([...liveMatches, ...lingeringMatches]))
const upcomingFiltered = gf(lf(scheduledMatches.filter(hasPlayers)))
const resultsFiltered = gf(lf(recentMatches))

const liveGrouped = groupByTournament(liveFiltered)
const upcomingGrouped = groupByTournament(upcomingFiltered)
const resultsGrouped = groupByTournament(resultsFiltered)
```

Keep `currentMatches` for backward compatibility with the empty-state message:

```typescript
const currentMatches = tab === 'live' ? liveFiltered : tab === 'upcoming' ? upcomingFiltered : resultsFiltered
const grouped = tab === 'live' ? liveGrouped : tab === 'upcoming' ? upcomingGrouped : resultsGrouped
```

- [ ] **Step 4: Replace conditional content with swipe viewport**

Replace the content section (the `<div>` with `padding: '0 16px'` at line 983 through the closing `</>` at line 1036) with a swipe viewport wrapping all 3 panels. Keep the existing tab bar buttons above (lines 910-980) unchanged — they call `setTab()` which syncs via the `useEffect`.

Wire the existing tab buttons to also call `swipeGoTo`:

In the tab button `onClick` (line 918), change from:
```typescript
onClick={() => setTab(t.key)}
```
to:
```typescript
onClick={() => { setTab(t.key); swipeGoTo(TAB_KEYS.indexOf(t.key)) }}
```

Then replace the content section with the swipe viewport:

```tsx
{/* Swipeable content */}
<div style={{ overflow: 'hidden', touchAction: 'pan-y' }} {...swipeHandlers}>
  <div style={trackStyle}>
    {/* Live panel */}
    <div style={{ width: '33.333%', flexShrink: 0, minHeight: 200 }}>
      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 24 }}>
        {liveGrouped.length > 0 ? liveGrouped.map((group, idx) => (
          <TournamentGroup
            key={group.tournament?.id ?? idx}
            tournament={group.tournament}
            matches={group.matches}
            defaultOpen={true}
            tab="live"
          />
        )) : (
          <EmptyState tab="live" leagueFilter={leagueFilter} />
        )}
      </div>
    </div>

    {/* Upcoming panel */}
    <div style={{ width: '33.333%', flexShrink: 0, minHeight: 200 }}>
      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 24 }}>
        {upcomingGrouped.length > 0 ? upcomingGrouped.map((group, idx) => (
          <TournamentGroup
            key={group.tournament?.id ?? idx}
            tournament={group.tournament}
            matches={group.matches}
            defaultOpen={true}
            tab="upcoming"
          />
        )) : (
          <EmptyState tab="upcoming" leagueFilter={leagueFilter} />
        )}
      </div>
    </div>

    {/* Results panel */}
    <div style={{ width: '33.333%', flexShrink: 0, minHeight: 200 }}>
      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 24 }}>
        {resultsGrouped.length > 0 ? resultsGrouped.map((group, idx) => (
          <TournamentGroup
            key={group.tournament?.id ?? idx}
            tournament={group.tournament}
            matches={group.matches}
            defaultOpen={idx === 0}
            tab="results"
          />
        )) : (
          <EmptyState tab="results" leagueFilter={leagueFilter} />
        )}
      </div>
      {/* View previous seasons link */}
      <div style={{ padding: '0 16px 32px', textAlign: 'center' }}>
        <Link
          href="/home?view=tournaments"
          style={{
            display: 'inline-block',
            background: 'rgba(255,255,255,0.04)',
            border: `1px solid ${BORDER}`,
            clipPath: CHUNKY.button,
            padding: '10px 28px',
            fontSize: 12, fontWeight: 700,
            color: GREEN,
            textDecoration: 'none',
            fontFamily: 'inherit',
          }}
        >
          View previous seasons
        </Link>
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 5: Extract EmptyState helper**

To avoid repeating the empty state markup 3 times, extract a small helper function inside the file (place it before `ScoresPageInner`):

```typescript
function EmptyState({ tab, leagueFilter }: { tab: 'live' | 'upcoming' | 'results'; leagueFilter: string }) {
  return (
    <div style={{
      clipPath: CHUNKY.card,
      background: BG_CARD,
      border: `1px solid ${BORDER}`,
      padding: '28px 20px',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 32, marginBottom: 10 }}>&#127934;</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', marginBottom: 6 }}>
        {tab === 'live' ? 'No live matches right now' : tab === 'upcoming' ? 'No upcoming matches' : 'No recent results'}
      </div>
      <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.5 }}>
        {leagueFilter !== 'all'
          ? `Try switching the league filter to see ${leagueFilter === 'premier' ? 'FIP Tour' : 'Premier Padel'} or All matches.`
          : tab === 'live' ? 'Check back during tournament days'
          : tab === 'upcoming' ? 'Schedules will appear closer to match day'
          : 'Results will appear after matches finish'}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep "matches/page"`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/app/\(app\)/matches/page.tsx
git commit -m "feat(swipe): add swipe tab navigation to matches page

Live/Upcoming/Results tabs now support horizontal snap-swipe.
Content follows finger in real-time, snaps to nearest tab on release.
Existing pill-style tab buttons still work for tap navigation."
```

---

### Task 4: Integrate SwipeTabView on Match Detail Page

**Files:**
- Modify: `src/app/match/[id]/page.tsx`

The match detail page has dynamic subtabs based on match status. We need to:
1. Use SwipeTabView's built-in underline tab bar (replaces the existing tab buttons)
2. Mount all tab panels simultaneously for swipe peek
3. Preserve H2H lazy fetch behavior

The implementing agent should:

- [ ] **Step 1: Read the current match detail subtab section** (lines 868-910) to understand the dynamic tab list and content rendering.

- [ ] **Step 2: Import SwipeTabView**

Add to the imports at the top of the file:

```typescript
import { SwipeTabView } from '@/components/SwipeTabView'
```

- [ ] **Step 3: Rewrite the subtab section**

Replace the entire subtab IIFE (lines 868-910, from `{(() => {` to the closing `})()}`) with:

```tsx
{(() => {
  const tabList: { key: string; label: string }[] = isFinished
    ? [{ key: 'recap', label: 'Score Recap' }, { key: 'live', label: 'Live Feed' }, { key: 'players', label: 'Players' }, { key: 'h2h', label: 'H2H' }]
    : isScheduled
      ? [{ key: 'players', label: 'Players' }, { key: 'h2h', label: 'H2H' }]
      : [{ key: 'live', label: 'Live Feed' }, { key: 'players', label: 'Players' }, { key: 'h2h', label: 'H2H' }]

  const tabKeys = tabList.map(t => t.key)
  const currentIdx = Math.max(0, tabKeys.indexOf(subTab))

  return (
    <SwipeTabView
      tabs={tabList}
      currentTab={currentIdx}
      onTabChange={(idx) => handleSubTab(tabKeys[idx] as SubTab)}
    >
      {tabList.map(t => (
        <div key={t.key} style={{ background: BG_CARD, minHeight: 300 }}>
          {t.key === 'recap' && isFinished && (
            <MatchStatsView matchId={match.id} />
          )}
          {t.key === 'live' && (
            <LiveFeedTab match={match} pair1Label={pair1Label} pair2Label={pair2Label} isLive={isLive} />
          )}
          {t.key === 'players' && (
            <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {match.pair1_player1 && <PlayerCard player={match.pair1_player1} winner={p1Won} accent={PAIR1_COLOR} />}
              {match.pair1_player2 && <PlayerCard player={match.pair1_player2} winner={p1Won} accent={PAIR1_COLOR} />}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                <div style={{ flex: 1, height: '0.5px', background: BORDER }} />
                <span style={{ fontSize: 10, fontWeight: 800, color: MUTED, letterSpacing: '2px' }}>VS</span>
                <div style={{ flex: 1, height: '0.5px', background: BORDER }} />
              </div>
              {match.pair2_player1 && <PlayerCard player={match.pair2_player1} winner={p2Won} accent={PAIR2_COLOR} />}
              {match.pair2_player2 && <PlayerCard player={match.pair2_player2} winner={p2Won} accent={PAIR2_COLOR} />}
            </div>
          )}
          {t.key === 'h2h' && (
            <H2HTab match={match} h2hMatches={h2hMatches} h2hLoading={h2hLoading} pair1Label={pair1Label} pair2Label={pair2Label} pair1Recent={pair1Recent} pair2Recent={pair2Recent} />
          )}
        </div>
      ))}
    </SwipeTabView>
  )
})()}
```

Note: `handleSubTab` already handles the lazy H2H fetch — when `onTabChange` fires with the H2H index, it calls `handleSubTab('h2h')` which triggers `fetchH2H` if needed.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep "match/\[id\]"`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/app/match/\[id\]/page.tsx
git commit -m "feat(swipe): add swipe tab navigation to match detail subtabs

Players/H2H/Stats subtabs now support horizontal snap-swipe.
H2H lazy fetch still triggers on first visit via onTabChange.
Uses SwipeTabView's built-in underline tab bar."
```

---

### Task 5: Smoke Test + Polish

- [ ] **Step 1: Run dev server and test matches page**

Run: `npm run dev`
Navigate to: `/matches`

Verify:
1. Live/Upcoming/Results tabs visible with existing pill style
2. Swiping left on Live tab shows Upcoming content sliding in
3. Swiping right on Upcoming shows Live content
4. Tab pill button syncs with swipe position
5. Vertical scrolling still works (no conflict)
6. Tapping tab buttons still switches tabs
7. Auto-tab-selection on load (goes to live if live matches exist)

- [ ] **Step 2: Test match detail page**

Navigate to: a scheduled match

Verify:
1. Players and H2H tabs visible with underline style
2. Swiping between Players and H2H works
3. H2H data loads on first swipe to that tab (shows spinner then content)
4. Green underline indicator follows swipe in real-time

Navigate to: a finished match

Verify:
1. Score Recap / Live Feed / Players / H2H tabs all swipeable
2. All content renders correctly in each panel

- [ ] **Step 3: Test edge cases**

Verify:
1. Swiping past the first tab (Live) shows dampened resistance, snaps back
2. Swiping past the last tab (Results) shows dampened resistance, snaps back
3. Quick flick (fast swipe, short distance) still triggers tab change
4. Very slow drag below 20% threshold snaps back to current tab

- [ ] **Step 4: Fix any issues found**

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "fix(swipe): smoke test polish"
```

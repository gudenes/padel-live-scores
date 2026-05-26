# Home Card → Matches Tab, Animated Arrival + Smart Round Default

**Date:** 2026-05-23
**Status:** Design — pending implementation
**Scope:** Two related polishes to the home → tournament-detail flow

## Problem

Two issues on the home → tournament-detail flow:

1. **The "VER PARTIDOS" CTA undersells itself.** The home page "TORNEOS EN VIVO" cards have a "VER PARTIDOS" (See Matches) button whose intent is unambiguous: the user wants to see the tournament's matches *right now*. Today the link lands on the tournament detail page's default tab (Overview, or Story for completed events). The user then has to scan the page, find the tabs, and tap "Partidos". The CTA's promise isn't delivered without a second interaction.

2. **The Matches tab can default to a stale round.** The round auto-select effect picks `live → today → availableRounds[0]`. The first-available fallback is almost always Q1, which is wrong any time the tournament has progressed past quals without something live or scheduled today (between-day gaps, mornings before play starts, finals weekend, completed tournaments). The user lands on a round they don't care about.

## Goals

**Animated arrival.** Tapping "VER PARTIDOS" lands on the detail page and **visibly transitions** to the Matches tab as part of arrival, so the user sees the tab activate without having to tap it themselves. The animation doubles as a spatial cue ("you went from home to here, and here is the matches view of this tournament").

**Smart round default.** Whenever the Matches tab loads (any entry point), the round selector defaults to *the most advanced round that is currently being played or has any in-tournament progress*, not Q1.

Scope on the animation is intentionally narrow — only the "VER PARTIDOS" CTA carries the animation flag. The round-default change applies everywhere because it's a fix to a generic fallback, not a feature.

## Existing plumbing we can build on

- **URL → initial tab** is already supported. [tournaments/[id]/page.tsx:184](src/app/[locale]/(app)/tournaments/[id]/page.tsx:184) reads `?tab=overview|story|matches|draw` and seeds local `pageTab` state on mount.
- **The tab strip animates on its own** via [SlidingInkTabs](src/components/SlidingInkTabs.tsx) — a 360ms spring on the ink bar whenever `activeKey` changes. We just need to feed it a tab change after mount.
- **Tabs are sticky**, so the ink-bar animation is visible regardless of scroll position. No auto-scroll is required.
- **Locale-aware navigation** is in place — the home card already uses [`@/i18n/navigation`](src/i18n/navigation.ts)'s `Link`.

So the change is essentially: *add a hint to the URL on the home card, and have the detail page interpret that hint by starting on Overview and then setting pageTab to Matches after a short beat.*

## Design

### 1. Home card link carries an intent flag

[TournamentSpotlight.tsx:108](src/components/home/TournamentSpotlight.tsx:108) — the "VER PARTIDOS" `<Link>`:

```tsx
// before
href={`/tournaments/${tournament.id}`}

// after
href={`/tournaments/${tournament.id}?tab=matches&intent=matches`}
```

Why two params:
- `tab=matches` is the *destination*. If the animation is skipped (reduced motion, hard refresh after `intent` is cleared, the timer being beat by a bounce-back) the user still ends up on Matches.
- `intent=matches` is the *animation trigger*. Only paths that should animate carry it. A notification deep-link to `?tab=matches` (no intent flag) still lands directly on Matches with no Overview-flash.

No other home-page entry point gets the flag in this iteration.

### 2. Detail page consumes the intent

[tournaments/[id]/page.tsx:184](src/app/[locale]/(app)/tournaments/[id]/page.tsx:184) — extend the initial-tab logic. The animation request is derived purely from the URL (which is identical on server and client) so SSR and hydration agree:

```tsx
const paramTab = searchParams.get('tab')
const wantsMatchesAnimation = searchParams.get('intent') === 'matches'
  && paramTab === 'matches'

const initialTab: TournamentTab =
  wantsMatchesAnimation
    ? 'overview'                  // start here, animate to matches
    : paramTab === 'draw'   ? 'draw'
    : paramTab === 'story'
      || paramTab === 'recap' ? 'story'
    : paramTab === 'matches' ? 'matches'
    : 'overview'

const [pageTab, setPageTabState] = useState<TournamentTab>(initialTab)

// Track whether the user has manually changed tabs, so the scheduled
// auto-animation doesn't fight a user interaction during the 280ms dwell.
const userChangedTabRef = useRef(false)
const setPageTab = useCallback((next: TournamentTab) => {
  userChangedTabRef.current = true
  setPageTabState(next)
}, [])
```

Then a single effect runs once on mount when the animation is wanted. Reduced-motion is checked here (client-only, no SSR surface):

```tsx
useEffect(() => {
  if (!wantsMatchesAnimation) return

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const commit = () => {
    if (userChangedTabRef.current) return  // user already picked a tab
    setPageTabState('matches')             // bypass userChangedTabRef flip

    // Strip the intent flag so refresh/back doesn't re-animate.
    // Keep ?tab=matches so the URL still represents the user's location.
    const params = new URLSearchParams(searchParams.toString())
    params.delete('intent')
    router.replace(
      `${pathname}${params.toString() ? `?${params.toString()}` : ''}`,
      { scroll: false }
    )
  }

  if (reduced) {
    commit()              // no dwell, no animation pretense
    return
  }

  const t = setTimeout(commit, 280)
  return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [])
```

Note `setPageTabState` is used inside the effect (not the wrapped `setPageTab`) so the auto-commit doesn't flip `userChangedTabRef` — the ref is only meant to record *human* taps.

**Why 280ms:** long enough for the user's eye to register that the page mounted on Overview, short enough that the whole arrival completes well under a second (280ms dwell + 360ms ink animation ≈ 640ms total). Matches the cadence of the existing SlidingInkTabs spring.

**Why `router.replace`, not `push`:** we're rewriting the *same* navigation entry, not adding a new history entry. Back button should return the user to home, not to a transient `?intent=matches` state.

**Why `{ scroll: false }`:** the user is reading the hero. Don't yank them anywhere.

### 3. Reduced-motion fallback

The initial render still places the user on Overview (the URL is the only signal available SSR), but the mount effect immediately commits to Matches with no setTimeout when `prefers-reduced-motion: reduce` is set. The visible result: a single-frame Overview flash on the very first paint, then Matches. No 280ms dwell, no spring travel of the ink bar across the strip. Consistent with how the existing scroll-in animations behave ([useInViewOnce](src/hooks/useInViewOnce.ts)) — motion is suppressed, content arrives.

If a single-frame Overview flash is unacceptable for reduced-motion users, the alternative is rendering Matches on the server when the URL has `intent=matches` (treat reduced-motion as the *default* and animation as the *override*). We're not doing that in this iteration: it would require an SSR media-query proxy (cookie or header), which is more machinery than the polish warrants.

### 4. Auto-tab-on-completed precedence

[tournaments/[id]/page.tsx:370](src/app/[locale]/(app)/tournaments/[id]/page.tsx:370) currently defaults completed tournaments to the Story tab when no `?tab` is present. Because `wantsMatchesAnimation` requires `paramTab === 'matches'`, that explicit param wins — a completed tournament reached from "VER PARTIDOS" still animates to Matches as intended. No change needed there.

### 5. Smarter round auto-selection

[tournaments/[id]/page.tsx:456](src/app/[locale]/(app)/tournaments/[id]/page.tsx:456) — replace the fallback chain.

**Today:** `hasLive ?? hasToday ?? availableRounds[0]`. The final fallback is the first round in the strip — usually Q1 — which is almost never what the user wants when they open the Matches tab on a tournament in progress.

**New logic:** walk `availableRounds` from most advanced → least advanced, picking the **last (most advanced) round** that satisfies the strongest predicate available, in priority order:

1. **Has a live match** (`status === 'live' || 'on_court'`) — somebody is playing right now
2. **Has a match scheduled today** (`scheduled_at.slice(0,10) === todayKey`) — today's slate
3. **Has a finished match** (`status === 'finished'`) — most recent completed round
4. Final fallback: `availableRounds[0]` — only if the tournament has no progress whatsoever (all matches purely scheduled in the future)

```tsx
const reverseRounds = [...availableRounds].reverse()
const inTournament = (m: any) =>
  !activeTournament || (m as any).tournament?.id === activeTournament
const inRound = (r: string) => (m: any) =>
  inTournament(m) && normalizeRoundFull(m.round as string) === r

const mostAdvancedLive = reverseRounds.find(r =>
  allMatches.some(m =>
    inRound(r)(m) && (m.status === 'live' || (m.status as string) === 'on_court')
  )
)
const mostAdvancedToday = reverseRounds.find(r =>
  allMatches.some(m => {
    if (!inRound(r)(m)) return false
    const src = (m as any).scheduled_at ?? (m as any).started_at
    return src && src.slice(0, 10) === todayKey
  })
)
const mostAdvancedFinished = reverseRounds.find(r =>
  allMatches.some(m => inRound(r)(m) && m.status === 'finished')
)

setSelectedRound(prev => {
  if (paramRound && !prev) {
    const normalized = normalizeRoundFull(paramRound)
    if (availableRounds.includes(normalized)) return normalized
  }
  if (prev && availableRounds.includes(prev)) return prev
  return (
    mostAdvancedLive
    ?? mostAdvancedToday
    ?? mostAdvancedFinished
    ?? availableRounds[0]
    ?? null
  )
})
```

**Why "most advanced" wins within each predicate.** In real padel tournaments, rounds run in sequence — Q1 doesn't overlap with R16. Cases where two rounds simultaneously contain live matches are rare; when they happen (e.g., an over-running quals match while R32 starts on another court), the more-advanced round is the more interesting one for a casual fan opening the page.

**Why the priority order matters.** If R16 has only finished matches and Q3 has a live match (e.g., a late quals dragging on), the live match wins because the predicate priority is `live > today > finished`. This contradicts the pure "always pick the most advanced round" rule, deliberately — *live action takes precedence over completed action regardless of round position*.

**Why this changes `availableRounds[0]` behavior carefully.** The first-available fallback is preserved at the very bottom of the chain. So a tournament whose schedule has been published but where no match has yet been played, scheduled today, or live (e.g., 36 hours before Day 1) still lands on Q1. Only tournaments with *some* progress get the smart pick.

`paramRound` and the "preserve user's prior selection" branch are unchanged — operator deep-links and in-session user choices still win.

## What we are NOT doing

- Auto-scrolling the page. Tabs are sticky; animation alone is the signal. If it feels under-baked in practice, add scroll as a follow-up.
- Animating other home-page CTAs. One card, one polish. Evaluate after shipping.
- Syncing every `pageTab` change back to the URL. We only mutate the URL once (to strip `intent`). Local-state tabs remain the model.
- Adding any new animation primitive. We reuse SlidingInkTabs' existing spring.
- Changing how `availableRounds` is built or ordered. We only change the *selection* logic over an existing ordered list. The strip's visual order, round labels, and date sub-labels are untouched.
- Persisting the smart round pick across navigations. The auto-select effect already short-circuits if the user has manually changed `selectedRound` during the session; that behavior is unchanged.

## Risk / edge cases

| Case | Behavior |
|---|---|
| User taps "VER PARTIDOS" then immediately taps another tab during the 280ms dwell | The wrapped `setPageTab` flips `userChangedTabRef`, and the scheduled `commit` returns early. The user's tap wins; no override. (See the code in section 2.) |
| User backs out during the 280ms dwell | Component unmounts, cleanup clears the timer. No further state writes. Safe. |
| Direct URL share `?tab=matches&intent=matches` | Anyone opening that URL gets the animation. Fine — the intent param is documented as opt-in animation, and there's no security implication. |
| SSR / hydration | `wantsMatchesAnimation` is derived purely from `searchParams` (URL is identical on server and client), so the initial render agrees. Reduced-motion is checked client-side inside `useEffect` only. No hydration mismatch. |
| User clicks "VER PARTIDOS" but already on the same tournament page (unlikely from home, but possible from carousels) | `useEffect([])` only runs on mount; if the URL changes in-place, no animation. Acceptable — Next.js Link to the same route is a soft no-op anyway in App Router. |

## Files touched

- [src/components/home/TournamentSpotlight.tsx](src/components/home/TournamentSpotlight.tsx) — 1 line: extend the link's `href`.
- [src/app/[locale]/(app)/tournaments/[id]/page.tsx](src/app/[locale]/(app)/tournaments/[id]/page.tsx):
  - extend the initial-tab branch (animated arrival)
  - add a `userChangedTabRef` + wrapped `setPageTab`
  - add one mount effect (animated arrival timer)
  - replace the `hasLive ?? hasToday ?? availableRounds[0]` fallback chain in the round-auto-select effect with the four-tier priority chain (smart round default)

No new components, no new dependencies, no migrations.

## Success criteria

1. Tap "VER PARTIDOS" on a TORNEOS EN VIVO card. Detail page renders with Overview active. After ~280ms, the ink bar slides to Matches and the matches content swaps in. Total perceived time: ≤700ms.
2. Refresh the page on the resulting URL — no `?intent=` left in the URL, no re-animation.
3. Back button returns to the home page, not to a transient state.
4. With `prefers-reduced-motion: reduce`, the page commits to Matches on first effect with no 280ms dwell and no ink-bar travel animation. (A single hydration frame of Overview is acceptable — see §3.)
5. Tapping any other tab during the dwell wins — the auto-animation does not override the user's choice.
6. Deep-link `/tournaments/{id}?tab=matches` (no `intent`) still lands directly on Matches with no animation. Notifications and shared links unchanged.
7. Open the Matches tab of a tournament where R16 has matches today and Q1 has only finished matches → R16 is selected. (Today's screenshot case still works.)
8. Open the Matches tab of a tournament where SF finished yesterday, F is scheduled tomorrow, nothing today, nothing live → SF is selected (most-advanced finished). The user does NOT land on Q1.
9. Open the Matches tab of a tournament where Q3 has a live match and R16 has only scheduled-future matches → Q3 is selected (live beats most-advanced).
10. Open the Matches tab of a tournament that hasn't started — all matches scheduled for tomorrow or later → Q1 is selected (the fallback survives the "no progress" case).
11. Manually pick a different round, navigate away to another tab, come back → the manual pick is preserved (the existing `prev && availableRounds.includes(prev)` branch is untouched).

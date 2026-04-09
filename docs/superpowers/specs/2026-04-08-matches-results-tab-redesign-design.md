# Matches → Results Tab Redesign

**Date:** 2026-04-08
**Status:** Approved for implementation
**Scope:** `src/app/(app)/matches/page.tsx` (Results tab) + `src/app/(app)/home/page.tsx` (URL-addressable Events view) + new shared component `src/components/V3MatchCard.tsx`

## Problem

The matches page currently surfaces three tabs: **Live**, **Upcoming**, **Results**. The Results tab today is dominated by *Champions widgets*: each finished tournament renders as a compact card linking to the tournament page, with a "CHAMPIONS" sub-section showing the men's and women's winning pairs. The actual match results are hidden behind the click-through.

This is the wrong focus. Users on the Results tab want to see **the matches** — set scores, who won, what tournament they were played in. The Champions detail belongs on the tournament's recap page, not the matches index.

The matches page also has two related quirks:

1. **Tab landing logic** only checks for live matches (lines 811-816 of `matches/page.tsx`). If there are no live matches, it lands on Upcoming whether or not Upcoming has anything. There's no fall-through to Results.
2. **"Load previous seasons" button** at the bottom of the Results tab fetches another batch of older matches. The user wants this replaced with a navigation to the Events page (currently a `view` state inside `home/page.tsx`, no URL).

## Goals

- **Results tab focus:** Display recent finished matches grouped by tournament, using the same per-match card visual that the tournament detail page uses today (`V3MatchCard`)
- **Most-recent-first ordering:** Most recently finished tournament at the top, with its matches expanded; all other tournaments collapsed
- **Per-tournament cap with show-more:** Each tournament group caps at **10 matches** by default with a "Show all N matches" toggle (matching the existing Live/Upcoming `TournamentGroup` pattern)
- **Smarter tab landing priority:** `live → upcoming → results` (skip empty tabs, land on the first one with content)
- **Replace "Load previous seasons" with "View previous seasons" link** that navigates to the home Events view via a new URL: `/home?view=tournaments`
- **Make the home Events view URL-addressable** so the Results tab link actually works (and so the view becomes shareable in general)
- **Extract `V3MatchCard` into a shared component** so both the matches page and the tournament detail page import the same implementation

## Non-Goals

- Touching the Live or Upcoming tabs of the matches page
- Touching the home page's Events view UI itself — only adding a query-param reader so the URL `?view=tournaments` lands you there
- Touching the H2H tab (already redesigned in a separate change)
- Touching `TournamentGroup` for the Live/Upcoming flow — only changing the Results-tab branch
- Building a new `/events` route — the Events view stays inside `/home` as a `view` state, addressed by query param
- Removing the `getChampions` helper or the Champions UI from anywhere else in the codebase (it's still used on the home page and tournament recap)
- Restructuring the gender filter, league filter, or any other Results-tab control

## Design

### A. Extract `V3MatchCard` into a shared component

**Create** `src/components/V3MatchCard.tsx`. Move the existing `V3MatchCard` function from `src/app/(app)/tournaments/[id]/page.tsx` (lines 864-1001 today) into this new file. Export as a named export.

**Dependencies the component needs** — these must be imported into the new file:
- `Match` type from `@/types/match`
- `pairName`, `parseSetScore` from `@/types/match`
- `Link` from `next/link`
- A `FlagImg` component (currently defined inline in `tournaments/[id]/page.tsx`)
- Color constants: `BG_CARD`, `BORDER`, `LIVE_RED`, `MUTED`, `GREEN`
- `CHUNKY` clip-path preset object

**Decision on FlagImg duplication:** `FlagImg` is defined inline in three places today (`matches/page.tsx`, `tournaments/[id]/page.tsx`, `match/[id]/page.tsx`) with identical logic. This redesign **does not** consolidate them — out of scope. Instead, copy the FlagImg implementation into the new `V3MatchCard.tsx` file (it's ~12 lines and self-contained), so the new component remains importable without depending on either page file.

**Decision on color/clip-path constants:** Same approach — copy the few constants that `V3MatchCard` needs (`BG_CARD`, `BORDER`, `LIVE_RED`, `MUTED`, `GREEN`, `CHUNKY.card`, `CHUNKY.badge`) to the top of the new file. Both pages already define their own copies; centralizing constants is out of scope.

**Update the tournament detail page** (`src/app/(app)/tournaments/[id]/page.tsx`) to delete its inline `V3MatchCard` definition and import from `@/components/V3MatchCard` instead. All four call sites in that file (lines 755, 764, 782, 1893 today) keep working unchanged because the props signature is identical.

**Verify behavior is preserved:** No functional change to how `V3MatchCard` renders. After extraction, the tournament detail page should look pixel-identical.

### B. Replace the Results-tab Champions branch in `TournamentGroup`

In `src/app/(app)/matches/page.tsx`, function `TournamentGroup` (lines 457-689 today):

**Delete the entire `if (isFinished)` branch** (lines 481-560 today) which renders the Champions card. After deletion, finished tournaments fall through to the same collapsible group rendering used by Live/Upcoming.

**Helper functions to delete** (now unused):
- `getChampions(matches, category)` (lines 131-160 today) — only consumed by the deleted branch
- `ChampionRow` component (lines 425-453 today) — only consumed by the deleted branch

**Verify nothing else imports these.** Quick grep before deletion to confirm. If any other surface uses them (it shouldn't — they're local), leave them and only remove the call from `TournamentGroup`.

### C. Switch `TournamentGroup` to render `V3MatchCard` for the Results tab

`TournamentGroup` currently renders matches inside a group via `<V3MatchRow key={m.id} match={m} />` (line 670 today). For the Results tab, we want `<V3MatchCard match={m} genderColor={...} />` instead.

**Add a `tab` prop** to `TournamentGroup`:

```ts
interface TournamentGroupProps {
  tournament: any
  matches: Match[]
  defaultOpen: boolean
  genderFilter: string
  tab: 'live' | 'upcoming' | 'results'  // NEW
}
```

**Inside the visible-matches render** (around line 667-673 today), branch on `tab`:

```tsx
{visibleMatches.length > 0 && (
  <div style={gated ? { opacity: 0.4, filter: 'grayscale(60%)', pointerEvents: 'none' } : undefined}>
    {visibleMatches.map(m => (
      tab === 'results'
        ? <V3MatchCard key={m.id} match={m} genderColor={genderColorFor(m)} />
        : <V3MatchRow key={m.id} match={m} />
    ))}
  </div>
)}
```

**`genderColorFor(m)` helper:** look up the match's `category` field and return `MEN_BLUE`, `WOMEN_PURPLE`, or `MUTED` as a fallback. This logic already exists on the home page; reproduce it inline in `TournamentGroup` (3 lines).

**Update the call site** at line 1080-1086 today:

```tsx
<TournamentGroup
  key={group.tournament?.id ?? idx}
  tournament={group.tournament}
  matches={group.matches}
  defaultOpen={...}  // see section D
  genderFilter={genderFilter}
  tab={tab}          // NEW
/>
```

### D. Default-open behavior for Results tab

Currently `TournamentGroup` accepts `defaultOpen={tab === 'live'}` — Live tournaments start expanded, others start collapsed.

Change the call site to:

```tsx
defaultOpen={
  tab === 'live' ||
  (tab === 'results' && idx === 0)
}
```

Where `idx` is the loop index from `grouped.map((group, idx) => ...)`. This expands only the first (most recent) tournament group on the Results tab.

The grouping order is already correct: the existing `groupByTournament` function sorts groups so live ones come first, then by most recent activity. For the Results tab specifically, we need to ensure groups are sorted by **most recent finished match within the group** (descending). Verify the existing sort handles this; if not, add a Results-specific tiebreaker.

**Check the existing sort:** `groupByTournament` (lines 96-108 today) sorts gated tournaments to the bottom, then live first, then by latest activity. For Results-tab data (no live matches in the set, all finished), the sort falls through to the activity-time comparison. Need to verify this produces "most recent finished tournament first." If it doesn't, add a result-specific sort step before passing to `TournamentGroup` mapping.

### E. Per-tournament cap of 10 matches

The existing `TournamentGroup` already caps at **3 matches** by default and shows a "Show all N matches" toggle (lines 574-576, 674-686 today). Bump the default cap to **10**:

```ts
const visibleMatches = viewState === 'collapsed' ? [] : viewState === 'expanded' ? matches : matches.slice(0, 10)
```

And update the toggle visibility check from `matchCount > 3` to `matchCount > 10`:

```tsx
{matchCount > 10 && viewState !== 'collapsed' && (
  <button onClick={cycleState} ...>
    {viewState === 'expanded' ? 'Show less' : `Show all ${matchCount} matches`}
  </button>
)}
```

**Note:** This change affects Live and Upcoming tabs too — they use the same `TournamentGroup`. That's acceptable: Live tournaments rarely have more than 10 matches showing simultaneously, so the toggle just won't appear. If the user objects, we can scope the cap by `tab` in a later iteration.

### F. Tab landing priority — `live → upcoming → results`

Update `fetchData` (lines 810-816 today):

```ts
// Auto-select tab only on first load
if (!initialLoadDone.current) {
  const hasLive = liveData.length > 0
  const hasUpcoming = (dataOf(1) as Match[]).length > 0
  if (hasLive) setTab('live')
  else if (hasUpcoming) setTab('upcoming')
  else setTab('results')
  initialLoadDone.current = true
}
```

Edge case: if a `?tab=...` query param is present, we already short-circuit elsewhere — verify the auto-select doesn't override an explicit URL choice. Looking at the existing code, the search-params check at line 730 handles a different param (`?tournament=`), so the auto-select only runs on initial mount with no param. We should ALSO not override if the user already navigated tabs once. The `initialLoadDone` ref already protects against subsequent calls. Keep that ref.

### G. Replace "Load previous seasons" with "View previous seasons" link

The existing button (lines 1110-1130 today) calls `fetchMoreResults`, which paginates to older finished matches. Replace it with a `<Link href="/home?view=tournaments">` styled the same way:

```tsx
{tab === 'results' && (
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
)}
```

**Delete unused state and helpers** that the old "Load more" button needed:
- `loadingMore` state (line 742)
- `hasMore` state (line 743)
- `pageRef` ref (line 748)
- `fetchMoreResults` callback (lines 826-844)
- The `pageRef.current = 0` and `setHasMore(true)` lines inside `fetchData` (lines 807-808)

**Note:** The Supabase query in `fetchData` (line 781-785) currently filters `.gte('finished_at', '${current_year}-01-01')`. Keep that — we still scope Results to the current year by default. The "View previous seasons" link is the user's path to older data via the home Events view.

### H. Make the home Events view URL-addressable

In `src/app/(app)/home/page.tsx`, the home page uses local state `const [view, setView] = useState<'home' | 'tournaments'>('home')` (line 1826 today) to switch between the home feed and the Tournaments view. There's no URL representation.

**Add query-param sync:**

1. Import `useSearchParams` and `useRouter` from `next/navigation` if not already imported.

2. On mount, read the `view` query param:

   ```ts
   const searchParams = useSearchParams()
   const router = useRouter()
   const initialView = searchParams.get('view') === 'tournaments' ? 'tournaments' : 'home'
   const [view, setView] = useState<'home' | 'tournaments'>(initialView)
   ```

3. When `setView` is called from the existing UI (line 2107 today), also update the URL via `router.replace`:

   Wrap the existing `setView` calls with a small helper:

   ```ts
   const switchView = (next: 'home' | 'tournaments') => {
     setView(next)
     const url = next === 'tournaments' ? '/home?view=tournaments' : '/home'
     router.replace(url, { scroll: false })
   }
   ```

   Then replace the two existing `setView` call sites (line 2107: `Tournament Spotlight` action, line 1977: `TournamentsView onBack`) to use `switchView` instead.

4. Also sync the URL when the user navigates back (the `onBack` from `TournamentsView` line 1977 → use `switchView('home')`).

5. **Browser back button behavior:** When the user lands on `/home?view=tournaments` from the matches page and clicks back, they should return to the matches page. Using `router.replace` (not `router.push`) for the internal toggle is correct — it doesn't pollute history, so the back button returns to whatever was BEFORE the home page. The initial `?view=tournaments` URL set by the matches-page link DOES create a history entry (because the user navigated to it via `<Link>`), so back works.

**Edge case:** If the URL param changes after mount (e.g. user navigates from `/home` to `/home?view=tournaments` via a link inside the same page), we need a `useEffect` watching `searchParams` that syncs `view` state. Add it:

   ```ts
   useEffect(() => {
     const next = searchParams.get('view') === 'tournaments' ? 'tournaments' : 'home'
     setView(next)
   }, [searchParams])
   ```

   This makes the home page fully responsive to URL changes without re-mounting.

## Reused Primitives

- `V3MatchCard` (newly extracted to `src/components/V3MatchCard.tsx`) — match rendering
- `V3MatchRow` (already in `matches/page.tsx`) — Live/Upcoming match rendering, unchanged
- `groupByTournament` — already exists, sort behavior verified for Results
- `TournamentGroup` — modified to take a `tab` prop
- `useSearchParams`, `useRouter` from `next/navigation` — for the home page query param sync

## File Structure

**New files:**
- `src/components/V3MatchCard.tsx` — extracted shared component

**Modified files:**
- `src/app/(app)/matches/page.tsx` — delete Champions branch, helpers, and `fetchMoreResults`; update `TournamentGroup` to render `V3MatchCard` for Results; bump cap to 10; change tab landing priority; replace Load button with View link
- `src/app/(app)/tournaments/[id]/page.tsx` — delete inline `V3MatchCard` definition; import from `@/components/V3MatchCard`
- `src/app/(app)/home/page.tsx` — add `useSearchParams` reader, `switchView` helper, `useEffect` to sync URL → state

## Implementation Notes

- All four call sites of `V3MatchCard` inside `tournaments/[id]/page.tsx` continue to pass `genderColor` exactly as today — the prop signature doesn't change.
- The `TournamentGroup` `defaultOpen` logic affects only the *initial* state. Once the user clicks the chevron, their choice persists in component state until next remount.
- The `fetchData` query currently filters by current year. With the new "View previous seasons" link, this is still appropriate — the matches page is for current-season recents, the home Events view is the archive.
- The home page already has `'use client'` at the top, so `useSearchParams` works.

## Visual Fidelity

The Results tab after this change should look like the existing tournament detail page's match list (the `V3MatchCard` cards with gender accent bar, Final/W/O/Retired status pill, round + court header, two-row scoresheet) — but grouped by tournament under the existing chunky group header used for Live/Upcoming, with most-recent-first ordering and per-group "Show all N matches" toggle.

The home Events view is unchanged visually — only its addressability changes.

## Accessibility

- The new `V3MatchCard` is a `<Link>` (already is) — keyboard accessible
- "View previous seasons" is now a `<Link>` instead of a `<button>` — also keyboard accessible
- The `view` query param sync uses `router.replace` so back-button doesn't accumulate noise
- The `defaultOpen` logic doesn't trap focus or break tab order — the chevron stays interactive

## Testing

- No new logic beyond existing helpers + a thin URL sync — no unit tests required
- Manual verification:
  1. Navigate to `/matches` with no live matches → should land on Upcoming
  2. Navigate to `/matches` with no live or upcoming matches → should land on Results
  3. Navigate to `/matches`, switch to Results manually → first tournament group expanded, others collapsed
  4. Each tournament group on Results renders match cards (not the home `ResultCard` style; specifically the `V3MatchCard` style with gender accent bar + Final pill + round/court header)
  5. A tournament group with >10 matches shows "Show all N matches" toggle
  6. Click the toggle → all matches visible, label changes to "Show less"
  7. Scroll to bottom of Results tab → "View previous seasons" link visible
  8. Click "View previous seasons" → lands on `/home?view=tournaments`, the home Events view is shown
  9. Browser back button from Events view → returns to `/matches` Results tab
  10. Open `/home?view=tournaments` directly in a new tab → lands on the Events view
  11. Tournament detail page (`/tournaments/[id]`) — verify match cards still render identically (no regression from `V3MatchCard` extraction)
  12. Home page Live/Upcoming tabs of the matches page render the existing `V3MatchRow` (unchanged)

## Rollout

Single PR, no feature flag, no migration. Pure client-side rendering + routing change.

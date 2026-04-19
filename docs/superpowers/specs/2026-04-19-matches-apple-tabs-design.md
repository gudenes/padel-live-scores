# Matches Page — Apple-Sports Tabs + Filter Sheet

**Status:** Draft · 2026-04-19
**Branch:** TBD (off `claude/badge-system`)
**Scope:** `src/app/[locale]/(app)/matches/page.tsx` only

## Problem

Users report the current app feels overwhelming — "too much information."  The Matches page is the primary entry point (and will become the landing page in a later phase), but today it uses three status-based tabs (`Live / Upcoming / Results`) that make the user think about state instead of time.  Competitors (SofaScore, FotMob, Apple Sports) default to a time-based mental model: *what happened yesterday, what's happening today, what's coming up*.

Secondary problems on the same page:
- `All / Men / Women` and `Premier / FIP` sub-filters are always visible, even when unused — chrome tax.
- Every tournament header has a 2px green or red bar across the top.  Green carries no information; red is redundant with three other live signals.
- The tournament header is a dark card-like block (`--bg-3`), heavier than needed for a section divider.

## Goal

Restructure the Matches page around a **time-based three-tab model** with a **filter sheet** for everything else.  Keep the existing chunky-polygon brand language, gender accent bars, and dual-player flags intact.

## Out of scope

- No change to the bottom nav.
- No change to match-detail page.
- No change to the dark theme or brand colors (no light-mode work, no rounded-button revamp).
- No change to the `V3MatchRow` internals (pair names, scores, gender bar, dual flags all stay exactly as they are).
- No new data fetches from the server — all filters are client-side predicates on the already-loaded match arrays.

## Design

### 1. Tabs: `Yesterday · Today · Upcoming`

Replace the three status tabs with three time-bucket tabs.  Each tab stacks a weekday + date under its label:

```
Yesterday    Today      Upcoming
 Apr 18     Apr 19      Apr 20+
```

- Active tab: label turns `#FFFFFF` / 800-weight; date flips to brand green (`#7ED321`); green underline pill sits below (same `clip-path` geometry the current page already uses).
- Inactive tabs: label `--muted` / 700-weight; date same color at 0.65 opacity.
- `Upcoming` date = the next day that actually has matches in the fetched list (computed client-side), plus `+` suffix to communicate "and beyond."
- Dates are localized via the existing `useFormatter()` + `DATE_SHORT` token.  Weekday is omitted (the label already names it for Yesterday/Today).
- Swipe between tabs is preserved via the existing `useSwipeTabs` hook (just relabel the three keys).

### 2. Filter icon + bottom sheet

A chunky-polygon icon button sits at the end of the tabs row (to the right, same baseline).

- Neutral state: `--bg-3` background, `--muted-2` icon color.
- Active state (≥1 filter applied): `--green-dim` background, `--green` icon, plus a chunky-polygon badge showing the applied-filter count.
- Clicking opens a bottom sheet (iOS-native feel) with these sections:
  1. **Circuit** — multi-select pills: `Premier Padel`, `FIP Tour`.  Replaces today's single-value `leagueFilter` with a `Set<'premier' | 'fip'>`.
  2. **Gender** — multi-select pills: `Men`, `Women`.  Replaces today's single-value `genderFilter`.  Pills use the existing `--men` / `--women` tints when active.
  3. **Level** — multi-select pills: `Major`, `P1`, `P2`, `FIP Gold`, `FIP Silver`.  New state.  Predicate: match `tournament.level` against the selected set.
  4. **Favourites only** — toggle.  When on, filter to matches whose tournament or any player is in the user's `useFollow` set.
  5. **Hide qualifiers** — toggle.  When on, drop matches where `round` matches `/qualif|qual|Q\d/i`.
- Footer: `Reset` (ghost) and `Apply · N filters` (solid brand green).  Apply closes the sheet; Reset clears all filters and closes.
- Tap scrim (or swipe the sheet's grip down) also closes without applying.

### 3. Active-filter chip strip

A thin row below the tabs (hidden when no filters are applied) shows each active filter as a removable chunky-polygon chip plus a `Clear` button aligned right.

- Chip color inherits the filter family: Circuit chips = `--green-dim`, Men = `--men-dim`, Women = `--women-dim`, Level / toggles = neutral.
- Tapping the `×` on a chip removes that one filter only.  `Clear` removes all filters and hides the strip.

### 4. Today view: `Live Now` strip + live-first sort

When the Today tab is active, a thin 1-row strip at the top of the list reads `● Live Now · N` in brand red, where `N` is the number of live matches (already in state via `liveMatches.length`).  The strip is hidden when `N === 0`.

The existing `groupByTournament` already sorts tournaments with live matches first — no change needed.  Today's view concatenates `liveMatches + scheduledMatches` (filtered to today's local date based on `scheduled_at`), then passes the combined array through `groupByTournament`.

### 5. Tournament grouping: light text header

Remove the dark `--bg-3` block and the 2px top accent bar entirely.  Replace with a flat light header row:

```
🇧🇪  BRUSSELS P2  ·  ROUND 16  ●  [3]
```

- Padding: `16px 14px 8px` on top of the default page background.
- Left: small 16×12 country flag (same `<FlagImage>` component already used).
- Tournament name: `11px / 800-weight / 0.5px tracking / uppercase / --text`.
- Dot separator: `var(--muted)`.
- Round label: `10px / 700-weight / uppercase / --muted` (reuses `mostAdvancedRound()`).
- Inline live pulse-dot (red, animated) — rendered only when any match in the group has `status === 'live'`.  Replaces the red top-bar.
- Right: chunky-polygon count badge (`9px / 700 / --muted-2 / rgba(255,255,255,0.04)` background).
- No chevron.  No collapse/expand behavior on the header.  (If we decide to bring collapse back later, it becomes a small caret button on the right; not in this scope.)

### 6. Dual player flags — unchanged

The existing dual-overlapping flag pattern from `V3MatchRow` is preserved verbatim:

```tsx
<div style={{ position: 'relative', width: 24, height: 18, flexShrink: 0 }}>
  <div style={{ position: 'absolute', top: 0, left: 0, zIndex: 2 }}>
    <FlagImage country={p1?.country ?? null} size={14} />
  </div>
  <div style={{ position: 'absolute', top: 5, left: 7, zIndex: 1 }}>
    <FlagImage country={p2?.country ?? null} size={14} />
  </div>
</div>
```

This is load-bearing for padel because pairs often have mixed nationalities (e.g. Galán ES / Chingotto AR).  The mockups kept this intact.

## Data & state changes

### Client state additions

```ts
// Existing (reshape):
const [circuits, setCircuits] = useState<Set<'premier' | 'fip'>>(new Set(['premier', 'fip']))
const [genders, setGenders]  = useState<Set<'men' | 'women'>>(new Set(['men', 'women']))

// New:
const [levels, setLevels] = useState<Set<string>>(new Set())    // empty = all levels
const [favouritesOnly, setFavouritesOnly] = useState(false)
const [hideQualifiers, setHideQualifiers] = useState(false)
const [filterSheetOpen, setFilterSheetOpen] = useState(false)
```

The `leagueFilter` / `genderFilter` single-value states get replaced by the sets above.  Existing call sites to those states are inside this same file — rewire locally.

### Tab-boundary predicates

- **Yesterday** — matches with `status in ('finished', 'retired', 'walkover')` AND `finished_at` in `[yesterdayStart, todayStart)` in the user's timezone (read `geo-timezone` cookie as today does).
- **Today** — `liveMatches` (all, unfiltered by date since they're happening now) UNION `scheduledMatches` where `scheduled_at` falls within `[todayStart, tomorrowStart)`.
- **Upcoming** — `scheduledMatches` where `scheduled_at >= tomorrowStart`.

### Fetch changes

- **Recent matches** query window tightens from "this calendar year" to "last 48 hours of finished_at" since only yesterday's results are needed for the tab.  Keeps the existing indexes hot.
- Live and scheduled queries are unchanged.
- No new fetches for the filter sheet — `levels` and gender/circuit all come from already-joined `tournament` + `category` on each match row.

### Filter count computation

```ts
const appliedFilterCount =
  (circuits.size < 2 ? 1 : 0)
  + (genders.size < 2 ? 1 : 0)
  + levels.size
  + (favouritesOnly ? 1 : 0)
  + (hideQualifiers ? 1 : 0)
```

A circuit or gender set that includes all values counts as "no filter." Level is a positive set (empty = no filter).

### Filter semantics

Filters compose with **AND across categories, OR within a category**. Example: selecting `Circuit: Premier Padel` AND `Gender: Men, Women` AND `Level: P1, P2` shows matches where circuit==premier AND (gender==men OR women) AND (level==P1 OR P2). An empty set for circuit/gender/level means "no constraint from this category." Favourites-only and hide-qualifiers are plain AND predicates layered on top.

### Timezone handling

All date boundaries (`yesterdayStart`, `todayStart`, `tomorrowStart`) are computed in the user's local timezone, read from the `geo-timezone` cookie the proxy sets. Fallback: `Intl.DateTimeFormat().resolvedOptions().timeZone`. Boundaries are midnight (00:00) in that timezone, converted to UTC for the query.

## Components touched

| File | Change |
|---|---|
| `src/app/[locale]/(app)/matches/page.tsx` | Main work: tab relabel, filter sheet, header rewrite, state refactor |
| `src/components/MatchesFilterSheet.tsx` | **New.**  The bottom-sheet UI component |
| `src/components/MatchesTabs.tsx` | **New.**  Extracted tabs row (keeps `page.tsx` readable) |
| `src/i18n/messages/*.json` | Add keys: `tabs.yesterday`, `tabs.today`, `tabs.upcoming`, `filters.circuit`, `filters.gender`, `filters.level`, `filters.favouritesOnly`, `filters.hideQualifiers`, `filters.reset`, `filters.apply`, `filters.clear`, `liveNow` |

No change to: `V3MatchRow`, `ResultCard`, `<FlagImage>`, `useSwipeTabs`, `groupByTournament`, `tournamentStatus`.

## Migration notes

- Query-param back-compat: if the URL still carries `?tab=live`, `?tab=upcoming`, or `?tab=results`, map them to `today`, `upcoming`, and `yesterday` respectively in the initial-tab effect.
- Ops dashboard deep-links that point at `/matches?tab=live` continue to work.

## Testing

Manual (author):
- Load page with no live matches → Live Now strip hidden; Today shows scheduled only.
- Load page with live + scheduled + finished in the window → all three tabs populated correctly.
- Toggle each filter; confirm the count badge on the icon updates; confirm chip strip renders/hides.
- `Reset` inside the sheet → all pills clear, chip strip hides.
- Swipe between tabs → `useSwipeTabs` still drives it.
- User in PT locale → dates render `"18 abr."` etc.
- User with no `favorites` set → `Favourites only` toggle produces empty-state.

Unit (Vitest, where worth the cost):
- `computeYesterdayWindow(timezone)` — returns correct start/end ISO strings.
- `computeUpcomingStart(timezone)` — returns correct tomorrow-midnight.
- `applyFilters(matches, filters)` — a small table-driven test exercising the compound predicate.

No new e2e tests in scope.

## Non-goals / deferred

- Collapsing/expanding tournaments on the header (removed for now; can return as a caret if users miss it).
- Light-mode / round-button / lime-new-palette revamp from earlier brainstorms — explicitly deferred.
- A dedicated "Tournaments" bottom-nav tab — deferred.
- Discover page rework — deferred.

## Open questions

- **Upcoming empty state:** if there are no scheduled matches at all, do we show a skeleton with "Check back closer to match day" like today, or a date-picker CTA? (Default: keep today's empty state copy; date-picker is future work.)
- **Sheet animation on iOS keyboard:** the sheet slides up from the bottom — on a keyboard-active page this could cover the input. The sheet never sits above a text input on the matches page, so this is theoretical, but worth a QA pass on iOS Safari.

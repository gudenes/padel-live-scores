# Matches Page — Full Redesign

**Status:** Draft · 2026-04-19
**Branch:** `claude/badge-system` (layers on top of the Apple-tabs work merged as 15 commits up to `044416d`)
**Scope:** `src/app/[locale]/(app)/matches/page.tsx`, `src/components/MatchesTabs.tsx`, `src/components/MatchesFilterSheet.tsx`, plus 2 new components (see File structure)

**Preceding work:** [docs/superpowers/specs/2026-04-19-matches-apple-tabs-design.md](2026-04-19-matches-apple-tabs-design.md) introduced the three-tab (Yesterday/Today/Upcoming) structure, filter sheet, light-text tournament headers, and chip strip. This spec extends and revises that surface — it does not replace the filter sheet / chip strip / 48-hour fetch window, but does replace the tab system, the tournament header visual, and the match-row layout.

## Problem

The Apple-tabs redesign landed a big step forward but left two classes of friction that became obvious during iteration:

1. **Fixed 3-day reach.** Yesterday / Today / Upcoming is the right mental model for *today*, but "Upcoming" collapses everything past tomorrow into one bucket. Padel has long gaps between tournament weeks — fans checking "what's on Saturday" have no affordance to jump there directly, and the Upcoming label itself misleads (they expect tomorrow, not a month out).
2. **Visual density + hierarchy.** Match rows carry three rows of content (meta pills + two pair rows), the tournament grouping is a flat light-text header without visual containment, and the live/status signals are scattered (red bar on tournament header, red pill inside row, red chip in header — removed in Apple-tabs but the hierarchy never recovered).

Secondary misses:
- No one-tap "only live" filter. Users have to open the sheet and toggle a combination that's not obvious.
- Upcoming rows don't expose bookmark + notify actions inline. Users must drill into match detail to act.
- Live score reads as a single number sequence (`6 3 30`) with no visual break between "what happened" and "what's happening right now".

## Goal

Ship a cohesive Matches page that:
1. Lets fans pick any calendar day (past or future) via a horizontal date strip.
2. Makes "only live" a one-tap toggle alongside the filter icon.
3. Presents tournaments as visually-contained cards with clear Premier-Padel / FIP-Tour identity.
4. Compresses each match to two rows of content (one per pair) with a clear live-point visual break.
5. Exposes bookmark + notify actions inline on upcoming matches.

## Out of scope

- Match detail page (unchanged).
- Bottom nav structure (unchanged).
- Light-mode / round-buttons / neon-lime-palette revamp (explicitly deferred from earlier brainstorms).
- Home / Discover / Tournaments / Rankings destination redesign (follow-ups).
- Any change to the backend APIs, score pipeline, or data model.
- Notification subscription backend (we assume the existing `useFollowing` + a to-be-added notify-subscribe endpoint handle it; wiring notify UI is in scope, server work is not).

## Design

### 1. Tabs row → swipeable date strip + stacked action column

Replace the three fixed tabs with a horizontally-scrollable date strip. The Filters icon and a new Live toggle sit as a two-button stack to its right, sharing the full row height.

**Layout grid** (inside the existing `.tabs-row` container):
```
[ date strip — flex:1, scroll-x ] [ action stack — 64px ]
```

**Date strip**
- Each day is a button with stacked content:
  - Weekday abbreviation (`Fri`) — 10 px, 700, muted uppercase
  - Day number (`18`) — 17 px, 700, text color
  - Relative label (`Today`/`Yest.`/`Tom.`) — 9 px, 800, muted; only shown on days -1/0/+1
- Active day: number turns white / 800-weight, relative label turns brand green, green underline pill underneath (re-uses the existing `clip-path: polygon(3% 0%, 97% 0%, 100% 100%, 0% 100%)`)
- Scroll behavior: `overflow-x: auto` + `scroll-snap-type: x mandatory` with each day `scroll-snap-align: center`. `-webkit-overflow-scrolling: touch` for iOS momentum
- Scrollbar hidden on all platforms
- Fade mask on both edges (gradient to `var(--bg)` over 28 px) — signals scrollability
- On mount: scroll Today into the centre of the visible area. Re-scroll Today to centre on any `dateOffset = 0` transition (e.g., tapping Today from a day far out)
- Date range rendered: **±14 days** from today, recomputed client-side on mount. 29 buttons total — enough for the common "next two weeks" case without lazy-loading complexity. Tapping the right-edge day (`+14`) does *not* auto-extend; users needing further-out dates use the calendar icon (see below, optional follow-up)

**Action column (64 px wide, `align-self: stretch`, padding `12px 0 18px`)**
- `display: flex; flex-direction: column; gap: 6px;`
- Two buttons, `flex: 1` each so they split the column evenly (matches full tab height)
- Both use existing chunky-polygon `CHUNKY.badge` clip-path

**Filters button (top)**
- Icon: existing three-line filter SVG from `MatchesTabs.tsx`
- Label: `Filters` (10 px, 800)
- Neutral state: `var(--bg-3)` bg, `var(--border)` border, `var(--text-sub)` color
- Active state (when `countAppliedFilters > 0`): `var(--green-dim)` bg, transparent border, `var(--green)` color
- Count badge (when `> 0`): small green chunky-polygon badge in top-right corner with the count

**Live toggle button (bottom)**
- Icon: 7 px circle dot (no SVG)
- Label: `Live` (10 px, 800)
- Neutral state (`liveOnly === false`): `var(--bg-3)` bg, `var(--muted-2)` color, grey dot
- Active state (`liveOnly === true`): `var(--live-strong)` bg (`rgba(255,77,95,0.18)`), `var(--live)` color, pulsing red dot (existing `v3-scores-pulse` animation)
- Tap toggles `liveOnly`. Rendered as **disabled** (`opacity: 0.5`, `pointer-events: none`) when the current day has zero live matches — keeps the row layout stable without inviting a confusing tap

### 2. Tournament card (replaces light-text header)

Each tournament wraps its matches in a visually-contained card:

```
╭──────────────────────────────────────────────────╮
│ [circuit logo 72×36] │ City, Country   │ live▪3│
│                      │ [P2] · Final    │  badge │
├──────────────────────────────────────────────────┤
│ [match row 1]                                    │
├──────────────────────────────────────────────────┤
│ [match row 2]                                    │
╰──────────────────────────────────────────────────╯
```

- Outer container: `margin: 14px 12px 0`, `background: var(--bg-2)`, `border: 1px solid var(--border-strong)`, `clip-path: polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)` (the existing `CHUNKY.card`), `box-shadow: 0 4px 12px rgba(0,0,0,0.25)`
- Header grid: `[72px logo] [1fr meta] [auto right-col]`, padding `14px 14px 12px`, subtle tint `rgba(255,255,255,0.02)`, hairline bottom border
- **Logo cell**: 72 × 36, hairline right-border acting as separator. Image source depends on tournament circuit:
  - Premier Padel: `/premier-padel-logo.svg` (asset lives in `public/`)
  - FIP Tour: `/fip-tour-logo.svg` (asset lives in `public/`)
  - Other (future): fallback to existing `FlagImage country={tournament.country}` at 36 px
- **Meta**: stacked two lines
  - Line 1: `City, Country` derived from `tournament.location` (when present) and `tournament.country` (resolved via existing country-code map). 14 px / 800-weight / mixed-case / tight letter-spacing (`-0.1px`)
  - Line 2: level pill + ` · Round` label. Level pill uses tiered tint — `p1/p2/major/finals` → green, `fip_gold` → gold, `fip_silver` → silver-grey, etc. (mapping in `src/lib/tournament-labels.ts`, extend if needed). Round label from existing `mostAdvancedRound(matches)`
- **Right column**: small `Live · N` chip (red-tint, pulsing dot) when any match is live, above a neutral count badge (total match count in the group)
- When `tournament.logo_url` exists AND the circuit isn't Premier/FIP-Tour, fall back to the tournament-specific logo. Individual tournament logos are NOT used for Premier/FIP events — circuit branding is stronger.

### 3. Match row — compact 2-row layout

Each match row renders as:

```
│▍ [flag1][flag2]  Pair 1 Name         [right-side]│
│▍ [flag3][flag4]  Pair 2 Name         [right-side]│
```

- Grid: `[1fr pairs] [auto right-side]`, padding `12px 14px 12px 17px`
- Left 3-px accent bar (men-blue / women-purple) via existing `V3MatchRow` pattern
- `pairs`: stacked 2 rows, 8 px gap
- Each pair row:
  - Dual-flag container (24 × 18) — existing pattern preserved verbatim: 14 × 10 flags offset (top/left 0 + 0, top/left 5 + 7)
  - Pair name: 14 px / 700-weight / `var(--text)` (winner) or `var(--muted-2)` at 0.75 opacity (loser)
- No meta-pill row (court / round / status moved out)
- No longer rendered: `KHUFU · CC`, `CENTRE · MEN`, `Live · Set 2` chunky pill, `FINISHED` pill

**Right-side variants** (chosen per match status):

**Live (`status === 'live'`)** — 4-column grid `[set-label] [set-cols] [1px divider] [pts-col]`, `column-gap: 8px`, `align-items: center`:
- **Set label**: stacked two lines, both red
  - `ord`: `1st` / `2nd` / `3rd` / `4th` / `5th` — 12 px / 900
  - `unit`: `set` — 9 px / 700 / uppercase / 0.85 opacity
- **Set columns**: one column per completed+current set, each column stacks pair-1 / pair-2 scores. 15 px / 800 / monospace, tabular-nums. Current set in green (`var(--green)`), winner in white
- **Divider**: 1 px vertical hairline (`rgba(255,255,255,0.18)`), full row height — visual break between "historical" and "live point"
- **Pts column**: stacked pair-1 / pair-2 live point score (`0`/`15`/`30`/`40`/`AD`). 16 px / 900 / monospace / `var(--live)` / min-width 22 px

**Finished (`status ∈ {finished, retired, walkover}`)** — vertical flex, right-aligned:
- `Final` label — 8 px / 900 / uppercase / `var(--muted)`
- Set-score rows — one line per pair, 15 px / 800 / monospace / tabular-nums; winner in white, loser in muted-2

**Scheduled/Upcoming (`status === 'scheduled'`)** — horizontal flex, right-aligned:
- Vertical action cluster (30 × 30 each, 6 px gap):
  - **Star (bookmark)**: neutral outline when not starred; gold fill + gold tint bg when starred. Wired to existing `useFollowing({ type: 'match', targetId: match.id }).toggle()`. Reuses the existing `FollowButton` logic
  - **Bell (notify)**: neutral outline when not subscribed; green fill + green tint bg when on. Wired to a new `/api/user/notifications` endpoint — see "Notification wiring" below
- Time cell — right-aligned:
  - `APR 19` date — 10 px / 600 / muted / letter-spaced
  - `18:00` time — 16 px / 800 / green / tabular-nums
  - When `scheduled_at` is approximate (existing `schedule_label` detects "Not before" / "Followed by"), append `*` to the time

### 4. State shape

```ts
// Current (Apple-tabs)
const [tab, setTab] = useState<'yesterday' | 'today' | 'upcoming'>('today')

// New
const [dateOffset, setDateOffset] = useState<number>(0)  // days from today
const [liveOnly, setLiveOnly] = useState<boolean>(false)
```

`tab` is removed. The tab-boundary predicates are replaced by one predicate keyed on `dateOffset`:

```ts
// For the selected date, compute window [dayStart, dayStart + 24h) in user tz
const dayStart = addDays(todayStartFromTz(timezone), dateOffset)
const dayEnd   = addDays(dayStart, 1)

// Slice by day:
// - Today (dateOffset === 0): live matches UNION scheduled-today UNION finished-today
//   (finished-today was NOT shown anywhere in the Apple-tabs version — bug fix)
// - Past (dateOffset < 0):  finished within [dayStart, dayEnd)
// - Future (dateOffset > 0): scheduled within [dayStart, dayEnd)
const dayMatches = useMemo(() => {
  if (dateOffset === 0) {
    return dedupeById([
      ...liveMatches,
      ...scheduledMatches.filter(m => withinDay(m.scheduled_at, dayStart, dayEnd)),
      ...recentMatches.filter(m => withinDay(m.finished_at, dayStart, dayEnd)),
    ])
  }
  if (dateOffset < 0) {
    return recentMatches.filter(m => withinDay(m.finished_at, dayStart, dayEnd))
  }
  return scheduledMatches.filter(m => withinDay(m.scheduled_at, dayStart, dayEnd))
}, [liveMatches, scheduledMatches, recentMatches, dayStart, dayEnd])

// Apply filters, then optionally narrow to live-only
let shown = applyFilters(dayMatches, filters)
if (liveOnly) shown = shown.filter(m => m.status === 'live')
```

### 5. Data fetching changes

- `scheduledMatches` query window: today `.limit(50)` → `.gte('scheduled_at', tomorrowStart).limit(200)` — covers ~14 days at typical tournament volume. Still a one-shot query on page load; no per-day lazy loading
- `recentMatches` query window: today's 48 h → `14 days back` from today (match the strip's past reach). Still `.limit(200)` to cap
- Realtime subscription unchanged
- Auto-refresh (30 s) gate: stays as `dateOffset === 0` (previously `tab === 'today'`)

### 6. Notification wiring (new)

Per-match notification subscription is net-new functionality. MVP:
- Tapping the bell on an upcoming match hits a new endpoint `POST /api/user/notifications/matches/{id}` (server stores a row in a new `user_match_notifications` table — schema out of scope for this spec, handled in a separate follow-up)
- For this UI spec, the button wiring is:
  ```ts
  const { notify, toggleNotify } = useMatchNotification(match.id)
  ```
  `useMatchNotification` is a new client hook that reads/writes a localStorage-backed set for anonymous users and hits the API for logged-in users — mirrors the pattern already in `useFollowing`
- If the backend endpoint doesn't exist yet at implementation time, the UI ships with localStorage-only support and an inline `// TODO: wire to API once endpoint lands` marker. The UI is still useful anonymous-only (local reminder); the full push-notification integration is a follow-up

### 7. Legacy back-compat

- `?tab=live`   → `dateOffset=0, liveOnly=true`
- `?tab=upcoming` → `dateOffset=+1`
- `?tab=results` → `dateOffset=-1`
- New: `?date=YYYY-MM-DD` → parse and compute `dateOffset`. Invalid or out-of-range dates ignored (default to 0)
- URL updates on user interaction: `?date=YYYY-MM-DD` (replaces `?tab=`). `?tab=` is only accepted on incoming deep-links, never written

### 8. i18n keys (new)

Add to `src/messages/{en,es,pt,it,fr}.json` under `matches.*`:

- `matches.live` — already exists
- `matches.liveOnly` — "Live only" / "Solo en directo" / etc.
- `matches.bookmarkMatch` — "Bookmark match" / …
- `matches.notifyOnMatchStart` — "Notify when match starts" / …
- `matches.setOrdinal.{1,2,3,4,5}` — `1st`, `2nd`, etc. (English uses suffixes; other locales use their own ordinal form, e.g. Spanish `1º`)
- `matches.setUnit` — `set`
- Day labels come from existing next-intl `dateFormatter` using weekday/day tokens; no new keys needed for the date strip

## File structure

| File | Action | Responsibility |
|---|---|---|
| `src/components/MatchesTabs.tsx` | **Modify (major)** | Rename to `MatchesDateStrip.tsx`. Render horizontal date strip + stacked Filters/Live action column |
| `src/components/MatchesFilterSheet.tsx` | **Keep as-is** | No changes |
| `src/components/TournamentCard.tsx` | **New** | Extract the tournament container (header + match rows wrapper) out of `matches/page.tsx`. Renders all three states (live, finished, upcoming) |
| `src/components/MatchRow.tsx` | **New** | Extract the 2-row match row out of the existing inline `V3MatchRow` in `matches/page.tsx`. Branches on status for the right-side variant. Receives `match`, `useFollowing`, `useMatchNotification` hooks |
| `src/hooks/useMatchNotification.ts` | **New** | Thin wrapper hook for per-match notification subscribe/unsubscribe. localStorage-only until API lands |
| `src/app/[locale]/(app)/matches/page.tsx` | **Modify (major)** | Replace the existing tab state with `dateOffset` / `liveOnly`. Mount `MatchesDateStrip`, iterate `TournamentCard`s. Drop the inline `TournamentGroup`, `V3MatchRow`, `LiveNowStrip`, `TabPanel` definitions now that they're either extracted or unused |
| `src/messages/*.json` | **Modify** | Add new keys listed above |
| `src/lib/matches-filters.ts` | **Keep as-is** | `applyFilters` + `tabForLegacyParam` still used |

Component file count is deliberate: `MatchesDateStrip`, `TournamentCard`, `MatchRow` are the three visual units. Each has a single responsibility and a clean prop interface. `matches/page.tsx` ends up under ~400 lines (down from current ~900 after Apple-tabs).

## Migration plan

The new surface layers on top of the Apple-tabs state. Concretely the diff-from-current is:

1. `MatchesTabs` → `MatchesDateStrip` (replace component, update call site)
2. Inline `V3MatchRow` → `MatchRow` extraction, new right-side variants
3. Inline `TournamentGroup` → `TournamentCard` extraction, new header visual
4. `tab: Tab` state → `dateOffset: number` + `liveOnly: boolean`
5. Query-param handling extended
6. Data fetches widened
7. New notify endpoint stub + hook

Each of these becomes a task in the plan.

## Testing

Unit (Vitest, new tests in `src/lib/__tests__/matches-filters.test.ts` — extend existing file):
- `computeDayWindow(now, tz, dateOffset)` — verify boundaries for offsets `-14 … +14`, including DST transitions in a couple of timezones
- `parseDateParam(raw, today)` — handles valid ISO, invalid strings, out-of-range dates
- `tabForLegacyParam` → `{ dateOffset, liveOnly }` — extends the existing remap

Manual (preview):
- Scroll the date strip, confirm snap-centering on Today
- Tap a day ±7 days out, confirm matches load (or empty state renders when there are none)
- Tap Live toggle, confirm only `status === 'live'` matches remain
- Bookmark + notify star/bell toggles persist across reload (localStorage), badge correctly reflects state
- Deep-link `?tab=live` remaps, `?date=2026-05-01` jumps to that day
- Locale switch: tab labels, level pill, notify tooltip all translate

No new e2e tests.

## Non-goals / open questions

- **Calendar popover** for dates beyond ±14: nice-to-have, not in MVP. Users can navigate ±14 days which covers typical tournament weekly cadence.
- **Per-day score-data prefetch**: currently the whole strip is served by one `scheduledMatches.limit(200)` query. When a user scrolls very far out and there are actually more than 200 upcoming matches, they see empty days — fine for now; a follow-up can add date-range fetches on demand.
- **Notification backend**: this spec only wires the UI to a future endpoint. Server work is tracked separately.
- **Match detail page (`/match/[id]`)**: currently reached by tapping a row. That link target doesn't change — detail page modernization is a separate spec.
- **"Live Now · N" strip from Apple-tabs**: removed in this redesign. The Live toggle button + inline `Live · N` chip on each tournament card cover the same information more compactly.

# Tournament Draw — design

**Date:** 2026-05-09
**Status:** approved (brainstorming complete, ready for plan)
**Scope:** v1 — main draw only, mobile-first, read-only with road-to-trophy interaction

## Goal

Ship an interactive bracket view for tournament draws that's readable on
mobile, gives users an unmistakable "this is a tournament bracket" feel, and
lets them explore the road to trophy by tapping any pair to follow their path
through the draw.

The padel space has a clear gap here: Premier Padel ships PDF-only draws,
FIP ships a static desktop bracket, and the only competitor with a clean
mobile UI (X3 Padel) loses the visual drama of a bracket tree. Tennis is
the benchmark — ESPN's May 2025 redesign pairs round-by-round columns with
favorite-player highlighting across the bracket, and that's the bar we're
matching with our existing data advantages.

## Non-goals (v1)

- Qualifying-round brackets (Q1/Q2/Q3) — out of scope, see empty-state
  treatment below
- Predict-the-bracket / pick a champion — separate product, separate URL
  (Roland Garros pattern)
- Desktop full-bracket SVG view — mobile-first only in v1; we can add a
  `≥768px` full-tree affordance later
- Multi-pair tracking — one pair followed at a time, by design
- Backfilling missing `round_canonical` data — tab is gated on existing
  data quality
- Sharing the bracket as an image — separate share-system work

## What ships

A new `Draw` tab on `/tournaments/[id]`, peer to `Overview / Story / Matches`.
Tab is visible when both gates pass:

1. `tournaments.level IN ('major', 'p1', 'p2', 'finals', 'fip_bronze',
   'fip_silver', 'fip_gold', 'fip_platinum')`
2. ≥80% of the tournament's main-draw matches have `round_canonical`
   populated

The existing `M | W` toggle controls which category's bracket renders.
Lower-tier (`fip_other`) and historical padelapi-only tournaments without
bracket data don't get the tab — they keep the existing Matches-tab
experience.

## Visual design

Two layers stacked, both contributing to the bracket-feel:

### Layer 1 — Mini-bracket map (top, ~140px tall)

A small SVG that renders the entire tournament tree as nodes connected by
links, rounds left-to-right (`R32 R16 QF SF F`). The currently-tracked
pair's path is the visual story:

- **Solid green nodes + links** — the rounds the tracked pair has played and
  won
- **Bright green node** — the round the pair is currently active in (live or
  scheduled)
- **Dashed grey links** — where they could still go (upcoming rounds)
- **Trophy ★** at the F node, orange (`#F5A623`)
- **Faint grey nodes/links** for the rest of the bracket structure that
  isn't on the tracked pair's path

Each node is a tap target — tapping a round's node jumps the round chip
strip to that round.

A small label above the map reads `<Pair name> · road to trophy` and
changes when the tracked pair changes.

### Layer 2 — Round chip strip + cells with stubs

Below the map, a chip strip mirrors the map's "passed / active" treatment
(`R32 R16 QF SF F`). Chips up to the tracked pair's last round are filled
green; the round they're currently in is white-on-black (active);
remaining are grey. The chip strip is also a navigation control — tap a
chip to switch which round's cells render below.

For the active round, cells render as a vertical list, paired into groups
of two with a small SVG bracket-stub on the right edge of each pair-group.
The stub visually pairs two adjacent cells into one next-round slot, so
the cells themselves read as bracket positions, not just a list.

Each cell shows:
- Two pair rows (top + bottom)
- Per-pair: seed pill (if seeded), Q/WC/LL marker pill (if qualifier/wild
  card/lucky loser), country flag, pair name in `Lastname/Lastname` short
  form
- Per-pair set scores (right-aligned, tabular numerals)
- Green W badge on the winner row when finished
- Red live-pulse dot when status is `live`
- Italic grey scheduled-time line when status is `scheduled`
- The whole cell is a link to `/match/[id]` (existing behavior preserved)
- The pair-name area is a separate tap target — tapping it switches the
  tracked pair without navigating to match detail
  (`e.stopPropagation()`)

### The "Following" pill

A persistent context bar between the round chip strip and the cells:

- **Green** when user-set (tap-to-track)
- **Orange** when default-set (defending champion auto-load)
- **× icon** — dismisses, falls through to the next default in the
  priority chain

Pill text:
- `Following · <Pair name>` (active)
- `Following · <Pair name> · out in QF` (eliminated — appended phrase)
- `Defending champ · <Pair name>` (orange variant)

### Default tracked-pair priority

On Draw-tab entry, resolve the default tracked pair in order:

1. If user has bookmarked a player who appears in this draw → that player's
   pair (highest-seeded one if multiple bookmarks present)
2. Else if there's a defending champion (last year's same-tournament
   winner) and at least one of the two champions appears in this year's
   draw → that pair
3. Else `null` — no default highlight, both layers render in their neutral
   "no path" treatment

Defending-champion match logic: if either player from last year's winning
pair appears in this year's draw, highlight whichever pair contains them.
If the two champions split into different pairs this year, fall through to
no highlight (ambiguous).

### Footer key

A one-line legend at the bottom: `Q Qualifier · WC Wild card · LL Lucky
loser · [1] Seed`. Reused on both `M` and `W` brackets.

## Architecture

The Draw tab is a pure-render feature on top of existing data. No new DB
tables, no new sync workers, no scraping changes. Everything we need is
already populated:

| Field | Source | Status |
|---|---|---|
| Match rows with bracket positions | `matches.round`, `matches.round_canonical` | populated |
| Pair seeds | `matches.pair1_seed`, `matches.pair2_seed` | populated (2026-05-01) |
| Player names + flags + UUIDs | `matches.pair*_player*_id` joined to `players` | existing |
| Q/WC/LL markers | `tournament_draws.marker` | populated for FIP events |
| Set scores per match | `sets` | existing |
| Live point indicator | `matches.status='live'` | existing |
| Per-round schedule | `tournaments.round_schedule` | populated (2026-05-08) |
| Tournament tier gating | `tournaments.level` | existing |
| Defending champion lookup | Cross-source dedup logic | existing (used by hub page) |

### Data flow

1. Tournament page already loads matches via the existing query in
   `src/app/[locale]/(app)/tournaments/[id]/page.tsx`. The Draw tab reuses
   this loaded data — no new fetch.
2. A pure helper `buildBracket(matches, drawSize)` filters main-draw
   matches for the active category, sorts by `(round_canonical,
   draw_position)`, and returns a structured tree:

   ```ts
   type RoundCode = 'R64' | 'R32' | 'R16' | 'QF' | 'SF' | 'F'

   type BracketNode = {
     round: RoundCode
     positionInRound: number              // 0-based, top to bottom
     match: Match | null                  // null = upcoming/TBD slot
     feedFromTop: BracketNode | null      // previous-round cell feeding this slot's top pair
     feedFromBottom: BracketNode | null   // previous-round cell feeding this slot's bottom pair
   }
   ```

3. A second helper `tracePairPath(bracket, pairKey)` walks the tree and
   returns:

   ```ts
   type PairPath = {
     nodes: BracketNode[]      // every cell where the pair appears
     eliminatedAt: RoundCode | null  // null if still active or champion
   }
   ```

4. A third helper `defaultTrackedPair(bracket, bookmarkedPlayerIds,
   defendingChampPair)` returns the initial `pairKey` per the priority
   chain, or `null`.

`pairKey` is a stable string identifier for a pair — recommend
`${player1Id}::${player2Id}` with the smaller UUID first, so the same
pair always produces the same key regardless of which slot they're in.

### Realtime

The existing realtime subscription on `matches` for this tournament
(already wired in `page.tsx`) covers live score + status updates. The
`trackedPairKey` reactivity flows through naturally — a re-render redraws
the green path on the map and the cell highlight in place.

### File layout

Colocated under the tournament page folder, following the project's
"split mega-pages into same-folder siblings, no enterprise abstractions"
preference:

```
src/app/[locale]/(app)/tournaments/[id]/
├── page.tsx                 (existing — adds 'draw' to tab list, mounts <DrawTab/>)
├── DrawTab.tsx              (new — orchestrator: state, layout)
├── BracketMap.tsx           (new — top SVG mini-bracket)
├── BracketRoundList.tsx     (new — round chip strip + cells)
├── BracketCell.tsx          (new — single match cell, tap-to-track)
├── FollowingPill.tsx        (new — green/orange pill)
└── bracket-builder.ts       (new — pure helpers, unit-tested)
```

`bracket-builder.ts` lives in the same folder rather than `src/lib/`
because nothing else in the codebase needs it. If a second consumer ever
appears, that's when it moves.

### State

All state is component-local — no global store, no new context.
`DrawTab.tsx` owns:

- `trackedPairKey: string | null` — initialized via `defaultTrackedPair`,
  changed by tap-to-track or × dismiss
- `activeRound: RoundCode` — defaults to the latest round with a
  played-or-live match (so first load lands on the most-relevant round)

### i18n

New keys under `draw.*` namespace, all 5 locales (`en`, `es`, `pt`, `it`,
`fr`):

- `draw.tab` — `Draw`
- `draw.following` — `Following`
- `draw.defendingChamp` — `Defending champ`
- `draw.roadToTrophy` — `road to trophy`
- `draw.outInRound` — `out in {round}` (ICU plural-safe)
- `draw.byeLabel` — `BYE`
- `draw.winnerOf` — `Winner of {feed}`
- `draw.tbd` — `TBD`
- `draw.preDrawEmpty` — `Main draw starts {date}. See all matches →`
- `draw.legendQ` — `Qualifier`
- `draw.legendWc` — `Wild card`
- `draw.legendLl` — `Lucky loser`
- `draw.legendSeed` — `Seed`

Use descriptive paths and provide disambiguating context per the project's
translation policy.

## Components

### `DrawTab.tsx` — orchestrator

- Owns `trackedPairKey` and `activeRound` state
- Computes `bracket` via `buildBracket(matches, drawSize)`
- Computes `trackedPath` via `tracePairPath(bracket, trackedPairKey)`
- Resolves default tracked pair on mount
- Renders empty state when no main-draw matches yet exist (qualifying
  window) — points user to Matches tab
- Layout: `<FollowingPill />` (conditional), `<BracketMap />`,
  `<BracketRoundList />`, footer key

### `BracketMap.tsx` — top SVG mini-bracket

- Receives `bracket`, `trackedPath`, `activeRound`,
  `onJumpToRound(round)`
- Pure SVG render — no internal state
- Renders nodes (small circles per round position) and links (lines
  pairing two cells into their next-round slot)
- Solid green = path the tracked pair has walked
- Bright green = current round node
- Dashed grey = potential future path
- Trophy ★ at F node
- Each node is a tap target

### `BracketRoundList.tsx` — chip strip + scrollable cells

- Chip strip mirrors map's passed/active treatment, also navigable
- For active round, renders cells in `positionInRound` order, paired into
  groups of two with a small SVG stub between them
- TBD cells render `Winner of <feeder>` placeholder rows when
  `match: null`

### `BracketCell.tsx` — single match cell

- One element. Renders both pairs, seeds, flags, set scores, live pulse,
  W badge, scheduled time
- Cell is a `<Link>` to match detail (preserves existing flow)
- Pair-name area inside is a separate `<button>` calling
  `onTrackPair(pairKey)` with `e.stopPropagation()`
- Visual states: default, highlight-green (tracked), highlight-orange
  (defending champ), dim (eliminated tracked pair, off-path), live-pulse

### `FollowingPill.tsx` — context bar

- Shows current tracked pair with × dismiss
- Green for `Following`, orange for `Defending champ`
- Suffix `· out in <round>` if pair is eliminated

### `bracket-builder.ts` — pure helpers

```ts
export function buildBracket(
  matches: Match[],
  drawSize: number,
): BracketNode[]

export function tracePairPath(
  bracket: BracketNode[],
  pairKey: string | null,
): PairPath

export function defaultTrackedPair(
  bracket: BracketNode[],
  bookmarkedPlayerIds: string[],
  defendingChampPair: { player1Id: string; player2Id: string } | null,
): string | null

export function pairKeyFor(player1Id: string, player2Id: string): string
```

No I/O, no React, no Supabase. Easy to unit-test.

## Edge cases

| Case | Behavior |
|---|---|
| Match has no `pair*_player1_id` (TBD upcoming round) | Cell renders `Winner of <feed>` with feeding pairs' names if available, else `TBD vs TBD` |
| `tournament_draws.marker = Q/WC/LL` | Marker pill renders next to seed pill (`[Q]`, `[WC]`, `[LL]`) |
| Pair retired/walkover mid-match | Existing `MatchCard` retirement handling reused — green W on winner, RET annotation on loser |
| Tracked pair has a bye in R32 | Map shows path starting from R16; the R32 node for that pair renders as a `BYE` label (small, grey) instead of a circle |
| Draw not yet released (entry list known, no bracket) | Empty state: "Draw releases {date}. See entry list →" with button to Overview tab |
| Some main-draw matches missing `round_canonical` | Tab visibility check fails (≥80% gate); tab is hidden, fall back to Matches tab |
| Bracket size mismatch (data has 14 R32 matches not 16) | Render existing cells, fill structural placeholders to next power of 2 |
| Realtime score update during render | React reconciles naturally — pulse re-flashes, scores update in place |
| User taps a player on the opponent of currently-tracked pair | `trackedPairKey` switches, map redraws to new pair's path |
| Defending champion not playing this year | Auto-default falls through to no-highlight; pill not rendered |
| Defending champions split into different pairs this year | Fall through to no-highlight (ambiguous) |
| Multiple bookmarked players in this draw | Pick the pair with the lowest seed number (most-seeded). If none of the candidate pairs are seeded, pick the one whose first player has the alphabetically-first surname (deterministic tiebreak) |
| Bye in R32 (top seed gets a free pass to R16) | Detected as: an R16 match where one of the pairs has no R32 match feeding into them. Render `BYE` label at the R32 position in the map; in the round list, the R32 round shows `<Pair name> · BYE` placeholder rows for the byed seeds |
| `buildBracket` throws on malformed data | Log to console, render flat list of cells (graceful degrade) |
| Failed match fetch | `<EmptyState>` with retry button (existing pattern) |
| Failed defending-champion lookup | Silently fall through to next default — not load-blocking |
| Pre-main-draw window (qualifying days) | Empty state: "Main draw starts {date}. See all matches →" with button to Matches tab |

## Testing

### Unit — `bracket-builder.test.ts`

Critical-path tests for the bracket-tree logic. This is where bugs hide.

- `buildBracket` 16-pair bracket → 8+4+2+1 = 15 nodes with correct
  `feedFromTop`/`feedFromBottom` links
- `buildBracket` 32-pair bracket → 16+8+4+2+1 = 31 nodes
- `buildBracket` with missing R32 matches → returns structural slots with
  `match: null`
- `buildBracket` with a bye in R32 → seeds R16 cell directly, no R32
  placeholder
- `tracePairPath` for a champion → 4 nodes (R32→R16→QF→SF→F),
  `eliminatedAt: null`
- `tracePairPath` for a QF-eliminated pair → 3 nodes, `eliminatedAt: 'QF'`
- `tracePairPath` for a pair not in the draw → empty array
- `defaultTrackedPair` with bookmarked player in draw → that pair's key
- `defaultTrackedPair` with no bookmarks but defending champ in draw →
  champ pair's key
- `defaultTrackedPair` with neither → `null`
- `pairKeyFor` is order-independent

### Visual smoke tests — manual via dev server

- Brussels P2 men's draw renders with expected 32-pair structure
- Tap a pair → green path traces correctly across rounds
- Tap eliminated pair → chip strip ends at correct round, off-path cells
  dim
- × clears highlight, falls back to defending-champion default
- Switching `M`/`W` toggle re-resolves defaults and redraws the map
- Scheduled cell shows time, live cell shows pulse, finished cell shows W
  badge
- FIP Gold Almaty draw renders with Q/WC/LL marker pills

### No new integration tests

Data layer is unchanged. Existing match-load and realtime tests cover the
fetch path. The bracket logic is pure and unit-tested; the rendering layer
is verified visually in dev.

### Pre-flight before merge

- `npx vitest run src/lib/__tests__/bracket-builder.test.ts` (or
  colocated path) — all green
- Verify Draw tab renders for a known Premier P2 + a known FIP Gold
  tournament in dev
- Confirm tab is hidden on a `fip_other` tournament and on
  padelapi-only tournaments without `round_canonical` data
- Confirm tab is hidden when `round_canonical` populated on <80% of
  main-draw matches
- Verify all 5 locales' new keys render correctly

## Open questions for the plan

These don't block the spec but are worth pinning down during planning:

- Exact `drawSize` source — derive from match count, or read
  `tournaments.draw_size_md` / `draw_size_wd` if populated? (Both exist
  per the schema but may not always be filled.)
- Whether the round chip strip should auto-scroll horizontally to keep
  the active chip visible on small viewports
- Whether the bracket map's animation on path-change should be a
  cross-fade or an instant redraw

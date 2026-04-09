# Entry List Redesign

**Date:** 2026-04-08
**Status:** Approved for implementation
**Scope:** Tournament detail page (`/tournaments/[id]`) → Overview tab → Entry List section

## Problem

The current Entry List on the tournament detail page renders every pair as an identical flat row:

- 3-char position number
- Optional seed badge + optional Q/WC/LL marker
- Two lines with emoji flag + player name
- Team points on the right

Issues:

1. **No visual hierarchy** — the #1 seed looks exactly like #32
2. **No avatars, no rankings** — users can't tell who's who without reading names
3. **Names are not clickable** — can't jump to a player profile
4. **No signal about partnership freshness** — users can't tell which teams are new pairings vs. established duos vs. reunions

Padel fans follow pair dynamics closely. Who's playing with whom is a core part of the sport's narrative. The current list gives zero of that signal.

## Goals

- **Bigger top-8 seed cards** with dual avatars (42px) and country flag overlays in the bottom-right corner of each avatar
- **Ranking badges** shown next to each player name
- **Clickable player rows** that navigate to `/player/[id]` (only when the player ID is resolved)
- **Two debut filter chips** at the top of the entry list:
  - **Fresh partners** — the pair has never played a finished match together in our DB
  - **New this season** — the pair has played together before, but all prior matches are from previous calendar years (reunions + dormant comebacks)
- **Establish partnerships** show no pill (they're the default case)
- **Strictly 2-row hero cards** for seeds 1–8: player 1 name on top, player 2 name on bottom, points + debut pill right-aligned

## Non-Goals

- Redesigning seeds 9–32 layout beyond adding a right-side debut pill when applicable
- Adding per-player stats (head-to-head, last 5, etc.) — that's the player profile's job
- Changing the tournament detail page's other sections (schedule, matches, recap, etc.)
- Redesigning the tournament header, tabs, or filters
- Moving debut-status computation to the backend — pure client-side calc is fine for now
- Reorganizing `tournament_draws` or `players` tables
- Handling the case where player IDs are unresolved — those rows simply get no avatar, no ranking, no clickability (fall back to flag emoji + name like today)

## Design

### Layout

The Entry List section on the Overview tab becomes:

```
┌─────────────────────────────────────────┐
│ ENTRY LIST (32 pairs)                   │
│                                         │
│ [All 32] [Fresh 3] [New this season 5]  │ ← filter chips
│                                         │
│ ─── TOP SEEDS ───                       │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ 1  [◎◎]  #1 A. Tapia    20,910 PTS │ │
│ │          #2 A. Coello              │ │  ← hero row (~56px tall)
│ └─────────────────────────────────────┘ │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ 2  [◎◎]  #3 A. Galan    17,340 PTS │ │
│ │          #4 F. Chingotto ● NEW SEASON│ │  ← with debut pill
│ └─────────────────────────────────────┘ │
│                                         │
│ (seeds 3-8)                             │
│                                         │
│ ─── DRAW (9-32) ───                     │
│                                         │
│ 9  [9] #15 F. Belasteguin               │
│        #18 A. Sanchez                   │  ← compact row
│                                         │
│ 10 [10] #22 J. Lima           ● FRESH   │  ← compact w/ pill
│         #27 P. Campagnolo               │
│ ...                                     │
└─────────────────────────────────────────┘
```

### Hero row (seeds 1–8)

**Layout** (left → right):
1. **Seed number** — big monospace (22px, weight 900, orange `#F5A623`), width 24px
2. **Dual avatars** — two overlapping 42×42 circles with 2px border matching the background, negative `-8px` margin between them for slight overlap. Each avatar has a 16×11 country flag rectangle overlaid at bottom-right with a 1.5px dark border.
3. **Body** — 2-column CSS grid (`1fr auto`) with:
   - **Left column**: names stacked vertically
     - Player 1 line: small green ranking badge (`#15`-style, 8px uppercase, chunky clip-path) + player name (12px, weight 700, white)
     - Player 2 line: same format, slightly muted (`rgba(255,255,255,0.75)`)
   - **Right column**: meta stacked
     - Top: `20,910 PTS` — 13px monospace bold white with "PTS" unit in 8px gray
     - Bottom: debut pill, or empty 14px gutter when no pill (keeps rhythm consistent across cards)

**Debut pill** (right column, bottom row, only when applicable):
- Fresh: `● Fresh partners` — 8px uppercase bold, green text on `rgba(126,211,33,0.15)` background, 5px leading dot
- New this season: `● New this season` — same format, yellow (`#FFD166`)
- Both use the existing `CHUNKY.badge` clip-path

**Card background**: `rgba(255,255,255,0.03)` with `CHUNKY.card` clip-path, 10×12 padding, 6px margin-bottom between cards.

**Clickability**: the whole card is a `<Link>` to… hmm, this is tricky because there are TWO players per card. **Decision**: the card is NOT a single link. Instead, each player name row is independently clickable as a `<Link href="/player/{id}">` when `player_id` is resolved. The card itself has no link. Falls back to a `<span>` (non-clickable) when the player ID is null.

### Compact row (seeds 9+)

Same layout as today's entry list row BUT with:
1. Stacked 2-line name format (same as today)
2. Add a small right-aligned debut pill when applicable (`Fresh` or `New`, abbreviated, same chunky clip-path)
3. Player names become `<Link>` when `player_id` is resolved (same rule as hero rows)
4. Remove the current team-points `pts` text — not shown in compact rows (keeps density)

### Filter chips

A row of 3 chips at the top of the entry list section:

- **All** — default, shows all entries (count = total pairs)
- **Fresh partners** — filters to entries where at least one pair is in "fresh" state (count = number of fresh pairs)
- **New this season** — filters to entries where at least one pair is in "new-this-season" state

Chips use the existing chunky pill style. Active chip background matches the category color: orange for All, green for Fresh, yellow for New.

Filters are **mutually exclusive** — clicking one chip clears the others. Clicking an already-active chip returns to "All".

Inactive chips show a count in smaller muted text next to the label. Example: `Fresh partners 3`.

### Data flow

**New fetch logic** extends `fetchDrawEntries`:

1. Fetch `tournament_draws` as today (existing query)
2. Collect all unique player IDs from the result: `playerIds = Set<string>` where both `player1_id` and `player2_id` are non-null
3. Fetch player details: `supabase.from('players').select('id, avatar_url, ranking').in('id', Array.from(playerIds))`
4. Build a map `playerMap: Record<string, { avatar_url, ranking }>`
5. For debut detection — fetch historical matches involving any of these players:
   ```ts
   supabase.from('matches')
     .select('pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, finished_at, tournament_id')
     .in('status', ['finished', 'retired', 'walkover'])
     .neq('tournament_id', tournamentId)  // exclude the current tournament
     .or(`pair1_player1_id.in.(${ids}),pair1_player2_id.in.(${ids}),pair2_player1_id.in.(${ids}),pair2_player2_id.in.(${ids})`)
   ```
6. Client-side compute per-entry debut status:
   - For each entry with both `player1_id` and `player2_id` resolved, find historical matches where both IDs appear in the same pair (either as pair1_player1+pair1_player2 or pair2_player1+pair2_player2)
   - If zero matches → `fresh`
   - If all matches are from previous calendar years → `newThisSeason`
   - Else → null (established)
   - If either player ID is null → null (can't determine)

7. Store the enriched list in a new state variable (or extend `drawEntries` shape): `{ ...entry, player1, player2, debutStatus }`

### Component extraction

Extract the Entry List section into `src/components/EntryList.tsx`:

```ts
export function EntryList({
  entries,
  playerMap,
  debutStatusMap,
  genderFilter,
}: {
  entries: DrawEntry[]
  playerMap: Record<string, { avatar_url: string | null; ranking: number | null }>
  debutStatusMap: Record<string, 'fresh' | 'newThisSeason' | null>  // keyed by `${player1_id}|${player2_id}` (sorted)
  genderFilter: 'men' | 'women'
}) { ... }
```

The component owns:
- The filter chip state (useState)
- The hero vs compact row split (seeds 1–8 vs 9+)
- The debut status lookup + filtering logic
- Rendering

The page-level `V3Overview` just passes already-fetched data.

### State & data keying

The `debutStatusMap` is keyed by a stable pair key: `` `${Math.min(id1, id2)}|${Math.max(id1, id2)}` `` (sorted IDs as a string). Works because historical matches don't care which slot each player was in.

## Non-goals revisited (edge cases)

- **Entries missing player IDs**: fall back to current display (emoji flag + name, non-clickable, no avatar, no ranking, no debut status). Don't crash, don't hide them.
- **Entries missing seeds**: if any top-8 seed is an unseeded row (marker = Q/WC/LL), keep it in the hero section if `draw_position` ≤ 8. The hero section is "seeds 1–8 or draw_position ≤ 8, whichever comes first."
  - **Clarification**: hero section uses `seed <= 8 || (!seed && draw_position <= 8)` — covers seeded top-8 and also honor early draw positions when seeds are missing.
- **Tournament with fewer than 8 entries**: render all entries as hero rows, no compact section.
- **Player with no avatar_url**: render an empty circle placeholder (same color as current inline fallbacks).
- **Player with no ranking**: skip the ranking badge entirely (no `#` placeholder).

## Implementation Notes

- All new code is client-side in existing React hooks + one new component file
- No DB migrations, no API routes, no backend changes
- The debut-detection query is bounded: for a ~32-pair tournament with ~64 unique player IDs, the `.or(...)` query typically returns a few hundred rows. Acceptable for the Overview tab, which already loads ~3–5 heavy queries.
- The `V3Overview` component in `tournaments/[id]/page.tsx` currently holds `drawEntries`. It will gain two new state pieces: `playerMap` and `debutStatusMap`, OR (cleaner) a single derived `enrichedEntries` state. **Decision**: keep `drawEntries` raw + add `playerMap` + `debutStatusMap` as separate state pieces. The new `EntryList` component does the combining at render time.

## Testing

Manual verification:

1. Open a tournament detail page that has an entry list (e.g. Miami P1 2026, FIP Gold Almaty) — verify the hero cards render for seeds 1–8 with avatars and flag overlays
2. Verify at least one card has a ranking badge next to each player name
3. Click a player row → navigates to `/player/[id]`
4. Click a row where the player ID is null → nothing happens (no broken link)
5. Verify the filter chips count is correct: `All`, `Fresh partners`, `New this season`
6. Click "Fresh partners" → only pairs with truly new partnerships are shown
7. Click "New this season" → only pairs with past meetings in prior years are shown
8. Click "All" or the active chip again → returns to full list
9. Scroll down to seeds 9+ → verify compact rows render with optional right-side "Fresh" / "New" pill
10. Switch gender toggle → entry list updates correctly (existing `genderFilter` behavior unchanged)
11. Tournaments with no `tournament_draws` data (older seasons, non-FIP) → EntryList section doesn't render at all (current behavior preserved)

## Rollout

Single PR. No feature flag. No DB changes.

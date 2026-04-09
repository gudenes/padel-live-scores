# H2H Row Redesign — Design Spec

**Date:** 2026-04-08
**Status:** Approved for implementation
**Scope:** Match detail page → H2H tab → per-match rows only

## Problem

On the match detail page's H2H tab, each past meeting currently renders as a single line:

```
Dubai P1                        6–3  6–4   [W]
Finals · Nov 2025
```

Two ambiguities make this confusing:

1. **Whose perspective is the W/L badge?** The badge is subtly tinted with `PAIR1_COLOR` to indicate it's from current team 1's perspective, but the color cue is easy to miss.
2. **Which team does each side of the score belong to?** The row displays `6–3 6–4` without any label, so the reader has to guess whether the first number is team 1 or team 2 — and the answer changes depending on how each historical match happens to store pair1 vs pair2.

Users asked to redesign the row so they can tell at a glance who won each past meeting and what the score was for each team.

## Goals

- Eliminate ambiguity about who won each H2H match
- Eliminate ambiguity about which set scores belong to which team
- Keep the existing "5 vs 3" H2H summary header (already clear)
- Keep the "Last 5 Matches per pair" bottom section unchanged
- Match the visual language of the home page's `ResultCard` (Latest Results), which already solves this problem for the main match feed
- Use the same team identity colors (`PAIR1_COLOR` = `#FF6B2B`, `PAIR2_COLOR` = `#FFD166`) now applied across the match page

## Non-Goals

- Redesigning the sticky H2H summary header
- Redesigning the "Last 5 Matches" per-pair columns
- Changing any H2H data fetching or state management
- Changing the `H2HTab` component signature or props
- Any changes outside the `H2HTab` function

## Design

### Layout overview

The H2H tab becomes a stack of three sections (two unchanged, one redesigned):

1. **Sticky summary header** (unchanged) — `5 | H2H 8 matches | 3` with team names
2. **Match list** (**redesigned**) — each past meeting as a two-row scoresheet card
3. **"Last 5 Matches" columns** (unchanged) — per-pair recent record

The `Tournament·Round | Score | W/L` column header strip that sits between the sticky header and the match list today is removed, because the new row layout no longer needs it.

### New match row

Each past meeting renders as a self-contained card. Anatomy from outside in:

```
┌─┬──────────────────────────────────────────────────┐
│█│ [DUBAI P1] [F] [NOV 2025]                        │
│█│ 🇦🇷🇪🇸  Tapia / Coello        [W]    6   6       │
│█│ 🇪🇸🇦🇷  Galan / Chingotto            3   4       │
└─┴──────────────────────────────────────────────────┘
 ↑
 3px accent bar (winner color)
```

**Card container:**
- Background: `rgba(255,255,255,0.03)` (same as home `ResultCard`)
- Shape: `clipPath: CHUNKY.card`
- Padding: `6px 10px 6px 14px` (extra left padding accommodates the 3px accent bar)
- Separation: small vertical gap between cards — no border lines between rows
- Target height: ~52px total

**Accent bar** (positioned absolutely, left edge, full height, 3px wide):
- `PAIR1_COLOR` (`#FF6B2B`) when current team 1 won this historical match
- `PAIR2_COLOR` (`#FFD166`) when current team 2 won this historical match
- `MUTED` as a fallback if `winner_pair` is null (shouldn't happen for finished matches)

**Pills row** (top of card, horizontal, `gap: 4px`, `marginBottom: 4px`):
- Tournament name pill: `fontSize: 9px`, bold, white text, `rgba(255,255,255,0.08)` background, chunky clip-path, truncates with ellipsis at `maxWidth: 150px`
- Round pill: `fontSize: 9px`, bold, muted text, `rgba(255,255,255,0.06)` background, chunky clip-path — uses abbreviation from existing `round` field (`F`, `SF`, `QF`, `R16`, etc.)
- Date pill: `fontSize: 9px`, bold, muted text, same style — formatted as `Mon YYYY` via existing `formatDate` helper

**Team rows** (one per team, always current-match team 1 on top, team 2 on bottom):

Each team row is a flex container with:
- **Flag stack** (22×16px wrapper, two overlapping 14×14 flags, same pattern as home `ResultCard` but slightly smaller)
- **Team name** (flex: 1, ellipsis) — bold white if winner, muted + 42% opacity if loser
- **W badge** — shown only on the winner's row, `14×14px`, chunky clip-path, colored with the team's own color (`PAIR1_COLOR` or `PAIR2_COLOR`), black "W" text inside
- **Set scores** — one `<span>` per set, each showing that team's games for that set, `fontSize: 14px`, monospace, bold — bright white if winner, muted if loser

**Loser dimming:** The loser row's team name, flags, and set scores all get `opacity: 0.42` applied to the row wrapper. The winner row stays at full opacity.

### Team-perspective mapping

Historical matches in the DB store teams as `pair1_*` and `pair2_*`, but those assignments don't necessarily align with how the *current* match stores its teams. For example, in a current match where Tapia/Coello is `pair1` and Galan/Chingotto is `pair2`, a historical match might have Galan/Chingotto as its `pair1`.

For each H2H match, we must:

1. Use the existing `pairMatchesIds(historicalPair1Player1Id, historicalPair1Player2Id, currentTeam1Ids)` helper to decide whether the historical `pair1` corresponds to the current team 1.
2. If yes (`ourPairIsMatch1 === true`): render historical `pair1_player*` + `pair1_games` on the top row, historical `pair2_*` on the bottom row.
3. If no (`ourPairIsMatch1 === false`): swap — render historical `pair2_*` on the top row, historical `pair1_*` on the bottom row.
4. Compute `team1Won` the same way as today: `(ourPairIsMatch1 && winner_pair === 1) || (!ourPairIsMatch1 && winner_pair === 2)`.

This ensures team 1 (`PAIR1_COLOR` orange) is always on top and team 2 (`PAIR2_COLOR` yellow) is always on bottom, matching the rest of the match page and avoiding any perspective confusion.

### Set score mapping

For each set in the historical match, we extract both teams' games using the existing `parseSetScore` helper (or fall back to `pair1_games` / `pair2_games` columns). Then, based on the `ourPairIsMatch1` flag, we map:

- If `ourPairIsMatch1`: top row gets `parsed.p1` / `pair1_games`, bottom row gets `parsed.p2` / `pair2_games`
- Else: top row gets `parsed.p2` / `pair2_games`, bottom row gets `parsed.p1` / `pair1_games`

Each set becomes a fixed-width monospace span so scores align vertically across the two team rows.

### Reused primitives

- `FlagImg` — flag rendering (imported from existing location)
- `PAIR1_COLOR`, `PAIR2_COLOR`, `PAIR1_BG`, `PAIR2_BG`, `PAIR1_BORDER`, `PAIR2_BORDER`, `MUTED`, `BORDER`, `BG_CARD` — page-level constants
- `CHUNKY.card`, `CHUNKY.badge` — clip-path presets
- `pairMatchesIds` — perspective matcher
- `parseSetScore` — extracts `{ p1, p2 }` from a set score string
- `pairName` — formats a pair label
- `formatSetScores`, `formatDate` — existing local helpers inside `H2HTab`

No new props, no new hooks, no new utilities needed.

## Implementation Notes

- The redesigned row is a pure JSX change inside `H2HTab` — no new files, no new imports beyond `FlagImg` if not already imported at the top of the file.
- The `FlagImg` component is already used elsewhere on this page (see `PlayerSquare` and the main scoreline), so import should be trivial.
- Use existing `PAIR1_BG` / `PAIR1_BORDER` constants where appropriate (e.g. the W badge could use `PAIR1_BG` + `PAIR1_BORDER` instead of solid PAIR1_COLOR fill if we want it less punchy — but the design above specifies solid fill with black text for max legibility).
- The whole card remains a `<Link>` to the historical match, same as today.
- No changes to `fetchH2H`, match data selection, or the H2H state variables.

## Visual Fidelity vs Mockup

The approved mockup (`.superpowers/brainstorm/2748-1775657090/content/h2h-compact-scoresheet.html`, Variant 1) uses fake gradient flags. The real implementation uses `FlagImg` with actual country flag images, which will look richer than the mockup. All other measurements, colors, spacing, and structure match the mockup exactly.

## Accessibility

- Card remains a `<Link>` — fully keyboard accessible as today
- Winner vs loser is communicated by THREE redundant signals: color, opacity, font weight — not color alone
- The W badge is decorative reinforcement, not the only winner cue
- Set scores are monospace, large enough to read at mobile sizes

## Testing

- No new logic beyond existing helpers — no unit tests required
- Manual verification via dev server:
  1. Open an H2H tab with at least 3 past meetings
  2. Verify team 1 is always on top and team 2 always on bottom across all rows
  3. Verify the accent bar color matches the winner
  4. Verify the W badge only appears on the winner row and is the winner's team color
  5. Verify set scores align column-wise between the two team rows
  6. Verify clicking the card navigates to the historical match detail
  7. Verify the sticky summary header and "Last 5 Matches" section are unchanged
  8. Verify behavior with 2-set and 3-set matches
  9. Verify behavior when a historical match has pair1/pair2 swapped relative to the current match

## Rollout

Single PR, no feature flag, no migration. Pure client-side rendering change.

# Draw bracket — auto-height focus+context pyramid

**Date:** 2026-06-10
**Status:** Implemented (see "Update — final shipped design" below)
**Area:** Tournament detail → Draw tab (`CHAVE`)

## Update — final shipped design (2026-06-10, post-test)

After live testing, the design was simplified from the full "focus + context"
pyramid (which kept compressed *previous*-round columns on the left) to:

- **One round at a time**: only the **selected round** renders full-width. The
  compressed previous-round columns were dropped per UX feedback.
- **Next-round peek**: a thin sliver of the **next** round stays on the right edge
  as the swipe affordance (tap it to advance). Gone on the Final.
- **Auto-height** (unchanged): the panel height is anchored to the selected round
  (`Hraw = ROUND_SLOTS[selected] * SLOT_PX`, `SLOT_PX` raised 58 → 84 for more
  vertical space), eased with a `height` transition.
- **Carousel slide between rounds**: switching rounds mounts both the outgoing and
  incoming round and slides a horizontal track — forward (deeper) enters from the
  right, back from the left. The next-round peek + connectors render on the
  **destination** round through the whole slide (focus column reserves the peek's
  width structurally) so nothing pops in at the end and the outgoing round never
  duplicates the round being slid toward. Honors `prefers-reduced-motion`.

Everything below this section is the original focus+context design; the shared
mechanic (selected-anchored height + the `cellCenterY` pyramid formula + the chunky
cell visuals + tap-to-focus + reduced motion) carried through. The fisheye
column-geometry helpers (`computeColumns`/`panOffset`/`trackWidth`/`tierForDistance`)
were removed since previous rounds are no longer shown.

## Problem

The draw renders as a horizontal-scroll, single-column-per-viewport bracket. Every
round column is locked to the **first round's** height
(`bracketHeight = ROUND_SLOTS[firstRound] * CELL_SLOT_PX`) and cells are spread with
`justify-content: space-around`. For an R64 draw that's ~2,300px tall in **every**
round — so the Final (one match) sits centered ~1,150px down an otherwise empty
column. Later rounds never get shorter, and the user navigates on two axes
(vertical scroll through whitespace + horizontal swipe). It feels clunky.

Reference: Sofascore's mobile bracket keeps the full pyramid on screen but the
**selected round drives the layout** — earlier rounds compress into thin columns
while staying in their pyramid slots, and the panel height tracks the selected
round so later rounds genuinely tighten.

## Goal

Make the draw **tighten as rounds advance** while **preserving the existing bracket-tree
look** (cells, chips, flags, seed/marker badges, W badges, set scores, connector
lines, the right-edge peek). The selected round is shown full-size; earlier rounds
compress (focus + context); the container height eases down to fit the selected
round; everything transitions smoothly.

Non-goals: redesigning the cell visuals, changing the draw data model, adding a
zoom/minimap mode, or touching Premier/FIP live behavior.

## Core mechanic

**Height is anchored to the selected round, not the first round.**

```
Hraw = matchCount(selectedRound) * SLOT      // SLOT ≈ 58px comfortable card pitch
centerY(i, n) = LABEL + (2i + 1) / (2n) * Hraw
```

`centerY` uses the **same formula for every column** regardless of its match count,
so the pyramid alignment is exact (the midpoint of feeder cells `2j` and `2j+1`
equals the center of destination cell `j`), and columns with **more** matches than
the selected round automatically pack tighter (compress vertically) while columns
with **fewer** spread out. This is what lets the height shrink toward the Final
without breaking the tree.

- **R16 selected** → 8 cards tall (fills viewport, scrolls).
- **QF** → 4 tall. **SF** → 2. **Final** → collapses to one card.
- Viewport height = `min(Hraw, MAX_VH) + LABEL` with a CSS `transition: height` so the
  panel eases down each round. Early rounds exceeding `MAX_VH` scroll vertically
  (as today).

## Visual style — unchanged (chunky cells stay)

**This is an animation/UX change only — the cell visuals are NOT redesigned.** Keep
today's chunky `BracketCell` look exactly: `#141414` background, the skewed
`clip-path` corners (`polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)`), stacked
country flags, the grey seed slab + orange Q/WC/LL marker, the green clipped **W**
badge, the 3-column tabular set scores, the muted italic scheduled time, and the
green tracked-pair spotlight. The Sofascore reference mockups used a rounded/blue
style only to demonstrate the *mechanic* — we do not adopt that styling. The
compressed tiers (`mini`/`sliver`) are **reduced-content versions of the same chunky
cell** (same clip-path, same `#141414`), just hiding sub-elements — not a different
visual language.

## Focus + context tiers

Each column's **width** and **content density** is a function of its distance `d`
from the selected round (`d = roundIndex - selectedIndex`):

| Tier | `d` | Width | Content shown |
|---|---|---|---|
| **full** | `0` | ~200px | avatars/flags, pair names, seed + Q/WC/LL marker, W badge, set scores, scheduled time — i.e. today's full `BracketCell` |
| **peek** | `+1` | ~98px | short pair name only (next round, partially visible on the right edge — preserves the existing "swipe sideways" affordance) |
| **mini** | `-1` | ~52px | set scores only (winner bold), no names — the immediately-previous round |
| **sliver** | `≤ -2` or `≥ +2` | ~30px | a dot / empty slab — distant context, keeps the pyramid shape readable |

Cell **height** per tier is clamped to its column's vertical pitch
(`spacing = Hraw / n`) so compressed columns never overlap.

**Horizontal pan:** `translateX` positions the focused column left-of-center with one
compressed (mini) column peeking before it and the peek round after it — matching
the Sofascore screenshots and today's peek behavior.

## Smooth transition requirement

Build the columns/cells **once** and change only their styles (`width`, `height`,
`top`, tier class) on round change, so CSS transitions animate width/height/position
together. Content for all tiers stays in the DOM; tier classes toggle visibility of
sub-elements (avatar/name/seed/scores). Honor `prefers-reduced-motion` by disabling
the transitions (consistent with `useInViewOnce`).

## Connectors

Recompute the SVG connector paths from `centerY` directly. Because cells are now
absolutely positioned at exact `centerY` coordinates, the current
measure-after-layout approach (the `cellCenters` `useLayoutEffect` that exists today
because cells overflowed their `space-around` slots) is **no longer needed** — the
formula is exact. Keep the green tracked-path highlight (glow on the segments the
tracked pair walked) and the bye-feeds logic.

## Interaction

- **Round chips** (existing skewed `clip-path` strip) select the focused round.
  Keep the active (white) / passed (green) / last-tracked (green outline) styling.
- **Tapping a non-focused column** (mini/peek/sliver) promotes it to the focus.
- Replace the current `IntersectionObserver`-drives-`activeRound` logic: with fisheye
  widths the "most visible column" heuristic no longer makes sense — selection is now
  explicit (chip tap or column tap).
- Tracked-pair auto-centering (scroll the tracked cell into view when switching
  rounds) is **retained** for the focused round's vertical scroll.

## Components affected

- **`BracketRoundList.tsx`** — the main rewrite: per-column width/height tiers keyed to
  the selected round, `centerY`-based absolute cell positioning, viewport height
  animation, horizontal pan, formula-based connectors, build-once-restyle structure.
  Drops `bracketHeight` (first-round) + `space-around` + the `cellCenters` measurement
  effect + the `IntersectionObserver` active-round detection.
- **`BracketCell.tsx`** — add a `tier: 'full' | 'peek' | 'mini' | 'sliver'` prop. `full`
  is today's render **unchanged**. `peek`/`mini`/`sliver` keep the same chunky cell
  shell (clip-path, `#141414`) and only hide sub-elements to show reduced content — no
  restyle. Preserve bye, TBD-placeholder, scheduled-time, and tracked-row spotlight
  handling in `full`.
- **`bracket-builder.ts`** — unchanged (positions, byes, path tracing are independent
  of layout).
- **`DrawTab.tsx`** — unchanged (data fetch + bracket build).

## Edge cases

- **Draw sizes** (R64/R32/R16 first round): model is size-agnostic — `Hraw` follows
  whatever round is selected. R64 first round is still tall (scrolls), but later
  rounds now collapse — a strict improvement over today.
- **Byes:** render normally in `full`; collapse like any cell in compressed tiers.
- **TBD / not-yet-played round** (e.g. Final before semis finish): `matchCount` still
  drives height; show the scheduled/placeholder cell.
- **Single round present** (qualifying drawn, main not): degrade to a single full
  column, no peek.
- **Very small viewport / desktop bezel mode** (`.app-screen` internal scroll): keep
  the existing `findScrollAncestor` logic for the focused round's vertical centering.

## Testing & verification

- Unit: a small pure-function test asserting the `centerY` pyramid property — the
  midpoint of `centerY(2j, n)` and `centerY(2j+1, n)` equals `centerY(j, n/2)` — so
  connectors always align.
- Manual (local dev, per project convention — verify previewable changes in the
  running app): cycle R64→Final on a real tournament; confirm height eases down,
  pyramid stays aligned, earlier rounds compress, peek persists, connectors track the
  green path, vertical scroll works on tall early rounds, reduced-motion disables
  transitions, tracked-pair centering still works.

## Resolved decisions

1. **Mini column content** — **set scores only** (winner bold), no names/initials.
2. **Tap-to-focus on compressed columns** — **included**: tapping a mini/peek/sliver
   column promotes it to the focused round.
3. **Early-round overflow** — **cap at `MAX_VH` with internal vertical scroll** (exact
   value tuned during implementation), not full-page scroll.

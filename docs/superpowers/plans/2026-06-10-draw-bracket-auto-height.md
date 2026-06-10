# Draw Bracket Auto-Height Pyramid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the tournament Draw tab "tighten" as rounds advance — the panel height tracks the *selected* round, earlier rounds compress into thin columns while keeping their pyramid slots + connectors, and everything transitions smoothly — without changing the chunky cell visuals.

**Architecture:** Extract the bracket layout math into a new pure module (`bracket-layout.ts`, unit-tested). Rewrite `BracketRoundList.tsx` to render columns at absolute pyramid positions whose height is anchored to the selected round (`Hraw = ROUND_SLOTS[selected] * SLOT`), apply focus+context width/content tiers keyed to distance from the selected round, pan horizontally to the focused column, and draw connectors from the formula (dropping the old measure-after-layout effect and `IntersectionObserver`). Add a `tier` prop to `BracketCell` so compressed columns render reduced content in the same cell shell. React reconciliation keeps element identity stable across round changes, so CSS transitions animate width/height/position for free.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Vitest, inline-style components (existing pattern).

---

## Background for the implementer

- The Draw tab lives at `src/app/[locale]/(app)/tournaments/[id]/`. Three files matter:
  - `DrawTab.tsx` — fetches markers, builds the bracket, owns `activeRound` + tracked-pair state, renders `<BracketRoundList>`. **We do NOT change its public behavior** — it already owns `activeRound`/`setActiveRound`.
  - `BracketRoundList.tsx` — the layout component we rewrite.
  - `BracketCell.tsx` — the cell renderer we extend with a `tier` prop.
  - `bracket-builder.ts` — pure bracket tree logic. **Unchanged.** It exports `ROUND_SLOTS` (`{R64:32,R32:16,R16:8,QF:4,SF:2,F:1}`), `ROUND_ORDER`, types `RoundCode`, `BracketNode`, `PairPath`, and `pairKeyFor`.
- **Today's problem:** every column is forced to the first round's height with `justify-content: space-around`, so later rounds never shrink and the user scrolls through whitespace.
- **The fix mechanic:** height is anchored to the selected round. `cellCenterY(i, n, H)` uses the same formula for every column, so the pyramid stays aligned and columns with more matches than the selected round pack tighter.
- **Visual constraint:** the `full`-tier cell is today's `BracketCell` render, byte-for-byte. Compressed tiers keep the same `#141414` + clip-path shell and only hide sub-elements.
- Spec: `docs/superpowers/specs/2026-06-10-draw-bracket-auto-height-design.md`.

> **Worktree note:** the shared working directory's branch is switched by other live sessions, and this repo is currently on an unrelated branch (`feat/survey-campaign-email`). Before implementing, create a dedicated worktree/branch (e.g. `feat/draw-auto-height`) per the project's worktree convention so this work is isolated.

---

## File Structure

- **Create:** `src/app/[locale]/(app)/tournaments/[id]/bracket-layout.ts` — pure layout math (tiers, height, cell centers, column geometry, pan). No React.
- **Create:** `src/app/[locale]/(app)/tournaments/[id]/__tests__/bracket-layout.test.ts` — unit tests for the pure module.
- **Modify:** `src/app/[locale]/(app)/tournaments/[id]/BracketCell.tsx` — add `tier` prop + compressed renderers.
- **Modify:** `src/app/[locale]/(app)/tournaments/[id]/BracketRoundList.tsx` — full layout rewrite.

---

## Task 1: Pure layout module + tests

**Files:**
- Create: `src/app/[locale]/(app)/tournaments/[id]/bracket-layout.ts`
- Test: `src/app/[locale]/(app)/tournaments/[id]/__tests__/bracket-layout.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/[locale]/(app)/tournaments/[id]/__tests__/bracket-layout.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  SLOT_PX, LABEL_PX, GAP_PX, TIER_WIDTH,
  tierForDistance, roundHeight, cellCenterY,
  computeColumns, trackWidth, panOffset, cellHeight,
} from '../bracket-layout'

describe('tierForDistance', () => {
  it('maps distance to tier', () => {
    expect(tierForDistance(0)).toBe('full')
    expect(tierForDistance(1)).toBe('peek')
    expect(tierForDistance(-1)).toBe('mini')
    expect(tierForDistance(2)).toBe('sliver')
    expect(tierForDistance(-3)).toBe('sliver')
  })
})

describe('roundHeight', () => {
  it('scales with selected match count', () => {
    expect(roundHeight(8)).toBe(8 * SLOT_PX)
    expect(roundHeight(1)).toBe(SLOT_PX)
  })
})

describe('cellCenterY pyramid alignment', () => {
  it('the midpoint of two feeder cells equals the destination center', () => {
    const H = roundHeight(4)            // selected = QF (4), feeders = R16 (8)
    for (let j = 0; j < 4; j++) {
      const top = cellCenterY(2 * j, 8, H)
      const bot = cellCenterY(2 * j + 1, 8, H)
      const dst = cellCenterY(j, 4, H)
      expect((top + bot) / 2).toBeCloseTo(dst, 6)
    }
  })

  it('offsets every center by the label band', () => {
    expect(cellCenterY(0, 1, roundHeight(1))).toBeCloseTo(LABEL_PX + SLOT_PX / 2, 6)
  })
})

describe('computeColumns', () => {
  it('assigns tiers and cumulative left offsets around the selected index', () => {
    const cols = computeColumns(4, 1)   // rounds R16,QF,SF,F ; QF selected
    expect(cols.map(c => c.tier)).toEqual(['mini', 'full', 'peek', 'sliver'])
    expect(cols[0].left).toBe(0)
    expect(cols[1].left).toBe(TIER_WIDTH.mini + GAP_PX)
    expect(cols[2].left).toBe(TIER_WIDTH.mini + GAP_PX + TIER_WIDTH.full + GAP_PX)
  })
})

describe('trackWidth', () => {
  it('is the right edge of the last column', () => {
    const cols = computeColumns(4, 0)
    const last = cols[cols.length - 1]
    expect(trackWidth(cols)).toBe(last.left + last.width)
  })
})

describe('panOffset', () => {
  it('is 0 when the first round is selected', () => {
    const cols = computeColumns(4, 0)
    expect(panOffset(cols, 0)).toBe(0)
  })
  it('keeps one mini column peeking before the focused column', () => {
    const cols = computeColumns(4, 2)   // SF selected
    expect(panOffset(cols, 2)).toBe(Math.max(0, cols[2].left - TIER_WIDTH.mini - GAP_PX))
  })
})

describe('cellHeight', () => {
  it('never returns less than 12 and fits the spacing for compressed tiers', () => {
    expect(cellHeight('full', 58)).toBe(46)
    expect(cellHeight('mini', 20)).toBe(Math.max(12, Math.min(40, 20 - 3)))
    expect(cellHeight('sliver', 8)).toBe(12)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "src/app/[locale]/(app)/tournaments/[id]/__tests__/bracket-layout.test.ts"`
Expected: FAIL — cannot resolve `../bracket-layout`.

- [ ] **Step 3: Write the module**

Create `src/app/[locale]/(app)/tournaments/[id]/bracket-layout.ts`:

```ts
// Pure layout math for the auto-height focus+context draw bracket.
// No React, no DOM — unit-testable.

export type Tier = 'full' | 'peek' | 'mini' | 'sliver'

/** Comfortable vertical pitch for one match in the SELECTED round. */
export const SLOT_PX = 58
/** Height of the per-column round label band above the first cell. */
export const LABEL_PX = 22
/** Gap between columns. */
export const GAP_PX = 6
/** Cap the rendered viewport height; taller (early) rounds scroll internally. */
export const MAX_VIEWPORT_PX = 430

/** Column width per tier. */
export const TIER_WIDTH: Record<Tier, number> = {
  full: 200,
  peek: 98,
  mini: 52,
  sliver: 30,
}

/** Distance from the selected round → tier.
 *  0 = focused round (full), +1 = next round (peek, right-edge),
 *  -1 = immediately-previous round (mini, scores only), else sliver. */
export function tierForDistance(d: number): Tier {
  if (d === 0) return 'full'
  if (d === 1) return 'peek'
  if (d === -1) return 'mini'
  return 'sliver'
}

/** Pyramid height, anchored to the selected round's match count. */
export function roundHeight(selectedMatchCount: number, slot: number = SLOT_PX): number {
  return selectedMatchCount * slot
}

/** Vertical center (px) of cell `i` (0-based, top→bottom) in a column of `n`
 *  cells drawn within a pyramid of height `height`. Same formula for every
 *  column, so the midpoint of feeders 2j/2j+1 equals destination center j. */
export function cellCenterY(i: number, n: number, height: number, label: number = LABEL_PX): number {
  return label + ((2 * i + 1) / (2 * n)) * height
}

export type ColumnGeom = { tier: Tier; width: number; left: number }

/** Width + cumulative left offset + tier for every column, given which
 *  round index is selected. */
export function computeColumns(roundCount: number, selectedIndex: number, gap: number = GAP_PX): ColumnGeom[] {
  const cols: ColumnGeom[] = []
  let x = 0
  for (let i = 0; i < roundCount; i++) {
    const tier = tierForDistance(i - selectedIndex)
    const width = TIER_WIDTH[tier]
    cols.push({ tier, width, left: x })
    x += width + gap
  }
  return cols
}

/** Total track width = right edge of the last column. */
export function trackWidth(cols: ColumnGeom[]): number {
  if (cols.length === 0) return 0
  const last = cols[cols.length - 1]
  return last.left + last.width
}

/** Horizontal pan so the focused column sits left-of-center with one
 *  compressed (mini-width) column peeking before it. Clamped to >= 0. */
export function panOffset(cols: ColumnGeom[], selectedIndex: number, gap: number = GAP_PX): number {
  const sel = cols[selectedIndex]
  if (!sel) return 0
  return Math.max(0, sel.left - TIER_WIDTH.mini - gap)
}

/** Cell box height per tier, clamped so compressed columns never overlap
 *  their vertical pitch (`spacing = height / n`). */
export function cellHeight(tier: Tier, spacing: number): number {
  const base =
    tier === 'full' ? 46
    : tier === 'peek' ? 46
    : tier === 'mini' ? Math.min(40, spacing - 3)
    : Math.min(14, spacing - 2)
  return Math.max(12, base)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run "src/app/[locale]/(app)/tournaments/[id]/__tests__/bracket-layout.test.ts"`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/(app)/tournaments/[id]/bracket-layout.ts" "src/app/[locale]/(app)/tournaments/[id]/__tests__/bracket-layout.test.ts"
git commit -m "feat(draw): pure layout module for auto-height pyramid"
```

---

## Task 2: Add `tier` prop + compressed renderers to BracketCell

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/BracketCell.tsx`

The `full` tier renders exactly as today. Compressed tiers render reduced content in the same `#141414` + clip-path shell, non-interactive (the column handles tap-to-focus).

- [ ] **Step 1: Import the Tier type**

In `BracketCell.tsx`, find the existing import of bracket-builder types:

```ts
import type { BracketNode } from './bracket-builder'
```

Add a sibling import of the layout type:

```ts
import type { Tier } from './bracket-layout'
```

- [ ] **Step 2: Add `tier` to Props**

In the `type Props = { ... }` block, add this field (after `isFirstRound: boolean`):

```ts
  /** Render density. 'full' = today's complete cell (default). Compressed
   *  tiers keep the same cell shell but show reduced content and are
   *  non-interactive (the column handles tap-to-focus). */
  tier?: Tier
```

- [ ] **Step 3: Destructure `tier` and short-circuit compressed tiers**

Change the component signature line:

```ts
export default function BracketCell({ node, highlight, onTrackPair, pairKey, markersByPair, trackedPairKey, isFirstRound }: Props) {
```

to add `tier = 'full'`:

```ts
export default function BracketCell({ node, highlight, onTrackPair, pairKey, markersByPair, trackedPairKey, isFirstRound, tier = 'full' }: Props) {
```

Then, immediately after the `const m = node.match` line near the top of the component body, insert:

```ts
  // Compressed tiers (focus+context): same chunky shell, reduced content,
  // non-interactive. The enclosing column captures clicks to focus the round.
  if (tier !== 'full') {
    return <CompressedCell node={node} tier={tier} />
  }
```

- [ ] **Step 4: Add the CompressedCell component + helper**

At the bottom of `BracketCell.tsx` (after the `pairLabel` function), append:

```tsx
// ── compressed tiers (peek / mini / sliver) ──

/** Per-side set games as display strings, e.g. ['6','4',''] . */
function sideSetGames(match: Match, side: 1 | 2): string[] {
  const sets = match.sets ?? []
  return [1, 2, 3].map(sn => {
    const s = sets.find(x => x.set_number === sn)
    if (!s) return ''
    const g = side === 1 ? (s as any).pair1_games : (s as any).pair2_games
    return g == null ? '' : String(g)
  })
}

function CompressedCell({ node, tier }: { node: BracketNode; tier: Tier }) {
  const m = node.match
  const shell: React.CSSProperties = {
    width: '100%', height: '100%', background: '#141414', clipPath: CELL_CLIP,
    color: '#fff', overflow: 'hidden', display: 'flex', flexDirection: 'column',
    justifyContent: 'center', boxSizing: 'border-box',
  }

  if (tier === 'sliver') {
    return (
      <div style={{ ...shell, alignItems: 'center', background: '#161618' }}>
        <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#3a3a3f' }} />
      </div>
    )
  }

  if (tier === 'mini') {
    // Set scores only, winner bold. (Spec: previous round shows scores, no names.)
    if (!m) return <div style={shell} />
    const win = m.winner_pair
    const scoreRow = (side: 1 | 2) => (
      <div style={{
        display: 'flex', gap: 3, justifyContent: 'center', padding: '2px 0',
        fontVariantNumeric: 'tabular-nums', fontSize: 11,
        fontWeight: win === side ? 700 : 400, color: win === side ? '#fff' : MUTED,
      }}>
        {sideSetGames(m, side).map((g, i) => (
          <span key={i} style={{ minWidth: 10, textAlign: 'center' }}>{g}</span>
        ))}
      </div>
    )
    return (
      <div style={{ ...shell, padding: '4px 5px' }}>
        {scoreRow(1)}
        <div style={{ height: 1, background: 'rgba(255,255,255,0.04)', margin: '1px 0' }} />
        {scoreRow(2)}
      </div>
    )
  }

  // peek (next round): short pair name only, no scores/seeds.
  if (!m) return <div style={shell} />
  const nameRow = (side: 1 | 2) => (
    <div style={{
      padding: '3px 8px', fontSize: 11, color: m.winner_pair === side ? '#fff' : '#cfcfcf',
      fontWeight: m.winner_pair === side ? 700 : 400,
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>
      {pairLabel(m, side)}
    </div>
  )
  return (
    <div style={{ ...shell, padding: '2px 0' }}>
      {nameRow(1)}
      <div style={{ height: 1, background: 'rgba(255,255,255,0.04)', margin: '1px 8px' }} />
      {nameRow(2)}
    </div>
  )
}
```

> Note: `CELL_CLIP`, `MUTED`, `pairLabel`, and the `Match` type are all already defined/imported at the top of this file — reuse them.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors in `BracketCell.tsx`. (Pre-existing unrelated errors elsewhere, if any, are out of scope — confirm none are in this file.)

- [ ] **Step 6: Commit**

```bash
git add "src/app/[locale]/(app)/tournaments/[id]/BracketCell.tsx"
git commit -m "feat(draw): tier prop + compressed cell renderers"
```

---

## Task 3: Rewrite BracketRoundList for auto-height focus+context layout

**Files:**
- Modify (full replace): `src/app/[locale]/(app)/tournaments/[id]/BracketRoundList.tsx`

This replaces the fixed-height + `space-around` + measured-connectors + `IntersectionObserver` approach with: selected-anchored height, fisheye columns at absolute pyramid positions, horizontal pan, formula connectors, tap-to-focus, reduced-motion support, and tracked-pair vertical centering scoped to the internal viewport.

- [ ] **Step 1: Replace the entire file contents**

Replace `src/app/[locale]/(app)/tournaments/[id]/BracketRoundList.tsx` with:

```tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import BracketCell from './BracketCell'
import type { BracketNode, RoundCode, PairPath } from './bracket-builder'
import { ROUND_ORDER, ROUND_SLOTS, pairKeyFor } from './bracket-builder'
import {
  SLOT_PX, LABEL_PX, MAX_VIEWPORT_PX,
  cellCenterY, computeColumns, trackWidth, panOffset, cellHeight,
} from './bracket-layout'

const GREEN = '#7ED321'
const MUTED = '#6B7280'
const CONNECTOR_PX = 14

type Props = {
  bracket: BracketNode[]
  rounds: RoundCode[]
  activeRound: RoundCode
  setActiveRound: (r: RoundCode) => void
  trackedPairKey: string | null
  trackedPath: PairPath
  trackingVariant: 'tracking' | 'defendingChamp' | null
  onTrackPair: (pairKey: string) => void
  markersByPair: Map<string, 'Q' | 'WC' | 'LL'>
  stickyHeader?: React.ReactNode
}

export default function BracketRoundList({
  bracket, rounds, activeRound, setActiveRound,
  trackedPairKey, trackedPath, trackingVariant, onTrackPair, markersByPair,
  stickyHeader,
}: Props) {
  const viewportRef = useRef<HTMLDivElement | null>(null)

  // Respect reduced-motion: disable the width/height/transform transitions.
  const [reduce, setReduce] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduce(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const ease = reduce ? 'none' : '0.55s cubic-bezier(0.4,0,0.2,1)'

  // Chip styling helpers (unchanged behavior).
  const trackedRoundSet = new Set(trackedPath.nodes.map(n => n.round))
  const lastTrackedIdx =
    trackedPath.nodes.length > 0
      ? ROUND_ORDER.indexOf(trackedPath.nodes[trackedPath.nodes.length - 1].round)
      : -1

  // Nodes per round, sorted by position.
  const nodesByRound = useMemo(() => {
    const m = new Map<RoundCode, BracketNode[]>()
    for (const r of rounds) {
      m.set(r, bracket.filter(n => n.round === r).sort((a, b) => a.positionInRound - b.positionInRound))
    }
    return m
  }, [bracket, rounds])

  const selectedIndex = Math.max(0, rounds.indexOf(activeRound))
  const cols = useMemo(() => computeColumns(rounds.length, selectedIndex), [rounds.length, selectedIndex])
  const Hraw = (ROUND_SLOTS[activeRound] ?? 1) * SLOT_PX
  const tw = trackWidth(cols)
  const pan = panOffset(cols, selectedIndex)
  const viewportHeight = Math.min(Hraw, MAX_VIEWPORT_PX) + LABEL_PX
  const centerY = (i: number, n: number) => cellCenterY(i, n, Hraw)

  // When the focused round changes (or the tracked pair changes), center the
  // tracked cell vertically inside the internal viewport.
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const node = trackedPath.nodes.find(n => n.round === activeRound)
    if (!node) return
    const n = ROUND_SLOTS[activeRound] ?? 1
    const c = cellCenterY(node.positionInRound, n, Hraw)
    const target = Math.max(0, c - vp.clientHeight / 2)
    vp.scrollTo({ top: target, behavior: reduce ? 'auto' : 'smooth' })
  }, [activeRound, trackedPairKey, Hraw, reduce, trackedPath])

  return (
    <>
      <style>{`@keyframes drawConnFade{from{opacity:0}to{opacity:1}}`}</style>

      {/* Header: tracked-pair pill (when present) + round chip strip. */}
      <div style={{ background: '#1A1A1A', paddingTop: 4 }}>
        {stickyHeader}
        <div style={{
          display: 'flex', gap: 6, padding: '6px 0 10px',
          overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none',
        }}>
          {rounds.map(r => {
            const isActive = r === activeRound
            const isPassed = trackedRoundSet.has(r) && r !== activeRound
            const isLast = ROUND_ORDER.indexOf(r) === lastTrackedIdx && !trackedPath.eliminatedAt && trackedPath.nodes.length > 0
            const bg = isActive ? '#fff' : isPassed ? 'rgba(126,211,33,0.18)' : 'rgba(255,255,255,0.05)'
            const color = isActive ? '#000' : isPassed ? GREEN : MUTED
            return (
              <button
                key={r}
                onClick={() => setActiveRound(r)}
                style={{
                  flexShrink: 0, padding: '6px 14px',
                  clipPath: 'polygon(3% 5%,97% 0%,100% 95%,0% 100%)',
                  background: bg, color, fontSize: 11, fontWeight: 700,
                  letterSpacing: '0.06em', border: 'none', cursor: 'pointer',
                  outline: isLast ? `1.5px solid ${GREEN}` : 'none',
                }}
              >
                {r}
              </button>
            )
          })}
        </div>
      </div>

      {/* Internal scroll viewport — height eases to the selected round. */}
      <div
        ref={viewportRef}
        style={{
          position: 'relative', overflowX: 'hidden', overflowY: 'auto',
          height: viewportHeight, transition: reduce ? 'none' : `height ${ease}`,
          scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch',
        }}
      >
        <div style={{
          position: 'relative', width: tw, height: Hraw + LABEL_PX,
          transform: `translateX(${-pan}px)`, transition: reduce ? 'none' : `transform ${ease}`,
        }}>
          {/* Columns */}
          {rounds.map((r, ci) => {
            const col = cols[ci]
            const n = ROUND_SLOTS[r]
            const spacing = Hraw / n
            const ch = cellHeight(col.tier, spacing)
            const cells = nodesByRound.get(r) ?? []
            const isFocus = col.tier === 'full'
            return (
              <div
                key={r}
                onClick={isFocus ? undefined : () => setActiveRound(r)}
                style={{
                  position: 'absolute', top: 0, left: col.left,
                  width: col.width, height: Hraw + LABEL_PX,
                  cursor: isFocus ? 'default' : 'pointer',
                  transition: reduce ? 'none' : `left ${ease}, width ${ease}`,
                }}
              >
                <div style={{
                  position: 'absolute', top: 4, left: 2,
                  fontSize: 10, fontWeight: 800, letterSpacing: '0.08em',
                  color: MUTED, textTransform: 'uppercase',
                }}>
                  {r}
                </div>
                {cells.map(node => {
                  const isTrackedHere = trackedPairKey != null && trackedPath.nodes.includes(node)
                  const isTracking = trackedPairKey != null
                  const dim = isTracking && !isTrackedHere
                  const highlight = isTrackedHere
                    ? trackingVariant === 'defendingChamp' ? 'defendingChamp' : 'tracking'
                    : dim ? 'dim' : 'none'
                  return (
                    <div
                      key={node.positionInRound}
                      data-pos={node.positionInRound}
                      style={{
                        position: 'absolute', left: 0, width: col.width,
                        top: centerY(node.positionInRound, n), height: ch,
                        transform: 'translateY(-50%)',
                        transition: reduce ? 'none' : `top ${ease}, width ${ease}, height ${ease}`,
                      }}
                    >
                      <BracketCell
                        node={node}
                        tier={col.tier}
                        highlight={highlight}
                        onTrackPair={onTrackPair}
                        pairKey={pairKeyFor}
                        markersByPair={markersByPair}
                        trackedPairKey={trackedPairKey}
                        isFirstRound={r === rounds[0]}
                      />
                    </div>
                  )
                })}
              </div>
            )
          })}

          {/* Connectors — keyed on activeRound so they fade in after the
              column/cell transitions settle. */}
          <svg
            key={activeRound}
            width={tw} height={Hraw + LABEL_PX}
            viewBox={`0 0 ${tw} ${Hraw + LABEL_PX}`}
            preserveAspectRatio="none"
            style={{
              position: 'absolute', top: 0, left: 0, overflow: 'visible',
              pointerEvents: 'none',
              animation: reduce ? undefined : 'drawConnFade 0.25s ease 0.35s both',
            }}
          >
            {rounds.map((r, ci) => {
              if (ci === rounds.length - 1) return null
              const nr = rounds[ci + 1]
              const n = ROUND_SLOTS[r]
              const nn = ROUND_SLOTS[nr]
              const x1 = cols[ci].left + cols[ci].width
              const x2 = cols[ci + 1].left
              const xm = (x1 + x2) / 2
              const curNodes = nodesByRound.get(r) ?? []
              const nextNodes = nodesByRound.get(nr) ?? []
              const onPath = (node: BracketNode | undefined) => node != null && trackedPath.nodes.includes(node)
              return Array.from({ length: nn }).map((_, j) => {
                const yTop = centerY(2 * j, n)
                const yBot = centerY(2 * j + 1, n)
                const yMid = centerY(j, nn)
                const topNode = curNodes[2 * j]
                const botNode = curNodes[2 * j + 1]
                const dstNode = nextNodes[j]
                const topFeeds = topNode != null && (topNode.match != null || topNode.isBye)
                const botFeeds = botNode != null && (botNode.match != null || botNode.isBye)
                const topGlow = topFeeds && dstNode != null && onPath(topNode) && onPath(dstNode)
                const botGlow = botFeeds && dstNode != null && onPath(botNode) && onPath(dstNode)
                const dstGlow = topGlow || botGlow
                const lineProps = (glow: boolean) => ({
                  stroke: glow ? GREEN : 'rgba(255,255,255,0.16)',
                  strokeWidth: glow ? 2 : 1,
                  fill: 'none',
                })
                let vY1: number | null = null
                let vY2: number | null = null
                if (topFeeds && botFeeds) { vY1 = yTop; vY2 = yBot }
                else if (topFeeds) { vY1 = yTop; vY2 = yMid }
                else if (botFeeds) { vY1 = yMid; vY2 = yBot }
                return (
                  <g key={j}>
                    {topFeeds && <line x1={x1} y1={yTop} x2={xm} y2={yTop} {...lineProps(topGlow)} />}
                    {botFeeds && <line x1={x1} y1={yBot} x2={xm} y2={yBot} {...lineProps(botGlow)} />}
                    {vY1 != null && vY2 != null && (
                      <line x1={xm} y1={vY1} x2={xm} y2={vY2} {...lineProps(topGlow || botGlow)} />
                    )}
                    {(topFeeds || botFeeds) && (
                      <line x1={xm} y1={yMid} x2={x2} y2={yMid} {...lineProps(dstGlow)} />
                    )}
                  </g>
                )
              })
            })}
          </svg>
        </div>
      </div>
    </>
  )
}
```

> `CONNECTOR_PX` is no longer referenced — remove the unused constant if lint flags it.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors in `BracketRoundList.tsx`.

- [ ] **Step 3: Lint the touched files**

Run: `npm run lint`
Expected: no new errors/warnings for `BracketRoundList.tsx`, `BracketCell.tsx`, `bracket-layout.ts`. Remove any unused imports/vars it flags (e.g. `CONNECTOR_PX`).

- [ ] **Step 4: Run the layout unit tests again (regression)**

Run: `npx vitest run "src/app/[locale]/(app)/tournaments/[id]/__tests__/bracket-layout.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/(app)/tournaments/[id]/BracketRoundList.tsx"
git commit -m "feat(draw): auto-height focus+context pyramid layout"
```

---

## Task 4: Manual verification in the running app

**Files:** none (verification only).

Per project convention (verify previewable changes in the running app before calling work done). The bracket is visual; unit tests cover only the layout math, so this step is required.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: server on `http://localhost:3002`.

- [ ] **Step 2: Open a Premier tournament with a full draw**

Navigate to a tournament detail page that has an R32 or R64 main draw, and open the **Draw** (CHAVE) tab. A finished/in-progress Premier event is ideal (so cells show W badges + scores).

- [ ] **Step 3: Verify the behavior against the spec**

Confirm each:
- Selecting later rounds (chips R32 → … → F) **eases the panel height down** — the Final collapses to ~one card; no large empty scroll area.
- The **pyramid stays aligned** — connector lines meet feeder cells; earlier rounds compress into thin columns on the left (immediately-previous = score-only mini cells, further back = slivers).
- The **next round peeks** on the right edge.
- Tapping a **compressed/peek column promotes it to focus**.
- The **chunky cell style is unchanged** in the focused column (clip-path cells, flags, seed/Q/WC slabs, green W badge, set scores, scheduled time).
- **Tracked-pair** highlight + the green connector path still work; switching rounds **vertically centers** the tracked cell.
- Early rounds (R32/R64) **scroll internally** within the capped viewport.
- With OS "reduce motion" enabled, round changes **snap without animation**.

- [ ] **Step 4: Verify edge cases**

- A draw with **byes** renders bye cells correctly in the focused round and collapses them in compressed tiers.
- A **pre-main-draw / TBD Final** still shows the scheduled placeholder and height = 1.
- An **R16-only** draw (smallest) renders without a left-compressed column when R16 is selected.

- [ ] **Step 5: Commit any tuning**

If `SLOT_PX` / `MAX_VIEWPORT_PX` / `TIER_WIDTH` need small adjustments for feel, edit `bracket-layout.ts`, re-verify, then:

```bash
git add "src/app/[locale]/(app)/tournaments/[id]/bracket-layout.ts"
git commit -m "chore(draw): tune bracket layout constants"
```

---

## Self-review notes (already reconciled)

- **Spec coverage:** auto-height anchored to selected round (Task 1 `roundHeight` + Task 3 viewport height) ✓; pyramid via shared `cellCenterY` (Task 1 + test) ✓; focus+context width/content tiers (Task 1 `computeColumns`/`tierForDistance` + Task 2 compressed renderers + Task 3) ✓; smooth transitions via stable React keys + CSS (Task 3) ✓; formula connectors replacing measured ones (Task 3) ✓; tap-to-focus (Task 3 column onClick) ✓; chunky cells unchanged (Task 2 keeps `full` path intact) ✓; reduced motion (Task 3) ✓; tracked-pair vertical centering scoped to viewport (Task 3) ✓; mini = scores only / cap-with-scroll (resolved decisions) ✓.
- **Removed from old file:** `bracketHeight` (first-round), `justify-content: space-around`, the `cellCenters` `useLayoutEffect` measurement, the `IntersectionObserver` active-round detection, the `stickyTop`/`ResizeObserver` stack, and `findScrollAncestor` (vertical centering now scopes to the internal viewport). `DrawTab.tsx`'s `activeRound`/`setActiveRound` contract is preserved.
- **Type consistency:** `Tier` is defined once in `bracket-layout.ts` and imported by both `BracketCell.tsx` and `BracketRoundList.tsx`. Helper names (`cellCenterY`, `computeColumns`, `trackWidth`, `panOffset`, `cellHeight`, `roundHeight`, `tierForDistance`) match across the module, tests, and consumer.
```

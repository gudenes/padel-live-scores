# Tournament Draw Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an interactive `Draw` tab on the tournament detail page with a mini-bracket SVG map, paired cells with bracket-stub connectors, and tap-to-track "road to trophy" interaction. Mobile-first. Premier P1/P2/Major/Finals + FIP Bronze/Silver/Gold/Platinum.

**Architecture:** Pure-render UI on top of existing data — no new tables, no new sync workers. Pure-logic helpers in `bracket-builder.ts` (TDD'd) feed React components colocated under `src/app/[locale]/(app)/tournaments/[id]/`. The existing tournament-page match-load query already returns everything we need (`round_canonical`, `pair*_seed`, `category`, `draw_position`).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Tailwind CSS 4, vitest 4, next-intl, SVG inline.

**Spec:** [docs/superpowers/specs/2026-05-09-tournament-draw-design.md](../specs/2026-05-09-tournament-draw-design.md)

---

## Phase 1 — Pure logic foundation

Build the bracket-tree logic in isolation, fully unit-tested. No React, no Supabase. All four helpers live in one file.

### Task 1: Scaffold `bracket-builder.ts` with types and `pairKeyFor`

**Files:**
- Create: `src/app/[locale]/(app)/tournaments/[id]/bracket-builder.ts`
- Create: `src/app/[locale]/(app)/tournaments/[id]/bracket-builder.test.ts`

- [ ] **Step 1: Write the failing test for `pairKeyFor`**

```ts
// src/app/[locale]/(app)/tournaments/[id]/bracket-builder.test.ts
import { describe, it, expect } from 'vitest'
import { pairKeyFor } from './bracket-builder'

describe('pairKeyFor', () => {
  it('produces a stable key regardless of player order', () => {
    expect(pairKeyFor('aaa', 'bbb')).toBe(pairKeyFor('bbb', 'aaa'))
  })

  it('formats as "smaller::larger"', () => {
    expect(pairKeyFor('zzz', 'aaa')).toBe('aaa::zzz')
  })

  it('handles equal IDs deterministically', () => {
    expect(pairKeyFor('xxx', 'xxx')).toBe('xxx::xxx')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/\[locale\]/\(app\)/tournaments/\[id\]/bracket-builder.test.ts`
Expected: FAIL with "Cannot find module './bracket-builder'"

- [ ] **Step 3: Write the type definitions and `pairKeyFor`**

```ts
// src/app/[locale]/(app)/tournaments/[id]/bracket-builder.ts
import type { Match } from '@/types/match'

export type RoundCode = 'R64' | 'R32' | 'R16' | 'QF' | 'SF' | 'F'

export const ROUND_ORDER: RoundCode[] = ['R64', 'R32', 'R16', 'QF', 'SF', 'F']

/** Number of cells in each round, indexed by round code. */
export const ROUND_SLOTS: Record<RoundCode, number> = {
  R64: 32, R32: 16, R16: 8, QF: 4, SF: 2, F: 1,
}

export type BracketNode = {
  round: RoundCode
  positionInRound: number             // 0-based, top to bottom
  match: Match | null                 // null = upcoming/TBD slot or bye
  feedFromTop: BracketNode | null     // previous-round cell feeding top pair
  feedFromBottom: BracketNode | null  // previous-round cell feeding bottom pair
  isBye: boolean                      // true when this slot is a bye (one pair advances unopposed)
}

export type PairPath = {
  nodes: BracketNode[]            // every node where the pair appears, in round order
  eliminatedAt: RoundCode | null  // null if still active or won the tournament
}

export type DefendingChampPair = {
  player1Id: string
  player2Id: string
}

/** Stable pair identifier — order-independent, "smallerId::largerId". */
export function pairKeyFor(player1Id: string, player2Id: string): string {
  return player1Id < player2Id
    ? `${player1Id}::${player2Id}`
    : `${player2Id}::${player1Id}`
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/\[locale\]/\(app\)/tournaments/\[id\]/bracket-builder.test.ts`
Expected: PASS — 3 tests green

- [ ] **Step 5: Commit**

```bash
git add 'src/app/[locale]/(app)/tournaments/[id]/bracket-builder.ts' 'src/app/[locale]/(app)/tournaments/[id]/bracket-builder.test.ts'
git commit -m "feat(draw): scaffold bracket-builder with types and pairKeyFor"
```

---

### Task 2: Implement `buildBracket`

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/bracket-builder.ts`
- Modify: `src/app/[locale]/(app)/tournaments/[id]/bracket-builder.test.ts`

- [ ] **Step 1: Write the failing tests for `buildBracket`**

Append to `bracket-builder.test.ts`:

```ts
import { buildBracket } from './bracket-builder'
import type { Match } from '@/types/match'

// Helper: minimal fake match with the fields buildBracket reads
function fakeMatch(overrides: Partial<any> = {}): Match {
  return {
    id: overrides.id ?? `m-${Math.random()}`,
    external_id: '',
    status: 'scheduled',
    coverage: null,
    pusher_channel: null,
    round: overrides.round ?? null,
    court: null,
    scheduled_at: null,
    started_at: null,
    finished_at: null,
    winner_pair: null,
    pair1_player1: null,
    pair1_player2: null,
    pair2_player1: null,
    pair2_player2: null,
    ...overrides,
  } as unknown as Match
}

describe('buildBracket', () => {
  it('returns 15 nodes for a 16-pair (R16) bracket', () => {
    const matches: Match[] = [
      ...Array.from({ length: 8 }, (_, i) =>
        fakeMatch({ id: `r16-${i}`, round: 'R16', draw_position: i }),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        fakeMatch({ id: `qf-${i}`, round: 'QF', draw_position: i }),
      ),
      ...Array.from({ length: 2 }, (_, i) =>
        fakeMatch({ id: `sf-${i}`, round: 'SF', draw_position: i }),
      ),
      fakeMatch({ id: 'f-0', round: 'F', draw_position: 0 }),
    ]
    const bracket = buildBracket(matches, 16)
    expect(bracket).toHaveLength(8 + 4 + 2 + 1)
  })

  it('returns 31 nodes for a 32-pair (R32) bracket', () => {
    const matches: Match[] = [
      ...Array.from({ length: 16 }, (_, i) =>
        fakeMatch({ id: `r32-${i}`, round: 'R32', draw_position: i }),
      ),
      ...Array.from({ length: 8 }, (_, i) =>
        fakeMatch({ id: `r16-${i}`, round: 'R16', draw_position: i }),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        fakeMatch({ id: `qf-${i}`, round: 'QF', draw_position: i }),
      ),
      ...Array.from({ length: 2 }, (_, i) =>
        fakeMatch({ id: `sf-${i}`, round: 'SF', draw_position: i }),
      ),
      fakeMatch({ id: 'f-0', round: 'F', draw_position: 0 }),
    ]
    const bracket = buildBracket(matches, 32)
    expect(bracket).toHaveLength(16 + 8 + 4 + 2 + 1)
  })

  it('links feedFromTop and feedFromBottom for adjacent R32 → R16 cells', () => {
    const matches: Match[] = [
      fakeMatch({ id: 'r32-0', round: 'R32', draw_position: 0 }),
      fakeMatch({ id: 'r32-1', round: 'R32', draw_position: 1 }),
      fakeMatch({ id: 'r16-0', round: 'R16', draw_position: 0 }),
    ]
    const bracket = buildBracket(matches, 32)
    const r16cell = bracket.find(n => n.round === 'R16' && n.positionInRound === 0)!
    expect(r16cell.feedFromTop?.match?.id).toBe('r32-0')
    expect(r16cell.feedFromBottom?.match?.id).toBe('r32-1')
  })

  it('returns structural placeholder slots when matches are missing', () => {
    const matches: Match[] = [fakeMatch({ id: 'f-0', round: 'F', draw_position: 0 })]
    const bracket = buildBracket(matches, 16)
    expect(bracket).toHaveLength(15)
    const finalCell = bracket.find(n => n.round === 'F')!
    expect(finalCell.match?.id).toBe('f-0')
    const r16cells = bracket.filter(n => n.round === 'R16')
    expect(r16cells.every(n => n.match === null)).toBe(true)
  })

  it('marks a bye when an R16 pair has no feeding R32 match', () => {
    // Top seed (pair1) appears directly in the R16 with no R32 match feeding them
    const matches: Match[] = [
      fakeMatch({
        id: 'r16-0', round: 'R16', draw_position: 0,
        pair1_player1: { id: 'top-seed' } as any,
        pair1_player2: { id: 'top-seed-2' } as any,
      }),
    ]
    const bracket = buildBracket(matches, 32)
    const r32top = bracket.find(n => n.round === 'R32' && n.positionInRound === 0)!
    expect(r32top.isBye).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/\[locale\]/\(app\)/tournaments/\[id\]/bracket-builder.test.ts`
Expected: FAIL — "buildBracket is not a function"

- [ ] **Step 3: Implement `buildBracket`**

Append to `bracket-builder.ts`:

```ts
import { roundCanonical } from '@/lib/round-canonical'

/**
 * Build a structured bracket tree from a flat list of matches.
 *
 * - `drawSize` is the number of pairs in the first round (16, 32, 64).
 * - Sorts matches by canonical round + draw_position.
 * - Returns one BracketNode per slot in the bracket. Missing matches
 *   produce placeholder nodes with `match: null`.
 * - A slot in round N+1 is a bye when neither of its two feeding round-N
 *   slots has a match — the seed advances unopposed.
 */
export function buildBracket(matches: Match[], drawSize: number): BracketNode[] {
  // Determine which rounds belong to this bracket size.
  // 16 → R16/QF/SF/F, 32 → R32/R16/QF/SF/F, 64 → R64/R32/R16/QF/SF/F.
  const startIdx = drawSize === 64 ? 0 : drawSize === 32 ? 1 : 2
  const rounds = ROUND_ORDER.slice(startIdx)

  // Index matches by (round, position) for O(1) lookup.
  type Key = string
  const matchByKey = new Map<Key, Match>()
  for (const m of matches) {
    const r = roundCanonical(m.round) as RoundCode | null
    if (!r || !rounds.includes(r)) continue
    const pos = (m as any).draw_position
    if (typeof pos !== 'number') continue
    matchByKey.set(`${r}::${pos}`, m)
  }

  // Build nodes round by round so we can wire feedFromTop/Bottom on the fly.
  const nodesByRound = new Map<RoundCode, BracketNode[]>()
  for (const round of rounds) {
    const slotCount = ROUND_SLOTS[round]
    const nodes: BracketNode[] = []
    const prevRound = ROUND_ORDER[ROUND_ORDER.indexOf(round) - 1]
    const prevNodes = prevRound ? nodesByRound.get(prevRound) ?? [] : []

    for (let pos = 0; pos < slotCount; pos++) {
      const match = matchByKey.get(`${round}::${pos}`) ?? null
      const feedFromTop = prevNodes[pos * 2] ?? null
      const feedFromBottom = prevNodes[pos * 2 + 1] ?? null
      nodes.push({
        round, positionInRound: pos, match,
        feedFromTop, feedFromBottom,
        isBye: false,
      })
    }
    nodesByRound.set(round, nodes)
  }

  // Mark byes: a slot in the FIRST round of this bracket is a bye when
  // its corresponding next-round cell has a real pair on its side but
  // no match here. We detect this by checking whether the next-round
  // cell's match has player IDs assigned to the side this cell feeds.
  const firstRound = rounds[0]
  const nextRound = rounds[1]
  if (nextRound) {
    const firstNodes = nodesByRound.get(firstRound)!
    const nextNodes = nodesByRound.get(nextRound)!
    for (let pos = 0; pos < firstNodes.length; pos++) {
      const node = firstNodes[pos]
      if (node.match) continue
      const nextCell = nextNodes[Math.floor(pos / 2)]
      if (!nextCell?.match) continue
      const isTopFeed = pos % 2 === 0
      const sideHasPair = isTopFeed
        ? nextCell.match.pair1_player1 != null
        : nextCell.match.pair2_player1 != null
      if (sideHasPair) node.isBye = true
    }
  }

  return rounds.flatMap(r => nodesByRound.get(r)!)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/\[locale\]/\(app\)/tournaments/\[id\]/bracket-builder.test.ts`
Expected: PASS — all `buildBracket` tests green plus the existing 3

- [ ] **Step 5: Commit**

```bash
git add 'src/app/[locale]/(app)/tournaments/[id]/bracket-builder.ts' 'src/app/[locale]/(app)/tournaments/[id]/bracket-builder.test.ts'
git commit -m "feat(draw): implement buildBracket with bye detection"
```

---

### Task 3: Implement `tracePairPath`

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/bracket-builder.ts`
- Modify: `src/app/[locale]/(app)/tournaments/[id]/bracket-builder.test.ts`

- [ ] **Step 1: Write the failing tests for `tracePairPath`**

Append to `bracket-builder.test.ts`:

```ts
import { tracePairPath } from './bracket-builder'

describe('tracePairPath', () => {
  // Helper: build a 16-pair bracket where pair "winner" wins every match,
  // and pair "loser-qf" loses in QF.
  function build16WithWinnerAndLoserAtQF() {
    const winnerPair = { p1: 'w1', p2: 'w2' }
    const loserPair = { p1: 'l1', p2: 'l2' }
    const matches: Match[] = [
      // R16: winner beats opponent-1 (positions 0..7 = 8 cells)
      fakeMatch({
        id: 'r16-0', round: 'R16', draw_position: 0, winner_pair: 1,
        pair1_player1: { id: winnerPair.p1 } as any,
        pair1_player2: { id: winnerPair.p2 } as any,
        pair2_player1: { id: 'opp-r16' } as any,
        pair2_player2: { id: 'opp-r16-2' } as any,
      }),
      fakeMatch({
        id: 'r16-1', round: 'R16', draw_position: 1, winner_pair: 1,
        pair1_player1: { id: loserPair.p1 } as any,
        pair1_player2: { id: loserPair.p2 } as any,
        pair2_player1: { id: 'opp-r16-3' } as any,
        pair2_player2: { id: 'opp-r16-4' } as any,
      }),
      // QF: winner beats loser-qf
      fakeMatch({
        id: 'qf-0', round: 'QF', draw_position: 0, winner_pair: 1,
        pair1_player1: { id: winnerPair.p1 } as any,
        pair1_player2: { id: winnerPair.p2 } as any,
        pair2_player1: { id: loserPair.p1 } as any,
        pair2_player2: { id: loserPair.p2 } as any,
      }),
      // SF: winner beats opponent-sf
      fakeMatch({
        id: 'sf-0', round: 'SF', draw_position: 0, winner_pair: 1,
        pair1_player1: { id: winnerPair.p1 } as any,
        pair1_player2: { id: winnerPair.p2 } as any,
        pair2_player1: { id: 'opp-sf' } as any,
        pair2_player2: { id: 'opp-sf-2' } as any,
      }),
      // F: winner wins the tournament
      fakeMatch({
        id: 'f-0', round: 'F', draw_position: 0, winner_pair: 1,
        pair1_player1: { id: winnerPair.p1 } as any,
        pair1_player2: { id: winnerPair.p2 } as any,
        pair2_player1: { id: 'opp-f' } as any,
        pair2_player2: { id: 'opp-f-2' } as any,
      }),
    ]
    return { matches, winnerPair, loserPair }
  }

  it('returns 4 nodes with eliminatedAt=null for the champion', () => {
    const { matches, winnerPair } = build16WithWinnerAndLoserAtQF()
    const bracket = buildBracket(matches, 16)
    const key = pairKeyFor(winnerPair.p1, winnerPair.p2)
    const path = tracePairPath(bracket, key)
    expect(path.nodes.map(n => n.round)).toEqual(['R16', 'QF', 'SF', 'F'])
    expect(path.eliminatedAt).toBe(null)
  })

  it('returns 2 nodes with eliminatedAt=QF for the QF loser', () => {
    const { matches, loserPair } = build16WithWinnerAndLoserAtQF()
    const bracket = buildBracket(matches, 16)
    const key = pairKeyFor(loserPair.p1, loserPair.p2)
    const path = tracePairPath(bracket, key)
    expect(path.nodes.map(n => n.round)).toEqual(['R16', 'QF'])
    expect(path.eliminatedAt).toBe('QF')
  })

  it('returns empty array for a pair not in the draw', () => {
    const { matches } = build16WithWinnerAndLoserAtQF()
    const bracket = buildBracket(matches, 16)
    const key = pairKeyFor('ghost-1', 'ghost-2')
    const path = tracePairPath(bracket, key)
    expect(path.nodes).toEqual([])
    expect(path.eliminatedAt).toBe(null)
  })

  it('returns empty path for null pairKey', () => {
    const { matches } = build16WithWinnerAndLoserAtQF()
    const bracket = buildBracket(matches, 16)
    const path = tracePairPath(bracket, null)
    expect(path.nodes).toEqual([])
    expect(path.eliminatedAt).toBe(null)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/\[locale\]/\(app\)/tournaments/\[id\]/bracket-builder.test.ts`
Expected: FAIL — "tracePairPath is not a function"

- [ ] **Step 3: Implement `tracePairPath`**

Append to `bracket-builder.ts`:

```ts
/**
 * Walk the bracket and return every node where the given pair appears,
 * in round order, plus the round where they were eliminated.
 *
 * - A pair is "in" a node when both of its player IDs appear in either
 *   the pair1 or pair2 slot of that node's match.
 * - eliminatedAt is null when the pair won the tournament OR is still active.
 *   To distinguish: if the last node has winner_pair set AND winner_pair's
 *   players match the tracked pair, they're a champion. Otherwise they
 *   were eliminated at the last node's round.
 */
export function tracePairPath(
  bracket: BracketNode[],
  pairKey: string | null,
): PairPath {
  if (!pairKey) return { nodes: [], eliminatedAt: null }

  const nodes: BracketNode[] = []
  for (const node of bracket) {
    const m = node.match
    if (!m) continue
    const p1Key = m.pair1_player1?.id && m.pair1_player2?.id
      ? pairKeyFor(m.pair1_player1.id, m.pair1_player2.id)
      : null
    const p2Key = m.pair2_player1?.id && m.pair2_player2?.id
      ? pairKeyFor(m.pair2_player1.id, m.pair2_player2.id)
      : null
    if (p1Key === pairKey || p2Key === pairKey) {
      nodes.push(node)
    }
  }

  if (nodes.length === 0) return { nodes: [], eliminatedAt: null }

  const last = nodes[nodes.length - 1]
  const m = last.match!
  const wonLast =
    m.winner_pair === 1
      ? m.pair1_player1?.id && m.pair1_player2?.id &&
        pairKeyFor(m.pair1_player1.id, m.pair1_player2.id) === pairKey
      : m.winner_pair === 2
      ? m.pair2_player1?.id && m.pair2_player2?.id &&
        pairKeyFor(m.pair2_player1.id, m.pair2_player2.id) === pairKey
      : null

  // If they won the final, no elimination round.
  if (last.round === 'F' && wonLast) return { nodes, eliminatedAt: null }
  // If they won their last node but it wasn't the final, they're still
  // active (next round hasn't happened yet) — no elimination.
  if (wonLast) return { nodes, eliminatedAt: null }
  // If winner_pair is null (match not finished), they're still active.
  if (m.winner_pair == null) return { nodes, eliminatedAt: null }
  // Otherwise they lost their last match → eliminated at that round.
  return { nodes, eliminatedAt: last.round }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/\[locale\]/\(app\)/tournaments/\[id\]/bracket-builder.test.ts`
Expected: PASS — 4 new `tracePairPath` tests + existing 8

- [ ] **Step 5: Commit**

```bash
git add 'src/app/[locale]/(app)/tournaments/[id]/bracket-builder.ts' 'src/app/[locale]/(app)/tournaments/[id]/bracket-builder.test.ts'
git commit -m "feat(draw): implement tracePairPath with elimination detection"
```

---

### Task 4: Implement `defaultTrackedPair`

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/bracket-builder.ts`
- Modify: `src/app/[locale]/(app)/tournaments/[id]/bracket-builder.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `bracket-builder.test.ts`:

```ts
import { defaultTrackedPair } from './bracket-builder'

describe('defaultTrackedPair', () => {
  function makeBracket() {
    const matches: Match[] = [
      // R16-0: bookmark-player + partner (seed 5)
      fakeMatch({
        id: 'r16-0', round: 'R16', draw_position: 0,
        pair1_player1: { id: 'bookmark-player', name: 'Andy Smith' } as any,
        pair1_player2: { id: 'partner-1', name: 'Bob Jones' } as any,
        pair1_seed: 5,
        pair2_player1: { id: 'opp-1', name: 'Charlie Lee' } as any,
        pair2_player2: { id: 'opp-2', name: 'Dan Park' } as any,
      }) as any,
      // R16-1: champ-1 + champ-2 (defending champs, seed 1)
      fakeMatch({
        id: 'r16-1', round: 'R16', draw_position: 1,
        pair1_player1: { id: 'champ-1', name: 'Eli Wood' } as any,
        pair1_player2: { id: 'champ-2', name: 'Fred Lake' } as any,
        pair1_seed: 1,
      }) as any,
    ]
    return buildBracket(matches, 16)
  }

  it('returns the bookmarked pair when one exists in the draw', () => {
    const bracket = makeBracket()
    const key = defaultTrackedPair(bracket, ['bookmark-player'], null)
    expect(key).toBe(pairKeyFor('bookmark-player', 'partner-1'))
  })

  it('returns the defending champ pair when no bookmark applies', () => {
    const bracket = makeBracket()
    const key = defaultTrackedPair(bracket, [], { player1Id: 'champ-1', player2Id: 'champ-2' })
    expect(key).toBe(pairKeyFor('champ-1', 'champ-2'))
  })

  it('falls through to defending champ when bookmarked player is not in this draw', () => {
    const bracket = makeBracket()
    const key = defaultTrackedPair(bracket, ['ghost-player'], { player1Id: 'champ-1', player2Id: 'champ-2' })
    expect(key).toBe(pairKeyFor('champ-1', 'champ-2'))
  })

  it('returns null when neither bookmark nor defending champ applies', () => {
    const bracket = makeBracket()
    const key = defaultTrackedPair(bracket, ['ghost-player'], null)
    expect(key).toBe(null)
  })

  it('falls through when only one defending champion appears (split partnerships)', () => {
    const bracket = makeBracket()
    // champ-1 is in the draw (with champ-2) but if we ask for a different
    // partner combination that doesn't exist, fall through to null.
    const key = defaultTrackedPair(bracket, [], { player1Id: 'champ-1', player2Id: 'someone-else' })
    expect(key).toBe(null)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/\[locale\]/\(app\)/tournaments/\[id\]/bracket-builder.test.ts`
Expected: FAIL — "defaultTrackedPair is not a function"

- [ ] **Step 3: Implement `defaultTrackedPair`**

Append to `bracket-builder.ts`:

```ts
/**
 * Resolve the default tracked pair for a draw.
 *
 * Priority:
 * 1. A pair containing one of `bookmarkedPlayerIds`. If multiple pairs
 *    qualify, prefer the one with the lowest seed number (most-seeded).
 *    If none of the candidate pairs are seeded, prefer the pair whose
 *    first player has the alphabetically-first surname (deterministic).
 * 2. The pair containing both `defendingChampPair` players (exact match).
 * 3. null.
 */
export function defaultTrackedPair(
  bracket: BracketNode[],
  bookmarkedPlayerIds: string[],
  defendingChampPair: DefendingChampPair | null,
): string | null {
  // Collect every distinct pair that appears in the bracket and what we
  // know about them (seed and lastname).
  type PairInfo = {
    key: string
    playerIds: string[]
    seed: number | null
    sortName: string  // for the deterministic tiebreak
  }
  const seen = new Map<string, PairInfo>()
  for (const node of bracket) {
    const m = node.match
    if (!m) continue
    for (const side of [1, 2] as const) {
      const p1 = side === 1 ? m.pair1_player1 : m.pair2_player1
      const p2 = side === 1 ? m.pair1_player2 : m.pair2_player2
      const seed = side === 1 ? (m as any).pair1_seed : (m as any).pair2_seed
      if (!p1?.id || !p2?.id) continue
      const key = pairKeyFor(p1.id, p2.id)
      if (seen.has(key)) continue
      const sortName = (p1.name ?? '').toLowerCase()
      seen.set(key, { key, playerIds: [p1.id, p2.id], seed: seed ?? null, sortName })
    }
  }

  // 1. Bookmarked-player match
  const bookmarked = new Set(bookmarkedPlayerIds)
  const bookmarkCandidates = [...seen.values()].filter(p =>
    p.playerIds.some(id => bookmarked.has(id)),
  )
  if (bookmarkCandidates.length > 0) {
    bookmarkCandidates.sort((a, b) => {
      const aSeed = a.seed ?? Number.POSITIVE_INFINITY
      const bSeed = b.seed ?? Number.POSITIVE_INFINITY
      if (aSeed !== bSeed) return aSeed - bSeed
      return a.sortName.localeCompare(b.sortName)
    })
    return bookmarkCandidates[0].key
  }

  // 2. Defending champion (exact pair match)
  if (defendingChampPair) {
    const champKey = pairKeyFor(defendingChampPair.player1Id, defendingChampPair.player2Id)
    if (seen.has(champKey)) return champKey
  }

  return null
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/\[locale\]/\(app\)/tournaments/\[id\]/bracket-builder.test.ts`
Expected: PASS — 5 new `defaultTrackedPair` tests + existing 12

- [ ] **Step 5: Commit**

```bash
git add 'src/app/[locale]/(app)/tournaments/[id]/bracket-builder.ts' 'src/app/[locale]/(app)/tournaments/[id]/bracket-builder.test.ts'
git commit -m "feat(draw): implement defaultTrackedPair with bookmark/champ priority"
```

---

## Phase 2 — i18n keys

### Task 5: Add Draw tab translations to all 5 locales

**Files:**
- Modify: `src/messages/en.json`
- Modify: `src/messages/es.json`
- Modify: `src/messages/pt.json`
- Modify: `src/messages/it.json`
- Modify: `src/messages/fr.json`

- [ ] **Step 1: Add the `draw` namespace to `en.json`**

Find the top-level keys in `src/messages/en.json` and add this namespace next to existing ones (alphabetically before `feed` or wherever fits the file's existing ordering):

```json
"draw": {
  "tab": "Draw",
  "following": "Following",
  "defendingChamp": "Defending champ",
  "roadToTrophy": "road to trophy",
  "outInRound": "out in {round}",
  "byeLabel": "BYE",
  "winnerOf": "Winner of {feed}",
  "tbd": "TBD",
  "preMainDrawTitle": "Main draw not yet released",
  "preMainDrawBody": "Main draw starts {date}. See all matches in the Matches tab.",
  "preMainDrawNoDate": "Main draw not yet released. See all matches in the Matches tab.",
  "goToMatches": "See all matches",
  "legendQ": "Qualifier",
  "legendWc": "Wild card",
  "legendLl": "Lucky loser",
  "legendSeed": "Seed"
}
```

Also add `"draw": "Draw"` inside the existing `tournament` namespace (used by the tab strip in `page.tsx` line 760: `{tTournament(tab)}`).

- [ ] **Step 2: Add the same `draw` namespace and `tournament.draw` key to `es.json`**

Spanish translations:

```json
"draw": {
  "tab": "Cuadro",
  "following": "Siguiendo",
  "defendingChamp": "Campeón vigente",
  "roadToTrophy": "camino al título",
  "outInRound": "eliminado en {round}",
  "byeLabel": "BYE",
  "winnerOf": "Ganador de {feed}",
  "tbd": "TBD",
  "preMainDrawTitle": "Cuadro principal aún no publicado",
  "preMainDrawBody": "El cuadro principal empieza el {date}. Consulta los partidos en la pestaña Partidos.",
  "preMainDrawNoDate": "Cuadro principal aún no publicado. Consulta los partidos en la pestaña Partidos.",
  "goToMatches": "Ver todos los partidos",
  "legendQ": "Clasificado",
  "legendWc": "Wild card",
  "legendLl": "Lucky loser",
  "legendSeed": "Cabeza de serie"
}
```

Add `"draw": "Cuadro"` to the `tournament` namespace.

- [ ] **Step 3: Add to `pt.json`**

Portuguese translations:

```json
"draw": {
  "tab": "Chave",
  "following": "Acompanhando",
  "defendingChamp": "Campeão atual",
  "roadToTrophy": "caminho ao título",
  "outInRound": "eliminado nos {round}",
  "byeLabel": "BYE",
  "winnerOf": "Vencedor de {feed}",
  "tbd": "TBD",
  "preMainDrawTitle": "Chave principal ainda não publicada",
  "preMainDrawBody": "A chave principal começa em {date}. Veja os jogos na aba Jogos.",
  "preMainDrawNoDate": "Chave principal ainda não publicada. Veja os jogos na aba Jogos.",
  "goToMatches": "Ver todos os jogos",
  "legendQ": "Qualificado",
  "legendWc": "Wild card",
  "legendLl": "Lucky loser",
  "legendSeed": "Cabeça de chave"
}
```

Add `"draw": "Chave"` to the `tournament` namespace.

- [ ] **Step 4: Add to `it.json`**

Italian translations:

```json
"draw": {
  "tab": "Tabellone",
  "following": "Stai seguendo",
  "defendingChamp": "Campione in carica",
  "roadToTrophy": "strada al titolo",
  "outInRound": "fuori ai {round}",
  "byeLabel": "BYE",
  "winnerOf": "Vincitore di {feed}",
  "tbd": "TBD",
  "preMainDrawTitle": "Tabellone principale non ancora pubblicato",
  "preMainDrawBody": "Il tabellone principale inizia il {date}. Vedi tutte le partite nella scheda Partite.",
  "preMainDrawNoDate": "Tabellone principale non ancora pubblicato. Vedi tutte le partite nella scheda Partite.",
  "goToMatches": "Vedi tutte le partite",
  "legendQ": "Qualificato",
  "legendWc": "Wild card",
  "legendLl": "Lucky loser",
  "legendSeed": "Testa di serie"
}
```

Add `"draw": "Tabellone"` to the `tournament` namespace.

- [ ] **Step 5: Add to `fr.json`**

French translations:

```json
"draw": {
  "tab": "Tableau",
  "following": "Vous suivez",
  "defendingChamp": "Tenant du titre",
  "roadToTrophy": "chemin vers le titre",
  "outInRound": "éliminé en {round}",
  "byeLabel": "BYE",
  "winnerOf": "Vainqueur de {feed}",
  "tbd": "TBD",
  "preMainDrawTitle": "Tableau principal pas encore publié",
  "preMainDrawBody": "Le tableau principal commence le {date}. Voir les matchs dans l'onglet Matchs.",
  "preMainDrawNoDate": "Tableau principal pas encore publié. Voir les matchs dans l'onglet Matchs.",
  "goToMatches": "Voir tous les matchs",
  "legendQ": "Qualifié",
  "legendWc": "Wild card",
  "legendLl": "Lucky loser",
  "legendSeed": "Tête de série"
}
```

Add `"draw": "Tableau"` to the `tournament` namespace.

- [ ] **Step 6: Validate JSON syntax for all 5 files**

Run:
```bash
for f in src/messages/{en,es,pt,it,fr}.json; do echo "=== $f ===" && python3 -m json.tool "$f" > /dev/null && echo OK; done
```
Expected: 5 lines of `OK`.

- [ ] **Step 7: Commit**

```bash
git add src/messages/{en,es,pt,it,fr}.json
git commit -m "feat(draw): add Draw tab translations for all 5 locales"
```

---

## Phase 3 — Components

Each component is rendered visually for verification — no React unit tests, matching the project pattern.

### Task 6: `FollowingPill` component

**Files:**
- Create: `src/app/[locale]/(app)/tournaments/[id]/FollowingPill.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/app/[locale]/(app)/tournaments/[id]/FollowingPill.tsx
'use client'

import { useTranslations } from 'next-intl'
import type { RoundCode } from './bracket-builder'

const GREEN = '#7ED321'
const ORANGE = '#F5A623'
const MUTED = '#6B7280'

const ROUND_TRANSLATION: Record<RoundCode, string> = {
  R64: 'R64', R32: 'R32', R16: 'R16', QF: 'QF', SF: 'SF', F: 'F',
}

type Props = {
  pairLabel: string                          // e.g. "Coello/Tapia"
  variant: 'tracking' | 'defendingChamp'
  eliminatedAt: RoundCode | null             // null = still active or champion
  onDismiss: () => void
}

export default function FollowingPill({ pairLabel, variant, eliminatedAt, onDismiss }: Props) {
  const t = useTranslations('draw')
  const accent = variant === 'defendingChamp' ? ORANGE : GREEN
  const lblText = variant === 'defendingChamp' ? t('defendingChamp') : t('following')
  const bg = variant === 'defendingChamp'
    ? 'rgba(245,166,35,0.08)'
    : 'rgba(126,211,33,0.08)'

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 10px', background: bg,
      borderLeft: `3px solid ${accent}`, marginBottom: 10, fontSize: 11,
    }}>
      <span style={{
        color: variant === 'defendingChamp' ? ORANGE : MUTED,
        fontWeight: 600, letterSpacing: '0.04em',
        textTransform: 'uppercase', fontSize: 9,
      }}>
        {lblText}
      </span>
      <span style={{ color: '#fff', fontWeight: 600, flex: 1 }}>
        {pairLabel}
        {eliminatedAt && (
          <span style={{ color: MUTED, fontWeight: 400, marginLeft: 6 }}>
            · {t('outInRound', { round: ROUND_TRANSLATION[eliminatedAt] })}
          </span>
        )}
      </span>
      <button
        onClick={onDismiss}
        aria-label="Clear"
        style={{
          color: MUTED, fontSize: 14, background: 'none',
          border: 'none', cursor: 'pointer', padding: '0 4px',
        }}
      >
        ×
      </button>
    </div>
  )
}
```

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit -p . 2>&1 | grep "FollowingPill\|bracket-builder" | head -5`
Expected: no errors mentioning these files

- [ ] **Step 3: Commit**

```bash
git add 'src/app/[locale]/(app)/tournaments/[id]/FollowingPill.tsx'
git commit -m "feat(draw): add FollowingPill component"
```

---

### Task 7: `BracketCell` component

**Files:**
- Create: `src/app/[locale]/(app)/tournaments/[id]/BracketCell.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/app/[locale]/(app)/tournaments/[id]/BracketCell.tsx
'use client'

import { useFormatter, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { TIME_24H } from '@/lib/format-patterns'
import { FlagImage } from '@/components/FlagImage'
import { toShortName } from '@/types/match'
import type { Match } from '@/types/match'
import type { BracketNode } from './bracket-builder'

const GREEN = '#7ED321'
const ORANGE = '#F5A623'
const MUTED = '#6B7280'
const LIVE_RED = '#FF4655'

const CELL_CLIP = 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)'

type Props = {
  node: BracketNode
  highlight: 'none' | 'tracking' | 'defendingChamp' | 'dim'
  onTrackPair: (pairKey: string) => void
  pairKey: (a: string, b: string) => string  // pairKeyFor injected for testability
  /** Map from pairKey → 'Q' | 'WC' | 'LL'. Markers persist across rounds because
   *  they describe how a pair entered the draw, not where they currently are. */
  markersByPair: Map<string, 'Q' | 'WC' | 'LL'>
}

export default function BracketCell({ node, highlight, onTrackPair, pairKey, markersByPair }: Props) {
  const t = useTranslations('draw')
  const format = useFormatter()
  const m = node.match

  const bg =
    highlight === 'tracking'
      ? 'linear-gradient(90deg, rgba(126,211,33,0.14), rgba(126,211,33,0.02))'
      : highlight === 'defendingChamp'
      ? 'linear-gradient(90deg, rgba(245,166,35,0.14), rgba(245,166,35,0.02))'
      : '#141414'

  const borderInset =
    highlight === 'tracking'
      ? `inset 3px 0 0 ${GREEN}`
      : highlight === 'defendingChamp'
      ? `inset 3px 0 0 ${ORANGE}`
      : 'none'

  const opacity = highlight === 'dim' ? 0.55 : 1

  // BYE placeholder
  if (node.isBye && !m) {
    return (
      <div style={{
        padding: '10px 12px', marginBottom: 6, background: '#141414',
        clipPath: CELL_CLIP, opacity, color: MUTED, fontSize: 11, fontStyle: 'italic',
      }}>
        — {t('byeLabel')} —
      </div>
    )
  }

  // TBD placeholder (no match yet, no bye)
  if (!m) {
    const topName = node.feedFromTop?.match
      ? `${pairLabel(node.feedFromTop.match, 1)} / ${pairLabel(node.feedFromTop.match, 2)}`
      : t('tbd')
    const botName = node.feedFromBottom?.match
      ? `${pairLabel(node.feedFromBottom.match, 1)} / ${pairLabel(node.feedFromBottom.match, 2)}`
      : t('tbd')
    return (
      <div style={{
        padding: '10px 12px', marginBottom: 6, background: '#141414',
        clipPath: CELL_CLIP, opacity, fontSize: 11, color: MUTED,
      }}>
        <div>{t('winnerOf', { feed: topName })}</div>
        <div style={{ height: 1, background: 'rgba(255,255,255,0.04)', margin: '2px 0' }} />
        <div>{t('winnerOf', { feed: botName })}</div>
      </div>
    )
  }

  return (
    <Link
      href={{ pathname: '/match/[id]', params: { id: m.id } }}
      style={{
        display: 'block', textDecoration: 'none',
        padding: '10px 12px', marginBottom: 6, background: bg,
        clipPath: CELL_CLIP, boxShadow: borderInset,
        opacity, color: '#fff', position: 'relative',
      }}
    >
      <PairRow match={m} side={1} onTrackPair={onTrackPair} pairKey={pairKey} markersByPair={markersByPair} />
      <div style={{ height: 1, background: 'rgba(255,255,255,0.04)', margin: '2px 0' }} />
      <PairRow match={m} side={2} onTrackPair={onTrackPair} pairKey={pairKey} markersByPair={markersByPair} />
      {m.status === 'scheduled' && m.scheduled_at && (
        <div style={{ color: MUTED, fontStyle: 'italic', fontSize: 11, padding: '2px 0 0' }}>
          {format.dateTime(new Date(m.scheduled_at), TIME_24H)}
        </div>
      )}
    </Link>
  )
}

// ── pair row + helpers ──

type PairRowProps = {
  match: Match
  side: 1 | 2
  onTrackPair: (pairKey: string) => void
  pairKey: (a: string, b: string) => string
  markersByPair: Map<string, 'Q' | 'WC' | 'LL'>
}

function PairRow({ match, side, onTrackPair, pairKey, markersByPair }: PairRowProps) {
  const p1 = side === 1 ? match.pair1_player1 : match.pair2_player1
  const p2 = side === 1 ? match.pair1_player2 : match.pair2_player2
  const seed = side === 1 ? (match as any).pair1_seed : (match as any).pair2_seed
  const isWinner = match.winner_pair === side
  const isLoser = match.winner_pair && match.winner_pair !== side
  const isLive = match.status === 'live'
  const sets = match.sets ?? []
  const setScore = (sn: number) => {
    const set = sets.find(s => s.set_number === sn)
    if (!set) return ''
    const games = side === 1 ? (set as any).pair1_games : (set as any).pair2_games
    return games == null ? '' : String(games)
  }

  const marker = p1?.id && p2?.id ? markersByPair.get(pairKey(p1.id, p2.id)) ?? null : null

  const onClick: React.MouseEventHandler = e => {
    e.preventDefault()
    e.stopPropagation()
    if (p1?.id && p2?.id) onTrackPair(pairKey(p1.id, p2.id))
  }

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '3px 0', fontSize: 12,
        fontWeight: isWinner ? 700 : 400,
        color: isLoser ? MUTED : '#fff',
        cursor: 'pointer',
      }}
    >
      {isLive && side === 1 && (
        <span style={{
          display: 'inline-block', width: 6, height: 6, background: LIVE_RED,
          borderRadius: '50%',
        }} />
      )}
      <span style={{
        fontSize: 9, color: '#9CA3AF', minWidth: 22, textAlign: 'center',
        padding: '2px 4px', background: 'rgba(255,255,255,0.04)', fontWeight: 700,
      }}>
        {seed ?? ''}
      </span>
      {marker && (
        <span style={{
          fontSize: 9, color: ORANGE, minWidth: 22, textAlign: 'center',
          padding: '2px 4px', background: 'rgba(245,166,35,0.10)', fontWeight: 700,
        }}>
          {marker}
        </span>
      )}
      <FlagImage country={p1?.country ?? null} size={11} />
      <span style={{ flex: 1 }}>{pairLabel(match, side)}</span>
      <span style={{ display: 'flex', gap: 4, fontVariantNumeric: 'tabular-nums', fontSize: 11 }}>
        {[1, 2, 3].map(sn => (
          <span key={sn} style={{ minWidth: 14, textAlign: 'center', color: isWinner ? '#fff' : MUTED }}>
            {setScore(sn)}
          </span>
        ))}
      </span>
      {isWinner && (
        <span style={{
          width: 14, height: 14, background: GREEN, color: '#000',
          fontSize: 9, fontWeight: 800, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          clipPath: 'polygon(3% 5%,97% 0%,100% 95%,0% 100%)',
        }}>
          W
        </span>
      )}
    </div>
  )
}

function pairLabel(match: Match, side: 1 | 2): string {
  const p1 = side === 1 ? match.pair1_player1 : match.pair2_player1
  const p2 = side === 1 ? match.pair1_player2 : match.pair2_player2
  if (!p1 || !p2) return ''
  return `${toShortName(p1.name ?? '')}/${toShortName(p2.name ?? '')}`
}
```

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit -p . 2>&1 | grep "BracketCell" | head -5`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add 'src/app/[locale]/(app)/tournaments/[id]/BracketCell.tsx'
git commit -m "feat(draw): add BracketCell with tap-to-track and visual states"
```

---

### Task 8: `BracketRoundList` component

**Files:**
- Create: `src/app/[locale]/(app)/tournaments/[id]/BracketRoundList.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/app/[locale]/(app)/tournaments/[id]/BracketRoundList.tsx
'use client'

import { useTranslations } from 'next-intl'
import BracketCell from './BracketCell'
import type { BracketNode, RoundCode, PairPath } from './bracket-builder'
import { ROUND_ORDER, pairKeyFor } from './bracket-builder'

const GREEN = '#7ED321'
const MUTED = '#6B7280'

type Props = {
  bracket: BracketNode[]
  rounds: RoundCode[]                      // rounds present in this draw, in order
  activeRound: RoundCode
  setActiveRound: (r: RoundCode) => void
  trackedPairKey: string | null
  trackedPath: PairPath
  trackingVariant: 'tracking' | 'defendingChamp' | null
  onTrackPair: (pairKey: string) => void
  markersByPair: Map<string, 'Q' | 'WC' | 'LL'>
}

export default function BracketRoundList({
  bracket, rounds, activeRound, setActiveRound,
  trackedPairKey, trackedPath, trackingVariant, onTrackPair, markersByPair,
}: Props) {
  const trackedRoundSet = new Set(trackedPath.nodes.map(n => n.round))
  const lastTrackedIdx =
    trackedPath.nodes.length > 0
      ? ROUND_ORDER.indexOf(trackedPath.nodes[trackedPath.nodes.length - 1].round)
      : -1

  const cellsForActive = bracket
    .filter(n => n.round === activeRound)
    .sort((a, b) => a.positionInRound - b.positionInRound)

  return (
    <>
      {/* Round chip strip */}
      <div style={{
        display: 'flex', gap: 6, padding: '4px 0 12px',
        overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none',
      }}>
        {rounds.map(r => {
          const isActive = r === activeRound
          const isPassed = trackedRoundSet.has(r) && r !== activeRound
          const isLast = ROUND_ORDER.indexOf(r) === lastTrackedIdx && !trackedPath.eliminatedAt && trackedPath.nodes.length > 0
          const bg = isActive
            ? '#fff'
            : isPassed
            ? 'rgba(126,211,33,0.18)'
            : 'rgba(255,255,255,0.05)'
          const color = isActive
            ? '#000'
            : isPassed
            ? GREEN
            : MUTED
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

      {/* Cell list — paired with bracket-stub between every two cells */}
      <div>
        {chunkPairs(cellsForActive).map((pair, i) => (
          <div key={i} style={{ position: 'relative', marginBottom: 10 }}>
            {pair.map((node, j) => {
              const m = node.match
              const isTrackedHere = trackedPairKey != null && trackedPath.nodes.includes(node)
              const dim = trackedPath.eliminatedAt != null && !isTrackedHere && trackedPairKey != null
              const highlight = isTrackedHere
                ? trackingVariant === 'defendingChamp' ? 'defendingChamp' : 'tracking'
                : dim ? 'dim' : 'none'
              return (
                <div key={node.positionInRound} style={{ marginTop: j === 0 ? 0 : 4 }}>
                  <BracketCell
                    node={node}
                    highlight={highlight}
                    onTrackPair={onTrackPair}
                    pairKey={pairKeyFor}
                    markersByPair={markersByPair}
                  />
                </div>
              )
            })}
            {/* Bracket-stub on the right edge — shows pair feeding into next round */}
            {pair.length === 2 && (
              <div style={{
                position: 'absolute', right: -12, top: 0, bottom: 0, width: 12,
                pointerEvents: 'none',
              }}>
                <svg viewBox="0 0 12 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
                  <path d="M 0 25 H 6 V 75 H 0" stroke="rgba(255,255,255,0.18)" fill="none" strokeWidth="1" />
                  <path d="M 6 50 H 12" stroke="rgba(255,255,255,0.18)" fill="none" strokeWidth="1" />
                </svg>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}

function chunkPairs<T>(arr: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += 2) {
    out.push(arr.slice(i, i + 2))
  }
  return out
}
```

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit -p . 2>&1 | grep "BracketRoundList" | head -5`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add 'src/app/[locale]/(app)/tournaments/[id]/BracketRoundList.tsx'
git commit -m "feat(draw): add BracketRoundList with chip strip and paired cells"
```

---

### Task 9: `BracketMap` SVG component

**Files:**
- Create: `src/app/[locale]/(app)/tournaments/[id]/BracketMap.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/app/[locale]/(app)/tournaments/[id]/BracketMap.tsx
'use client'

import { useTranslations } from 'next-intl'
import type { BracketNode, RoundCode, PairPath } from './bracket-builder'
import { ROUND_SLOTS } from './bracket-builder'

const GREEN = '#7ED321'
const ORANGE = '#F5A623'
const MUTED = '#6B7280'

type Props = {
  rounds: RoundCode[]                  // rounds in this bracket, e.g. ['R32','R16','QF','SF','F']
  bracket: BracketNode[]
  trackedPath: PairPath
  trackedPairLabel: string | null      // header label, null when no tracking
  activeRound: RoundCode
  onJumpToRound: (r: RoundCode) => void
}

const VIEWBOX_W = 320
const VIEWBOX_H = 140
const TOP_Y = 22
const BOTTOM_Y = 120

export default function BracketMap({
  rounds, bracket, trackedPath, trackedPairLabel,
  activeRound, onJumpToRound,
}: Props) {
  const t = useTranslations('draw')

  // Compute X position for each round column (evenly spaced).
  const colX = (idx: number) => {
    if (rounds.length === 1) return VIEWBOX_W / 2
    return 30 + (idx * (VIEWBOX_W - 60)) / (rounds.length - 1)
  }

  // Compute Y position for a node within its round (evenly spaced top→bottom).
  const nodeY = (round: RoundCode, pos: number) => {
    const slots = ROUND_SLOTS[round]
    if (slots === 1) return (TOP_Y + BOTTOM_Y) / 2
    return TOP_Y + (pos * (BOTTOM_Y - TOP_Y)) / (slots - 1)
  }

  const trackedSet = new Set(trackedPath.nodes)

  // Render links — solid green for tracked path, dashed grey otherwise.
  const links: React.ReactNode[] = []
  for (let ri = 1; ri < rounds.length; ri++) {
    const round = rounds[ri]
    const prevRound = rounds[ri - 1]
    const xCurr = colX(ri)
    const xPrev = colX(ri - 1)
    const xMid = (xPrev + xCurr) / 2
    const slots = ROUND_SLOTS[round]
    for (let pos = 0; pos < slots; pos++) {
      const yCurr = nodeY(round, pos)
      const yPrevTop = nodeY(prevRound, pos * 2)
      const yPrevBot = nodeY(prevRound, pos * 2 + 1)
      const currNode = bracket.find(n => n.round === round && n.positionInRound === pos)
      const isTrackedHere = currNode != null && trackedSet.has(currNode)
      // Highlight only the segment that's actually on the tracked path
      const topNode = currNode?.feedFromTop ?? null
      const botNode = currNode?.feedFromBottom ?? null
      const topOnPath = topNode != null && trackedSet.has(topNode)
      const botOnPath = botNode != null && trackedSet.has(botNode)

      links.push(
        <g key={`link-${round}-${pos}`}>
          {/* Top feeder line */}
          <line
            x1={xPrev} y1={yPrevTop} x2={xMid} y2={yPrevTop}
            stroke={topOnPath ? GREEN : 'rgba(255,255,255,0.08)'}
            strokeWidth={topOnPath ? 2.5 : 1.5}
            strokeDasharray={topOnPath || isTrackedHere ? '' : '3,2'}
            fill="none"
          />
          {/* Bottom feeder line */}
          <line
            x1={xPrev} y1={yPrevBot} x2={xMid} y2={yPrevBot}
            stroke={botOnPath ? GREEN : 'rgba(255,255,255,0.08)'}
            strokeWidth={botOnPath ? 2.5 : 1.5}
            strokeDasharray={botOnPath || isTrackedHere ? '' : '3,2'}
            fill="none"
          />
          {/* Vertical connector */}
          <line
            x1={xMid} y1={yPrevTop} x2={xMid} y2={yPrevBot}
            stroke={(topOnPath || botOnPath) ? GREEN : 'rgba(255,255,255,0.08)'}
            strokeWidth={(topOnPath || botOnPath) ? 2.5 : 1.5}
            fill="none"
          />
          {/* Mid → current connector */}
          <line
            x1={xMid} y1={yCurr} x2={xCurr} y2={yCurr}
            stroke={isTrackedHere ? GREEN : 'rgba(255,255,255,0.08)'}
            strokeWidth={isTrackedHere ? 2.5 : 1.5}
            strokeDasharray={isTrackedHere ? '' : '3,2'}
            fill="none"
          />
        </g>,
      )
    }
  }

  return (
    <div style={{
      background: '#0F0F0F', padding: '14px 12px 10px', marginBottom: 14,
      clipPath: 'polygon(0% 2%, 99.5% 0%, 100% 98%, 0.5% 100%)',
    }}>
      <div style={{
        color: trackedPairLabel ? '#9CA3AF' : MUTED, fontSize: 9, letterSpacing: '0.08em',
        textTransform: 'uppercase', marginBottom: 8, textAlign: 'center', fontWeight: 700,
      }}>
        {trackedPairLabel
          ? `${trackedPairLabel} · ${t('roadToTrophy')}`
          : t('roadToTrophy')}
      </div>
      <svg viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`} preserveAspectRatio="xMidYMid meet"
           style={{ width: '100%', height: 140, display: 'block' }}>
        {/* Round labels */}
        {rounds.map((r, i) => (
          <text
            key={r}
            x={colX(i)} y={12}
            fill={r === activeRound ? '#fff' : MUTED}
            fontSize="9" fontFamily="Inter, sans-serif"
            letterSpacing="0.06em" fontWeight="700"
            textAnchor="middle"
          >
            {r}
          </text>
        ))}
        {links}
        {/* Nodes */}
        {bracket.map(node => {
          const ri = rounds.indexOf(node.round)
          if (ri < 0) return null
          const x = colX(ri)
          const y = nodeY(node.round, node.positionInRound)
          const isTracked = trackedSet.has(node)
          const isActiveRound = node.round === activeRound
          const isCurrent = isTracked && isActiveRound
          const r = node.round === 'F' ? 6 : node.round === 'R64' || node.round === 'R32' ? 3 : 4
          let fill = '#2a2a2a'
          let stroke = 'rgba(255,255,255,0.08)'
          if (isCurrent) { fill = GREEN; stroke = GREEN }
          else if (isTracked) { fill = 'rgba(126,211,33,0.55)'; stroke = GREEN }
          if (node.isBye) {
            return (
              <text
                key={`bye-${node.round}-${node.positionInRound}`}
                x={x} y={y + 3}
                fill={MUTED} fontSize="7" textAnchor="middle"
                fontFamily="Inter, sans-serif" fontWeight="700"
              >
                {t('byeLabel')}
              </text>
            )
          }
          return (
            <circle
              key={`${node.round}-${node.positionInRound}`}
              cx={x} cy={y} r={r}
              fill={fill} stroke={stroke} strokeWidth={1}
              style={{ cursor: 'pointer' }}
              onClick={() => onJumpToRound(node.round)}
            />
          )
        })}
        {/* Trophy ★ at the F node */}
        {rounds.includes('F') && (
          <text
            x={colX(rounds.indexOf('F'))} y={nodeY('F', 0) + 22}
            textAnchor="middle" fontSize="11" fill={ORANGE}
          >
            ★
          </text>
        )}
      </svg>
    </div>
  )
}
```

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit -p . 2>&1 | grep "BracketMap" | head -5`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add 'src/app/[locale]/(app)/tournaments/[id]/BracketMap.tsx'
git commit -m "feat(draw): add BracketMap SVG with tracked-path highlighting"
```

---

### Task 10: `DrawTab` orchestrator

**Files:**
- Create: `src/app/[locale]/(app)/tournaments/[id]/DrawTab.tsx`

- [ ] **Step 1: Create the orchestrator**

```tsx
// src/app/[locale]/(app)/tournaments/[id]/DrawTab.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useFormatter } from 'next-intl'
import { DATE_SHORT } from '@/lib/format-patterns'
import { Link } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import { useFollowing } from '@/hooks/useFollowing'
import EmptyState from '@/components/EmptyState'
import BracketMap from './BracketMap'
import BracketRoundList from './BracketRoundList'
import FollowingPill from './FollowingPill'
import {
  buildBracket, tracePairPath, defaultTrackedPair, pairKeyFor,
  ROUND_ORDER,
} from './bracket-builder'
import type { RoundCode, DefendingChampPair, BracketNode } from './bracket-builder'
import type { Match } from '@/types/match'
import { toShortName } from '@/types/match'

const MUTED = '#6B7280'

type Props = {
  tournamentId: string
  matches: Match[]                                 // category-filtered matches
  category: 'men' | 'women'
  defendingChamp: DefendingChampPair | null         // null when no defending champ in this draw
  preMainDrawDate: string | null                    // ISO date string when no main-draw matches yet exist
  onSwitchToMatchesTab: () => void
}

export default function DrawTab({
  tournamentId, matches, category, defendingChamp, preMainDrawDate, onSwitchToMatchesTab,
}: Props) {
  const t = useTranslations('draw')
  const format = useFormatter()
  const { getFollowed } = useFollowing()
  const bookmarkedPlayerIds = useMemo(() => getFollowed('player'), [getFollowed])

  // Load Q/WC/LL markers from tournament_draws and key by pairKey so they
  // follow the pair through every round (markers describe how a pair entered
  // the draw, not which cell they're in).
  const [markersByPair, setMarkersByPair] = useState<Map<string, 'Q' | 'WC' | 'LL'>>(new Map())
  useEffect(() => {
    let cancelled = false
    supabase
      .from('tournament_draws')
      .select('player1_id, player2_id, marker')
      .eq('tournament_id', tournamentId)
      .eq('category', category)
      .not('marker', 'is', null)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.warn('[DrawTab] tournament_draws fetch failed:', error)
          return
        }
        const map = new Map<string, 'Q' | 'WC' | 'LL'>()
        for (const row of (data ?? []) as Array<{ player1_id: string | null; player2_id: string | null; marker: 'Q' | 'WC' | 'LL' | null }>) {
          if (!row.player1_id || !row.player2_id || !row.marker) continue
          map.set(pairKeyFor(row.player1_id, row.player2_id), row.marker)
        }
        setMarkersByPair(map)
      })
    return () => { cancelled = true }
  }, [tournamentId, category])

  // Filter to main-draw rounds only (no Q1/Q2/Q3 in v1).
  const mainDrawMatches = useMemo(
    () => matches.filter(m => {
      const rc = (m as any).round_canonical as string | null
      return rc != null && ROUND_ORDER.includes(rc as RoundCode)
    }),
    [matches],
  )

  // Determine drawSize from R64 / R32 / R16 presence.
  const drawSize = useMemo(() => {
    const hasR64 = mainDrawMatches.some(m => (m as any).round_canonical === 'R64')
    if (hasR64) return 64
    const hasR32 = mainDrawMatches.some(m => (m as any).round_canonical === 'R32')
    if (hasR32) return 32
    return 16
  }, [mainDrawMatches])

  const bracket = useMemo(
    () => buildBracket(mainDrawMatches, drawSize),
    [mainDrawMatches, drawSize],
  )

  // Rounds present in this bracket, in order.
  const rounds = useMemo<RoundCode[]>(() => {
    const startIdx = drawSize === 64 ? 0 : drawSize === 32 ? 1 : 2
    return ROUND_ORDER.slice(startIdx)
  }, [drawSize])

  // Tracked pair state — initialized once on mount (or when bracket changes).
  const [trackedPairKey, setTrackedPairKey] = useState<string | null>(null)
  const [variant, setVariant] = useState<'tracking' | 'defendingChamp' | null>(null)

  useEffect(() => {
    if (bracket.length === 0) return
    const key = defaultTrackedPair(bracket, bookmarkedPlayerIds, defendingChamp)
    if (key) {
      // If the resolved key matches a bookmarked player → 'tracking', else champ.
      const bookmarkedPair = bookmarkedPlayerIds.length > 0 &&
        bracket.some(n => {
          const m = n.match
          if (!m) return false
          const ids = [m.pair1_player1?.id, m.pair1_player2?.id, m.pair2_player1?.id, m.pair2_player2?.id].filter(Boolean) as string[]
          return ids.some(id => bookmarkedPlayerIds.includes(id))
        })
      setVariant(bookmarkedPair ? 'tracking' : 'defendingChamp')
    }
    setTrackedPairKey(key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bracket.length, defendingChamp?.player1Id, defendingChamp?.player2Id, category])

  const trackedPath = useMemo(
    () => tracePairPath(bracket, trackedPairKey),
    [bracket, trackedPairKey],
  )

  // Active round defaults to the latest round with a played-or-live match.
  const [activeRound, setActiveRound] = useState<RoundCode>(rounds[0])
  useEffect(() => {
    const playedRound = [...rounds].reverse().find(r =>
      bracket.some(n =>
        n.round === r && n.match &&
        (n.match.status === 'live' || n.match.status === 'finished'),
      ),
    )
    setActiveRound(playedRound ?? rounds[0])
  }, [bracket.length, rounds.join(',')])  // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-main-draw empty state
  if (mainDrawMatches.length === 0) {
    return (
      <div style={{ padding: '32px 16px' }}>
        <EmptyState
          title={t('preMainDrawTitle')}
          subtitle={preMainDrawDate
            ? t('preMainDrawBody', { date: format.dateTime(new Date(preMainDrawDate), DATE_SHORT) })
            : t('preMainDrawNoDate')}
          action={
            <button
              onClick={onSwitchToMatchesTab}
              style={{
                padding: '10px 18px', background: '#7ED321', color: '#000',
                border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12,
                clipPath: 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)',
              }}
            >
              {t('goToMatches')}
            </button>
          }
        />
      </div>
    )
  }

  // Resolve the tracked pair's display label
  const trackedPairLabel = useMemo(() => {
    if (!trackedPairKey || trackedPath.nodes.length === 0) return null
    const firstMatch = trackedPath.nodes[0].match
    if (!firstMatch) return null
    const [aId, bId] = trackedPairKey.split('::')
    const all = [
      firstMatch.pair1_player1, firstMatch.pair1_player2,
      firstMatch.pair2_player1, firstMatch.pair2_player2,
    ].filter(Boolean) as NonNullable<Match['pair1_player1']>[]
    const p1 = all.find(p => p.id === aId)
    const p2 = all.find(p => p.id === bId)
    if (!p1 || !p2) return null
    return `${toShortName(p1.name ?? '')}/${toShortName(p2.name ?? '')}`
  }, [trackedPairKey, trackedPath.nodes])

  return (
    <div style={{ padding: '12px 12px 16px 12px' }}>
      <BracketMap
        rounds={rounds}
        bracket={bracket}
        trackedPath={trackedPath}
        trackedPairLabel={trackedPairLabel}
        activeRound={activeRound}
        onJumpToRound={r => setActiveRound(r)}
      />
      {trackedPairKey && trackedPairLabel && variant && (
        <FollowingPill
          pairLabel={trackedPairLabel}
          variant={variant}
          eliminatedAt={trackedPath.eliminatedAt}
          onDismiss={() => { setTrackedPairKey(null); setVariant(null) }}
        />
      )}
      <BracketRoundList
        bracket={bracket}
        rounds={rounds}
        activeRound={activeRound}
        setActiveRound={setActiveRound}
        trackedPairKey={trackedPairKey}
        trackedPath={trackedPath}
        trackingVariant={variant}
        onTrackPair={key => {
          setTrackedPairKey(key)
          setVariant('tracking')
        }}
        markersByPair={markersByPair}
      />
      <div style={{
        fontSize: 9, color: MUTED, paddingTop: 10,
        borderTop: '1px solid rgba(255,255,255,0.04)', marginTop: 8, lineHeight: 1.6,
      }}>
        <b style={{ color: '#9CA3AF' }}>Q</b> {t('legendQ')} &nbsp;·&nbsp;{' '}
        <b style={{ color: '#9CA3AF' }}>WC</b> {t('legendWc')} &nbsp;·&nbsp;{' '}
        <b style={{ color: '#9CA3AF' }}>LL</b> {t('legendLl')} &nbsp;·&nbsp;{' '}
        <b style={{ color: '#9CA3AF' }}>[1]</b> {t('legendSeed')}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit -p . 2>&1 | grep "DrawTab\|bracket-builder\|FollowingPill\|BracketCell\|BracketMap\|BracketRoundList" | head -10`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add 'src/app/[locale]/(app)/tournaments/[id]/DrawTab.tsx'
git commit -m "feat(draw): add DrawTab orchestrator with state and defaults"
```

---

## Phase 4 — Integration into the tournament page

### Task 11: Wire DrawTab into `page.tsx`

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/page.tsx`

- [ ] **Step 1: Add the level constant for Draw-tab gating**

Open `src/app/[locale]/(app)/tournaments/[id]/page.tsx` and find the existing constants block near the top (around line 45 where `FULL_COVERAGE_LEVELS` is defined). Add this constant nearby:

```ts
// Tiers that get the Draw tab. Lower tiers (fip_other, padelapi-only)
// don't have reliable bracket data and skip this UI.
const DRAW_TIERS = new Set([
  'major', 'p1', 'p2', 'finals',
  'fip_bronze', 'fip_silver', 'fip_gold', 'fip_platinum',
])
```

- [ ] **Step 2: Add `'draw'` to the `pageTab` state union and update the URL-param mapping**

Find line 180 — the `useState<'matches' | 'overview' | 'story'>` declaration. Change the type:

```ts
const [pageTab, setPageTab] = useState<'matches' | 'overview' | 'story' | 'draw'>(
  // …existing initial-value logic unchanged
)
```

Find line 181-189 (the initial-value logic) and add `paramTab === 'draw' ? 'draw'` as the first branch BEFORE the existing checks:

```ts
const [pageTab, setPageTab] = useState<'matches' | 'overview' | 'story' | 'draw'>(
  paramTab === 'draw'
    ? 'draw'
    : paramTab === 'story' || paramTab === 'recap'
    ? 'story'
    : paramTab === 'matches'
    ? 'matches'
    : 'overview',
)
```

- [ ] **Step 3: Compute the gating boolean and add `'draw'` to the tab strip**

Find the tab-strip block at line 745-770. Just above it (in the same component scope), compute the gate:

```ts
// Draw-tab gating: tier check + ≥80% of main-draw matches have round_canonical
const showDrawTab = useMemo(() => {
  if (!activeTournamentObj) return false
  if (!DRAW_TIERS.has(activeTournamentObj.level ?? '')) return false
  const mainDrawMatches = allMatches.filter(m =>
    (m as any).category === genderFilter &&
    ['R64', 'R32', 'R16', 'QF', 'SF', 'F'].includes((m as any).round_canonical ?? ''),
  )
  if (mainDrawMatches.length === 0) {
    // No main-draw matches yet — show the tab anyway (we display a "draw not released" empty state)
    return true
  }
  // Inverse check: if there's any match with `round` populated but no
  // round_canonical, the data is incomplete.
  const allMatchesWithRound = allMatches.filter(m =>
    (m as any).category === genderFilter && m.round != null,
  )
  if (allMatchesWithRound.length === 0) return true
  const completeness = mainDrawMatches.length / allMatchesWithRound.length
  return completeness >= 0.8
}, [activeTournamentObj, allMatches, genderFilter])
```

Then update the tab-strip block (lines 746-769). Replace the existing tab map with a dynamically-computed list:

```tsx
{(['overview', 'story', 'matches', ...(showDrawTab ? ['draw'] as const : [])] as const).map(tab => {
  const active = pageTab === tab
  return (
    <button
      key={tab}
      onClick={() => setPageTab(tab)}
      style={{
        flex: 1, padding: '12px 0', border: 'none', background: 'none', cursor: 'pointer',
        fontSize: 12, fontWeight: 800, letterSpacing: 0.5, fontFamily: 'inherit',
        color: active ? GREEN : MUTED,
        position: 'relative', transition: 'color 0.2s',
        textTransform: 'uppercase',
      }}
    >
      {tTournament(tab)}
      {active && (
        <span style={{
          position: 'absolute', bottom: -1, left: '15%', right: '15%',
          height: 2, background: GREEN,
        }} />
      )}
    </button>
  )
})}
```

- [ ] **Step 4: Add the `import` and the `DrawTab` mount block**

At the top of `page.tsx`, find the existing component imports (around line 14-23) and add:

```ts
import DrawTab from './DrawTab'
```

Find the existing `{pageTab === 'matches' && (` block (around line 843). After the closing of the matches/overview/story blocks, add the DrawTab mount:

```tsx
{pageTab === 'draw' && activeTournamentObj && (
  <DrawTab
    tournamentId={tournamentId}
    matches={allMatches.filter(m => (m as any).category === genderFilter)}
    category={genderFilter}
    defendingChamp={null}
    preMainDrawDate={(activeTournamentObj as any).round_schedule?.r32 ?? (activeTournamentObj as any).round_schedule?.r16 ?? null}
    onSwitchToMatchesTab={() => setPageTab('matches')}
  />
)}
```

> **Defending-champ in v1:** `defendingChamp={null}` is the v1 ship state. The UI falls through to bookmarked-player priority (and finally to no-highlight) which is sufficient for the personalized default-load story. Wiring the cross-source last-year-winner lookup is listed in Follow-ups — it lives in a separate change because it requires touching the hub-page lookup helper.

- [ ] **Step 5: TypeScript check**

Run: `npx tsc --noEmit -p . 2>&1 | grep "tournaments/\[id\]" | head -10`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add 'src/app/[locale]/(app)/tournaments/[id]/page.tsx'
git commit -m "feat(draw): wire DrawTab into tournament detail page with tier gating"
```

---

## Phase 5 — Verification

### Task 12: Manual smoke test in dev

**Files:** none (manual verification only)

- [ ] **Step 1: Start dev server**

Run: `npm run dev`
Expected: server up on `localhost:3002`

- [ ] **Step 2: Identify a Premier P1/P2 tournament with active main-draw data**

Run this query in Supabase SQL editor (or via psql):

```sql
SELECT t.id, t.name, t.level, t.starts_at,
       count(*) FILTER (WHERE m.round_canonical IN ('R32','R16','QF','SF','F')) AS main_draw_count
FROM tournaments t
JOIN matches m ON m.tournament_id = t.id
WHERE t.level IN ('p1','p2','major')
  AND m.category = 'men'
  AND t.starts_at > now() - interval '14 days'
GROUP BY t.id
ORDER BY t.starts_at DESC
LIMIT 5;
```

Expected: at least one tournament with `main_draw_count >= 16`.

- [ ] **Step 3: Open the tournament in the browser and verify the Draw tab appears**

Visit `http://localhost:3002/tournaments/<id>`. Expected:
- Tab strip shows `OVERVIEW · STORY · MATCHES · DRAW`
- Clicking DRAW shows the bracket map at top + chip strip + cells

- [ ] **Step 4: Verify the bracket map renders correctly**

Expected:
- 5 round labels visible at the top of the SVG (`R32 R16 QF SF F`)
- Nodes rendered as circles with sizes increasing toward F
- Trophy ★ at the right edge under the F node
- Active round label (matching chip strip) is white; others are grey

- [ ] **Step 5: Verify tap-to-track**

Tap any pair name in any cell. Expected:
- Green glow appears on that cell
- "Following · <Pair>" pill shows above the cells
- Bracket map re-renders with that pair's path traced in solid green
- Chip strip's passed rounds turn green

- [ ] **Step 6: Verify dismiss**

Tap × on the pill. Expected:
- Pill disappears
- All cells return to neutral state
- Bracket map shows no green path

- [ ] **Step 7: Verify category toggle and round chip jump**

Switch `M` ↔ `W`. Expected:
- Bracket re-renders for the new category
- Tracked pair clears (different draw)

Tap a round chip (e.g. `SF`). Expected:
- Cells below switch to that round
- Active chip turns white

Tap a node on the bracket map. Expected: chip strip jumps to that round, cells render below.

- [ ] **Step 8: Verify tier gating**

Visit a `fip_other` tournament. Expected: no Draw tab in the strip.
Visit an old padelapi-only tournament with no `round_canonical` data. Expected: no Draw tab.

- [ ] **Step 9: Verify pre-main-draw empty state**

Visit a tournament that has matches but no `round_canonical IN (R32, R16, …)`. Expected: Draw tab shows "Main draw not yet released" with a button to switch to Matches tab.

- [ ] **Step 9b: Verify Q/WC/LL marker rendering on a FIP draw**

Identify a FIP Gold/Silver/Bronze tournament whose `tournament_draws` rows have non-null markers:

```sql
SELECT t.id, t.name, count(*) AS marker_count
FROM tournaments t
JOIN tournament_draws td ON td.tournament_id = t.id
WHERE td.marker IS NOT NULL
  AND t.level IN ('fip_bronze','fip_silver','fip_gold','fip_platinum')
  AND t.starts_at > now() - interval '60 days'
GROUP BY t.id ORDER BY t.starts_at DESC LIMIT 5;
```

Visit that tournament's Draw tab. Expected: at least one cell shows a small orange `Q`/`WC`/`LL` pill next to the seed pill on a pair. The marker stays on the pair as you navigate to later rounds (e.g., if a Q pair won R32, the Q pill still appears on their R16 cell).

- [ ] **Step 10: Verify localization**

Switch to `/es/tournaments/<id>`. Expected: tab label reads `CUADRO`. Pill reads `Siguiendo · …`. Footer key reads `Q Clasificado · …`.
Repeat for `/pt/`, `/it/`, `/fr/`.

- [ ] **Step 11: Note any issues for follow-up**

If any expected behavior fails:
- Note the tournament ID and category that triggered it
- Open browser console for errors
- Add a follow-up task to this plan or open a new issue

If everything passes, the v1 ships.

- [ ] **Step 12: Final test sweep**

Run: `npx vitest run src/app/\[locale\]/\(app\)/tournaments/\[id\]/bracket-builder.test.ts`
Expected: all 17 tests green.

Run: `npm run lint` (project linter)
Expected: no new errors.

- [ ] **Step 13: Commit any verification fixes**

If you fixed any issues during smoke testing, commit them:

```bash
git add <files>
git commit -m "fix(draw): <issue description>"
```

If no fixes were needed, no commit.

---

## Done — what shipped

After all 12 tasks:

1. New `Draw` tab on `/tournaments/[id]` for the listed tiers
2. Mini-bracket SVG map at the top with tracked-pair path highlighting
3. Round chip strip + paired cells with bracket-stub connectors
4. Tap-to-track interaction (any pair → green glow + map redraw)
5. Auto-default: bookmarked player → no highlight (defending-champ wiring is a follow-up; UI accepts the prop and falls through)
6. Q/WC/LL marker pills next to seed pill — fetched from `tournament_draws`, follow the pair across rounds
7. Empty state for pre-main-draw window
8. All 5 locales translated
9. 17 unit tests for `bracket-builder.ts`

## Follow-ups (out of v1 scope)

- Wire defending-champion lookup (the `null` prop in Task 11 Step 4 — the helper is already used by the home hub page per CLAUDE.md)
- Qualifying-round bracket (Q1/Q2/Q3) — separate spec
- Desktop-only full-tree SVG view (≥768px breakpoint)
- Predict-the-bracket — separate product, separate URL
- Share-bracket-as-image — uses existing share-system work

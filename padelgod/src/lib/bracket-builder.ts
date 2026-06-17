// padelgod/src/lib/bracket-builder.ts
//
// Worker-side mirror of the public app's bracket reconstruction
// (src/app/[locale]/(app)/tournaments/[id]/bracket-builder.ts). Keeps the
// projection's view of the bracket aligned with the Draw tab — both source from
// `matches`. Adapted to the worker's ID-only match rows and exposes
// `buildFirstRoundLeaves`, the power-of-two first-round entrant array the
// projection forward-sim consumes.
//
// Divergence from the source (intentional): omits the name-token feed fallback
// (Pass 2), which needs per-player names and only guards against duplicate
// player records. Premier draws (where projections matter) carry Crionet widget
// heap codes, so Pass 0 places them precisely; FIP draws fall back to UUID-feed
// + positional placement.

import type { FrontierEntrant } from './bracket-projection.js'

export type RoundCode = 'R64' | 'R32' | 'R16' | 'QF' | 'SF' | 'F'
export const ROUND_ORDER: RoundCode[] = ['R64', 'R32', 'R16', 'QF', 'SF', 'F']
export const ROUND_SLOTS: Record<RoundCode, number> = { R64: 32, R32: 16, R16: 8, QF: 4, SF: 2, F: 1 }

export interface BracketMatch {
  id: string
  round: string | null
  round_canonical: string | null
  widget_id_composite: string | null
  winner_pair: number | null
  pair1_player1_id: string | null
  pair1_player2_id: string | null
  pair2_player1_id: string | null
  pair2_player2_id: string | null
  pair1_seed: number | null
  pair2_seed: number | null
}

/** Entrant factory the caller injects (teamElo lives in the worker). */
export type MkEntrant = (id1: string, id2: string, seed: number | null) => FrontierEntrant

function canonRound(r: string | null | undefined): RoundCode | null {
  if (!r) return null
  const x = r.toLowerCase()
  if (x.includes('round of 64') || x === 'r64') return 'R64'
  if (x.includes('round of 32') || x === 'r32') return 'R32'
  if (x.includes('round of 16') || x === 'r16') return 'R16'
  if (x === 'qf' || x.includes('quarter')) return 'QF'
  if (x === 'sf' || x.includes('semi')) return 'SF'
  if (x === 'f' || x.includes('final')) return 'F'
  return null
}
const roundOf = (m: BracketMatch) => canonRound(m.round_canonical ?? m.round)

function widgetHeapNumber(w: string | null): number | null {
  if (!w) return null
  const hit = /[MW]D(\d+)$/.exec(w)
  if (!hit?.[1]) return null
  const n = parseInt(hit[1], 10)
  return Number.isFinite(n) ? n : null
}

/** Stable per-round ordering: widget code (heap order for same width), then id. */
function stableSort(a: BracketMatch, b: BracketMatch): number {
  const aw = a.widget_id_composite ?? '', bw = b.widget_id_composite ?? ''
  if (aw && bw && aw !== bw) return aw < bw ? -1 : 1
  return (a.id ?? '').localeCompare(b.id ?? '')
}

function bothIds(p1: string | null, p2: string | null): p1 is string {
  return Boolean(p1 && p2)
}

/**
 * Build the power-of-two first-round leaf array for `projectPairs`.
 *
 * - drawSize comes from the deepest round present (R64/R32/R16).
 * - First-round matches are placed at their bracket positions via widget heap
 *   number (authoritative), then next-round UUID feed, then a positional
 *   fallback that skips likely byes.
 * - A first-round cell with no match but whose next-round cell carries a real
 *   pair on the feeding side is a SEED BYE — that pair is placed as `[seed,
 *   null]` so it enters the sim (this is the bug the matches-frontier missed).
 * - Empty/not-yet-drawn cells stay null; the engine bye-advances them.
 *
 * Index 2k / 2k+1 are first-round opponents (the projectPairs contract).
 */
export function buildFirstRoundLeaves(
  rows: BracketMatch[],
  mkEntrant: MkEntrant,
): (FrontierEntrant | null)[] {
  const byRound = new Map<RoundCode, BracketMatch[]>()
  for (const m of rows) {
    const r = roundOf(m)
    if (!r) continue
    ;(byRound.get(r) ?? byRound.set(r, []).get(r)!).push(m)
  }
  const drawSize: 64 | 32 | 16 = byRound.has('R64') ? 64 : byRound.has('R32') ? 32 : 16
  const startIdx = drawSize === 64 ? 0 : drawSize === 32 ? 1 : 2
  const rounds = ROUND_ORDER.slice(startIdx)
  const firstRound = rounds[0]!
  const nextRound = rounds[1] as RoundCode | undefined
  const firstSlotCount = ROUND_SLOTS[firstRound]

  for (const list of byRound.values()) list.sort(stableSort)
  const firstMatches = byRound.get(firstRound) ?? []
  const nextMatches = nextRound ? (byRound.get(nextRound) ?? []) : []

  // Place first-round matches at bracket positions.
  const byPos = new Map<number, BracketMatch>()
  const unplaced = new Set<BracketMatch>(firstMatches)

  // Pass 0: widget heap number. A round with `slotCount` cells occupies heap
  // nodes [slotCount, 2*slotCount-1], so slot = heapNum - firstSlotCount.
  for (const m of [...unplaced]) {
    const num = widgetHeapNumber(m.widget_id_composite)
    if (num == null) continue
    const slot = num - firstSlotCount
    if (slot < 0 || slot >= firstSlotCount || byPos.has(slot)) continue
    byPos.set(slot, m)
    unplaced.delete(m)
  }

  // Pass 1: next-round UUID feed (even pos → pair1, odd pos → pair2).
  const feedMatch = (p1: string | null, p2: string | null): BracketMatch | undefined => {
    if (!bothIds(p1, p2)) return undefined
    for (const m of unplaced) {
      const inP1 = (p1 === m.pair1_player1_id && p2 === m.pair1_player2_id) || (p1 === m.pair1_player2_id && p2 === m.pair1_player1_id)
      const inP2 = (p1 === m.pair2_player1_id && p2 === m.pair2_player2_id) || (p1 === m.pair2_player2_id && p2 === m.pair2_player1_id)
      if (inP1 || inP2) return m
    }
    return undefined
  }
  for (let j = 0; j < nextMatches.length; j++) {
    const m = nextMatches[j]!
    const top = feedMatch(m.pair1_player1_id, m.pair1_player2_id)
    if (top && !byPos.has(2 * j)) { byPos.set(2 * j, top); unplaced.delete(top) }
    const bot = feedMatch(m.pair2_player1_id, m.pair2_player2_id)
    if (bot && !byPos.has(2 * j + 1)) { byPos.set(2 * j + 1, bot); unplaced.delete(bot) }
  }

  // Fallback: fill remaining unplaced into empty, non-bye positions.
  const isLikelyBye = (pos: number): boolean => {
    if (!nextRound) return false
    const cell = nextMatches[Math.floor(pos / 2)]
    if (!cell) return false
    const side = pos % 2 === 0 ? cell.pair1_player1_id : cell.pair2_player1_id
    return side != null
  }
  let fb = 0
  for (const m of unplaced) {
    while (fb < firstSlotCount && (byPos.has(fb) || isLikelyBye(fb))) fb++
    if (fb >= firstSlotCount) break
    byPos.set(fb, m); fb++
  }

  // Materialise leaves: each first-round cell → two leaf slots.
  const leaves: (FrontierEntrant | null)[] = new Array(firstSlotCount * 2).fill(null)
  for (let pos = 0; pos < firstSlotCount; pos++) {
    const m = byPos.get(pos)
    if (m) {
      if (bothIds(m.pair1_player1_id, m.pair1_player2_id)) leaves[2 * pos] = mkEntrant(m.pair1_player1_id, m.pair1_player2_id!, m.pair1_seed)
      if (bothIds(m.pair2_player1_id, m.pair2_player2_id)) leaves[2 * pos + 1] = mkEntrant(m.pair2_player1_id, m.pair2_player2_id!, m.pair2_seed)
    }
    // Seed bye: the next-round cell carries a real pair on this slot's side.
    // Fires both when the slot has NO first-round match AND when an empty
    // placeholder match occupies it but contributed no entrant (both leaves
    // still null) — otherwise a top seed whose bye slot holds a TBD-vs-TBD
    // placeholder row would vanish from the bracket entirely.
    if (nextRound && leaves[2 * pos] == null && leaves[2 * pos + 1] == null) {
      const cell = nextMatches[Math.floor(pos / 2)]
      if (cell) {
        const top = pos % 2 === 0
        const s1 = top ? cell.pair1_player1_id : cell.pair2_player1_id
        const s2 = top ? cell.pair1_player2_id : cell.pair2_player2_id
        const seed = top ? cell.pair1_seed : cell.pair2_seed
        if (bothIds(s1, s2)) leaves[2 * pos] = mkEntrant(s1, s2!, seed)
      }
    }
  }
  return leaves
}

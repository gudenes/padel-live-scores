// src/app/[locale]/(app)/tournaments/[id]/bracket-builder.ts
// Pure-logic bracket-tree helpers. No React, no Supabase.

import type { Match } from '@/types/match'
import { roundCanonical } from '@/lib/round-canonical'

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
  const matchByKey = new Map<string, Match>()
  for (const m of matches) {
    const r = roundCanonical(m.round) as RoundCode | null
    if (!r || !rounds.includes(r)) continue
    const pos = m.draw_position
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
  //
  // Convention: even pos (0, 2, 4…) feeds pair1 of the next-round cell,
  // odd pos feeds pair2. This mirrors padelgod's fip-draw-populator,
  // which assigns Crionet's team1 → pair1 and team2 → pair2, and Crionet
  // lists the top-feeding team first in each draw row.
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

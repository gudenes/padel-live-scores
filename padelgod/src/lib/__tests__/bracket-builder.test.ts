import { describe, it, expect } from 'vitest'
import { buildFirstRoundLeaves, type BracketMatch } from '../bracket-builder.js'
import type { FrontierEntrant } from '../bracket-projection.js'

const mk = (a: string, b: string): FrontierEntrant => ({
  pairKey: a < b ? `${a}::${b}` : `${b}::${a}`,
  playerIds: (a < b ? [a, b] : [b, a]) as [string, string],
  teamElo: 1500,
})
const M = (o: Partial<BracketMatch>): BracketMatch => ({
  id: 'm', round: null, round_canonical: null, widget_id_composite: null, winner_pair: null,
  pair1_player1_id: null, pair1_player2_id: null, pair2_player1_id: null, pair2_player2_id: null,
  pair1_seed: null, pair2_seed: null, ...o,
})

describe('buildFirstRoundLeaves', () => {
  it('places a first-round match by widget heap and includes a next-round seed bye', () => {
    // 32-draw (R32 present): firstRound R32 → 16 cells, 32 leaves.
    const rows: BracketMatch[] = [
      // R32 match at heap MD017 → slot 17-16 = 1.
      M({ id: 'r32', round_canonical: 'R32', widget_id_composite: 'X:MD017', pair1_player1_id: 'm1', pair1_player2_id: 'm2', pair2_player1_id: 'm3', pair2_player2_id: 'm4' }),
      // R16 cell at heap MD008 (cell 0) with a seed on pair1, TBD on pair2.
      // No R32 feeds its top side → R32 slot 0 is the seed's first-round bye.
      M({ id: 'r16', round_canonical: 'R16', widget_id_composite: 'X:MD008', pair1_player1_id: 's1', pair1_player2_id: 's2', pair1_seed: 1 }),
    ]
    const leaves = buildFirstRoundLeaves(rows, mk)
    expect(leaves.length).toBe(32)
    expect(leaves[0]?.pairKey).toBe('s1::s2')   // seed bye placed at slot 0
    expect(leaves[1]).toBeNull()                 // bye → opponent null
    expect(leaves[2]?.pairKey).toBe('m1::m2')    // R32 match at slot 1
    expect(leaves[3]?.pairKey).toBe('m3::m4')
  })

  it('returns an all-null leaf array (no real teams) for a draw with no main rounds', () => {
    const leaves = buildFirstRoundLeaves([M({ round_canonical: 'Q1' })], mk)
    expect(leaves.filter(Boolean).length).toBe(0)
  })
})

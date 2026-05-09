// src/app/[locale]/(app)/tournaments/[id]/bracket-builder.test.ts
import { describe, expect, it } from 'vitest'
import { buildBracket, pairKeyFor, tracePairPath } from './bracket-builder'
import type { Match } from '@/types/match'

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

  it('marks a bye on the bottom-feed (odd pos) side when pair2 of next round is populated', () => {
    // R16 match where pair2 is a seeded pair; the bottom-feeding R32 slot (pos 1) is a bye
    const matches: Match[] = [
      fakeMatch({
        id: 'r16-0', round: 'R16', draw_position: 0,
        pair2_player1: { id: 'seed-2' } as any,
        pair2_player2: { id: 'seed-2-partner' } as any,
      }),
    ]
    const bracket = buildBracket(matches, 32)
    const r32bot = bracket.find(n => n.round === 'R32' && n.positionInRound === 1)!
    expect(r32bot.isBye).toBe(true)
  })

  it('does NOT mark a bye when the next-round cell has no pair on the relevant side', () => {
    // R16 match exists but has no pair1 — R32 pos 0 (top feed) should NOT be a bye
    const matches: Match[] = [
      fakeMatch({
        id: 'r16-0', round: 'R16', draw_position: 0,
        pair2_player1: { id: 'someone' } as any,
        pair2_player2: { id: 'partner' } as any,
        // pair1 left null
      }),
    ]
    const bracket = buildBracket(matches, 32)
    const r32top = bracket.find(n => n.round === 'R32' && n.positionInRound === 0)!
    expect(r32top.isBye).toBe(false)
  })
})

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

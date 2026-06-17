// src/app/[locale]/(app)/tournaments/[id]/bracket-builder.test.ts
import { describe, expect, it } from 'vitest'
import { buildBracket, defaultTrackedPair, pairKeyFor, tracePairPath } from './bracket-builder'
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

  it('marks a seed bye even when an empty placeholder match occupies its first-round slot', () => {
    // Real case: FIP Platinum Lusitania men's draw. Seed 1 (Gonzalez/Campagnolo)
    // byes R32 and appears only in R16 (opponent TBD), but the draw ALSO carries
    // an empty placeholder R32 match (both pairs TBD) sitting in the seed's bye
    // slot. The placeholder must NOT block bye-marking — otherwise the top seed
    // renders as a TBD match instead of "Seed [BYE]" and vanishes from R32.
    const matches: Match[] = [
      // Empty placeholder R32 at MD016 → R32 slot 0 (heap-placed via Pass 0,
      // regardless of players). Both pairs TBD. This is what occupies the bye
      // slot in the real draw and suppresses the bye marker.
      fakeMatch({ id: 'r32-placeholder', round: 'R32', widget_id_composite: 'FIP-TEST:MD016' }),
      // R16 cell MD008 → slot 0: seed 1 on pair1 (top feed), opponent TBD →
      // R32 slot 0 is the seed's first-round bye.
      fakeMatch({
        id: 'r16-md008', round: 'R16', widget_id_composite: 'FIP-TEST:MD008',
        pair1_player1: { id: 'gonzalez' } as any,
        pair1_player2: { id: 'campagnolo' } as any,
        pair1_seed: 1,
      }),
    ]
    const bracket = buildBracket(matches, 32)
    const r32top = bracket.find(n => n.round === 'R32' && n.positionInRound === 0)!
    expect(r32top.isBye).toBe(true)
    expect(r32top.byePair?.player1.id).toBe('gonzalez')
    // Placeholder dropped so BracketCell (which renders a bye only when
    // `isBye && !match`) shows the seed bye, not a TBD-vs-TBD match.
    expect(r32top.match).toBeNull()
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

  it('keeps a seed-bye marked as bye even when seed shares first name with an R64 player', () => {
    // Regression for Buenos Aires P1 2026: seed [14] Barahona/Alfonso has a
    // bye into R32. An unrelated R64 match (Valdes/Renzo Gabriel Nuñez) shares
    // common Spanish first names "Javier" and "Gabriel" with the seed. The
    // findFeedingMatch name-token fallback was matching the unrelated R64
    // match to the seed pair, displacing the bye marker and orphaning a slot
    // elsewhere as "Winner of TBD". The fix: skip Pass 2 when the target pair
    // is a seed with an empty opposite side.
    const matches: Match[] = [
      // R32 cell at bracket position 0: pair1 is seed 14, pair2 is TBD
      // (winner of an R64 they don't play).
      fakeMatch({
        id: 'r32-seed14', round: 'R32', draw_position: 0,
        pair1_player1: { id: 'barahona-id', name: 'Javier Barahona' } as any,
        pair1_player2: { id: 'alfonso-id', name: 'Gonzalo Gabriel Alfonso' } as any,
        pair1_seed: 14,
      }),
      // Unrelated R64 match. Shares "javier" with Barahona and "gabriel"
      // with Alfonso via Pass 2 false positive — they are NOT the same pair.
      fakeMatch({
        id: 'r64-other', round: 'R64', draw_position: 1,
        pair1_player1: { id: 'ronco', name: 'Adrian Ronco Lopez' } as any,
        pair1_player2: { id: 'lacamoire', name: 'Julian Lacamoire' } as any,
        pair2_player1: { id: 'valdes', name: 'Javier Valdes' } as any,
        pair2_player2: { id: 'renzo', name: 'Renzo Gabriel Nuñez' } as any,
      }),
    ]
    const bracket = buildBracket(matches, 64)
    // The R64 slot feeding seed14's pair1 (pos 0 = 2*0) should be a bye,
    // not occupied by the unrelated R64 match.
    const r64Pos0 = bracket.find(n => n.round === 'R64' && n.positionInRound === 0)!
    expect(r64Pos0.match).toBeNull()
    expect(r64Pos0.isBye).toBe(true)
    expect(r64Pos0.byePair?.player1.id).toBe('barahona-id')

    // The unrelated R64 match must still appear somewhere — not consumed
    // by the false-positive placement at the bye slot.
    const placedR64 = bracket.filter(n => n.round === 'R64' && n.match)
    expect(placedR64.length).toBe(1)
    expect(placedR64[0].match!.id).toBe('r64-other')
    expect(placedR64[0].positionInRound).not.toBe(0)
  })

  it('positions first-round matches by widget heap index when the next-round winner sides are TBD', () => {
    // Regression for Italy Major 2026: before any first-round match is
    // played, every R32 cell carries a seed on one side and a TBD (null)
    // winner on the other. findFeedingMatch can't link the R64 matches
    // (null players), so they used to be packed sequentially into the
    // first available non-bye slots — landing against the wrong seeds.
    //
    // The widget_id_composite is a binary-heap node number (MD001=Final,
    // R32 cells = MD016..MD031, R64 cells = MD032..MD063). The first-round
    // slot is therefore `heapNum - ROUND_SLOTS[R64]` (= heapNum - 32).
    // MD034 feeds MD017's top side → R64 slot 2, NOT slot 1.
    const matches: Match[] = [
      // R32 pos 0 (MD016): seed 1 on top, TBD opponent (bye into R32).
      fakeMatch({
        id: 'r32-md016', round: 'R32',
        widget_id_composite: 'FIP-TEST:MD016',
        pair1_player1: { id: 'tapia', name: 'Agustin Tapia' } as any,
        pair1_player2: { id: 'coello', name: 'Arturo Coello' } as any,
        pair1_seed: 1,
      }),
      // R32 pos 1 (MD017): TBD on top, seed 13 on bottom (bye into R32).
      fakeMatch({
        id: 'r32-md017', round: 'R32',
        widget_id_composite: 'FIP-TEST:MD017',
        pair2_player1: { id: 'garcia', name: 'Javier Garcia' } as any,
        pair2_player2: { id: 'casas', name: 'Jose Jimenez Casas' } as any,
        pair2_seed: 13,
      }),
      // R64 match feeding MD017's top side (MD034 → slot 2).
      fakeMatch({
        id: 'r64-md034', round: 'R64',
        widget_id_composite: 'FIP-TEST:MD034',
        pair1_player1: { id: 'rubini', name: 'Juan Ignacio Rubini' } as any,
        pair1_player2: { id: 'aguero', name: 'Maximiliano Sanchez Aguero' } as any,
        pair2_player1: { id: 'gala', name: 'David Gala' } as any,
        pair2_player2: { id: 'sirvent', name: 'Enzo Jensen Sirvent' } as any,
      }),
    ]
    const bracket = buildBracket(matches, 64)
    const md034 = bracket.find(n => n.round === 'R64' && n.match?.id === 'r64-md034')!
    expect(md034.positionInRound).toBe(2)
    // Seed 1 holds the bye at slot 0, seed 13 at slot 3.
    expect(bracket.find(n => n.round === 'R64' && n.positionInRound === 0)?.byePair?.player1.id).toBe('tapia')
    expect(bracket.find(n => n.round === 'R64' && n.positionInRound === 3)?.byePair?.player1.id).toBe('garcia')
  })

  it('still finds a Pass-1 (UUID) feeder for a seeded pair carrying forward to the next round', () => {
    // When a seeded pair WON their first-round match (rather than getting a
    // bye), the next-round cell carries the seed but the previous-round match
    // must still be linked via findFeedingMatch's UUID pass. The seed-bye
    // skip only applies when the opposite side of the next-round cell is
    // empty AND Pass 1 finds nothing — Pass 1 hits must still succeed.
    const matches: Match[] = [
      // R32 round 1 (firstRound for a 32-draw): Seed3 vs opponent
      fakeMatch({
        id: 'r32-played', round: 'R32', draw_position: 0,
        pair1_player1: { id: 'seed3-a', name: 'Seed Three Player A' } as any,
        pair1_player2: { id: 'seed3-b', name: 'Seed Three Player B' } as any,
        pair2_player1: { id: 'opp-a', name: 'Opp A' } as any,
        pair2_player2: { id: 'opp-b', name: 'Opp B' } as any,
        pair1_seed: 3,
        winner_pair: 1,
      }),
      // R16: Seed3 carried forward, opponent TBD (other R32 still pending)
      fakeMatch({
        id: 'r16-0', round: 'R16', draw_position: 0,
        pair1_player1: { id: 'seed3-a', name: 'Seed Three Player A' } as any,
        pair1_player2: { id: 'seed3-b', name: 'Seed Three Player B' } as any,
        pair1_seed: 3,
      }),
    ]
    const bracket = buildBracket(matches, 32)
    // R32 pos 0 (top feed of R16 pos 0) must contain the played R32 match,
    // NOT be marked as a bye.
    const r32top = bracket.find(n => n.round === 'R32' && n.positionInRound === 0)!
    expect(r32top.match?.id).toBe('r32-played')
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

describe('stable ordering — orphan matches without draw_position', () => {
  // Reproducer: Buenos Aires P1 2026 had 9 R64 matches ingested via OOP
  // before the Crionet bracket published, all with draw_position=null
  // and widget_id_composite=null. Without a deterministic tiebreaker the
  // bracket-cell assignment varied across reloads.
  it('places the same orphan match in the same R32 cell on repeated buildBracket calls', () => {
    const mk = (id: string) =>
      fakeMatch({
        id,
        round: 'R32',
        // No draw_position, no widget_id_composite, no external_id.
      })
    // Pass the matches in random order each time — sort must rescue us.
    const order1: Match[] = [mk('zz'), mk('aa'), mk('mm'), mk('bb')]
    const order2: Match[] = [mk('aa'), mk('bb'), mk('mm'), mk('zz')]
    const order3: Match[] = [mk('mm'), mk('zz'), mk('bb'), mk('aa')]

    const b1 = buildBracket(order1, 32)
    const b2 = buildBracket(order2, 32)
    const b3 = buildBracket(order3, 32)

    // Same R32 cell ordering across all three runs — sorted by id ASC.
    const r32cells = (bracket: typeof b1) =>
      bracket.filter(n => n.round === 'R32').map(n => n.match?.id ?? null)

    expect(r32cells(b1).slice(0, 4)).toEqual(['aa', 'bb', 'mm', 'zz'])
    expect(r32cells(b1)).toEqual(r32cells(b2))
    expect(r32cells(b2)).toEqual(r32cells(b3))
  })
})

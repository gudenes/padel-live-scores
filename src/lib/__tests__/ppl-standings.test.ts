import { describe, it, expect } from 'vitest'
import { computeRecords, computePlayerRecords, type TieInput } from '../ppl-standings'

const tie = (id: string, home: string, away: string, winners: Array<1 | 2 | null>): TieInput =>
  ({ tieId: id, homeSeasonId: home, awaySeasonId: away, matches: winners.map((w) => ({ winnerPair: w })) })

describe('computeRecords', () => {
  it('awards the tie to whoever took more courts', () => {
    const r = computeRecords([tie('t1', 'A', 'B', [1, 1])])
    expect(r.get('A')).toMatchObject({ tiesPlayed: 1, tiesWon: 1, courtsWon: 2, courtsLost: 0 })
    expect(r.get('B')).toMatchObject({ tiesPlayed: 1, tiesWon: 0, courtsWon: 0, courtsLost: 2 })
  })

  it('gives a split tie to NEITHER side, but counts it played for both', () => {
    // The common shape: a franchise wins the men's match and loses the
    // women's. The league separates these with its own points system, which
    // this module deliberately does not model.
    const r = computeRecords([tie('t1', 'A', 'B', [1, 2])])
    expect(r.get('A')).toMatchObject({ tiesPlayed: 1, tiesWon: 0, courtsWon: 1, courtsLost: 1 })
    expect(r.get('B')).toMatchObject({ tiesPlayed: 1, tiesWon: 0, courtsWon: 1, courtsLost: 1 })
  })

  it('handles a one-court tie, which is how podium finals are shaped', () => {
    const r = computeRecords([tie('t1', 'A', 'B', [2])])
    expect(r.get('B')).toMatchObject({ tiesPlayed: 1, tiesWon: 1, courtsWon: 1, courtsLost: 0 })
  })

  it('does NOT count a tie whose matches are all undecided', () => {
    // A listed but unplayed fixture must not inflate anyone's played column.
    const r = computeRecords([tie('t1', 'A', 'B', [null, null])])
    expect(r.size).toBe(0)
  })

  it('counts only the decided courts in a partly-played tie', () => {
    const r = computeRecords([tie('t1', 'A', 'B', [1, null])])
    expect(r.get('A')).toMatchObject({ tiesPlayed: 1, tiesWon: 1, courtsWon: 1, courtsLost: 0 })
  })

  it('accumulates across ties', () => {
    const r = computeRecords([
      tie('t1', 'A', 'B', [1, 1]),
      tie('t2', 'C', 'A', [1, 2]),
      tie('t3', 'A', 'C', [2, 2]),
    ])
    // A: won t1 2-0, split t2 1-1, lost t3 0-2 -> 3 played, 1 won, 3 courts, 3 lost
    expect(r.get('A')).toMatchObject({ tiesPlayed: 3, tiesWon: 1, courtsWon: 3, courtsLost: 3 })
  })

  it('re-decides each tie within a gender scope, not filters the overall table', () => {
    // A tie split 1-1 overall is a clean WIN in one scope and a clean LOSS in
    // the other. This is the whole reason the league keeps three tables.
    const t: TieInput = {
      tieId: 't1', homeSeasonId: 'A', awaySeasonId: 'B',
      matches: [{ winnerPair: 1, category: 'men' }, { winnerPair: 2, category: 'women' }],
    }
    expect(computeRecords([t], 'all').get('A')).toMatchObject({ tiesWon: 0, courtsWon: 1, courtsLost: 1 })
    expect(computeRecords([t], 'men').get('A')).toMatchObject({ tiesPlayed: 1, tiesWon: 1, courtsWon: 1, courtsLost: 0 })
    expect(computeRecords([t], 'women').get('A')).toMatchObject({ tiesPlayed: 1, tiesWon: 0, courtsWon: 0, courtsLost: 1 })
  })

  it('drops a tie entirely from a scope it has no court in', () => {
    // PPL II is the real case: each club fields ONE pairing, so a men's-only
    // tie must not appear in the women's table with a 0-0 played record.
    const t: TieInput = {
      tieId: 't1', homeSeasonId: 'A', awaySeasonId: 'B',
      matches: [{ winnerPair: 1, category: 'men' }],
    }
    expect(computeRecords([t], 'women').size).toBe(0)
    expect(computeRecords([t], 'men').size).toBe(2)
  })

  it('defaults to the overall scope when none is given', () => {
    const t: TieInput = {
      tieId: 't1', homeSeasonId: 'A', awaySeasonId: 'B',
      matches: [{ winnerPair: 1, category: 'men' }, { winnerPair: 1, category: 'women' }],
    }
    expect(computeRecords([t])).toEqual(computeRecords([t], 'all'))
  })

  it('never writes league points or a ranking', () => {
    // Those are awarded by finishing position upstream and cannot be derived.
    // A fabricated value would be indistinguishable from the official one.
    const r = computeRecords([tie('t1', 'A', 'B', [1, 1])])!
    expect(Object.keys(r.get('A')!).sort())
      .toEqual(['courtsLost', 'courtsWon', 'seasonId', 'tiesPlayed', 'tiesWon'])
  })
})

describe('computePlayerRecords', () => {
  it('collects the distinct players who took the court', () => {
    const r = computePlayerRecords([
      { seasonId: 'S', playerIds: ['p1', 'p2'], won: true },
      { seasonId: 'S', playerIds: ['p2', 'p3'], won: false },
    ])
    expect([...r.get('S')!.keys()].sort()).toEqual(['p1', 'p2', 'p3'])
  })

  it('counts each appearance, and wins and losses separately', () => {
    const r = computePlayerRecords([
      { seasonId: 'S', playerIds: ['p1'], won: true },
      { seasonId: 'S', playerIds: ['p1'], won: true },
      { seasonId: 'S', playerIds: ['p1'], won: false },
    ])
    expect(r.get('S')!.get('p1')).toEqual({ gamesPlayed: 3, wins: 2, losses: 1 })
  })

  it('counts an undecided match as played but neither won nor lost', () => {
    // wins + losses must be allowed to fall short of gamesPlayed. Forcing them
    // to balance would mean charging a loss for a match nobody has won yet.
    const r = computePlayerRecords([{ seasonId: 'S', playerIds: ['p1'], won: null }])
    expect(r.get('S')!.get('p1')).toEqual({ gamesPlayed: 1, wins: 0, losses: 0 })
  })

  it('keeps a player who appears in BOTH divisions apart', () => {
    // The same person can be drafted to the same franchise in both divisions.
    // A flat per-player tally would merge the two and double their record.
    const r = computePlayerRecords([
      { seasonId: 'dc-ppl', playerIds: ['a'], won: true },
      { seasonId: 'dc-ppl-ii', playerIds: ['a'], won: false },
    ])
    expect(r.get('dc-ppl')!.get('a')).toEqual({ gamesPlayed: 1, wins: 1, losses: 0 })
    expect(r.get('dc-ppl-ii')!.get('a')).toEqual({ gamesPlayed: 1, wins: 0, losses: 1 })
  })

  it('keeps divisions apart, which the upstream squad block cannot', () => {
    // The same franchise appears in both; upstream publishes one identical
    // squad list for both, so only participation can separate them.
    const r = computePlayerRecords([
      { seasonId: 'dc-ppl', playerIds: ['a', 'b', 'c', 'd'], won: true },
      { seasonId: 'dc-ppl-ii', playerIds: ['x', 'y'], won: true },
    ])
    expect(r.get('dc-ppl')!.size).toBe(4)
    expect(r.get('dc-ppl-ii')!.size).toBe(2)
  })

  it('returns nothing for a season with no participation', () => {
    expect(computePlayerRecords([]).size).toBe(0)
  })
})

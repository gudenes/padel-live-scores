import { describe, it, expect } from 'vitest'
import {
  computeRecord,
  computeUsualCourt,
  collectPartners,
  type AmateurGame,
} from '../amateur-derive'

/** Gustavo's real 25/26 record: 2-5 across 7 games, 6 of them on a 3-point court. */
const GAMES: AmateurGame[] = [
  { fixtureCode: 'J2',   worth: 3, result: 'L', sets: 2, exact: false, complete: true,  partnerIds: ['p-albert', 'p-jonatan', 'p-william'] },
  { fixtureCode: 'J3',   worth: 2, result: 'W', sets: 3, exact: true,  complete: true,  partnerIds: ['p-gerard'] },
  { fixtureCode: 'J4',   worth: 3, result: 'L', sets: 3, exact: true,  complete: true,  partnerIds: ['p-sergio'] },
  { fixtureCode: 'J7',   worth: 3, result: 'W', sets: 3, exact: false, complete: true,  partnerIds: ['p-albert', 'p-david', 'p-gerard'] },
  { fixtureCode: 'J9',   worth: 3, result: 'L', sets: 2, exact: false, complete: true,  partnerIds: ['p-eric', 'p-gerard', 'p-valentin'] },
  { fixtureCode: 'J10',  worth: 3, result: 'L', sets: 2, exact: false, complete: false, partnerIds: [] },
  { fixtureCode: 'POFF', worth: 3, result: 'L', sets: 2, exact: false, complete: false, partnerIds: ['p-albert', 'p-david'] },
]

describe('computeRecord', () => {
  it('counts every game, including the partial ones', () => {
    expect(computeRecord(GAMES)).toEqual({ played: 7, wins: 2, losses: 5, winRate: 29 })
  })

  it('returns a zero record with a null win rate when there are no games', () => {
    expect(computeRecord([])).toEqual({ played: 0, wins: 0, losses: 0, winRate: null })
  })
})

describe('computeUsualCourt', () => {
  it('reports the dominant court block and how often it was used', () => {
    expect(computeUsualCourt(GAMES)).toEqual({ worth: 3, count: 6, total: 7 })
  })

  it('breaks a tie in favour of the higher-value court', () => {
    const tied: AmateurGame[] = [
      { fixtureCode: 'J1', worth: 3, result: 'W', sets: 2, exact: true, complete: true, partnerIds: [] },
      { fixtureCode: 'J2', worth: 2, result: 'L', sets: 2, exact: true, complete: true, partnerIds: [] },
    ]
    expect(computeUsualCourt(tied)).toEqual({ worth: 3, count: 1, total: 2 })
  })

  it('returns null when there are no games', () => {
    expect(computeUsualCourt([])).toBeNull()
  })
})

describe('collectPartners', () => {
  it('separates confirmed partners from probable ones', () => {
    const { confirmed, probable } = collectPartners(GAMES)
    expect(confirmed).toEqual(['p-gerard', 'p-sergio'])
    expect(probable).toEqual(
      expect.arrayContaining(['p-albert', 'p-david', 'p-eric', 'p-jonatan', 'p-valentin', 'p-william']),
    )
  })

  it('never lists the same player as both confirmed and probable', () => {
    const { confirmed, probable } = collectPartners(GAMES)
    // p-gerard appears in an ambiguous J7/J9 slot too, but a confirmed
    // pairing in J3 outranks it — a known partner must not be downgraded.
    expect(probable).not.toContain('p-gerard')
  })
})

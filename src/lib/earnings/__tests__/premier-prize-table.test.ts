import { describe, it, expect } from 'vitest'
import { lookupPremierPrize, RULEBOOK_VERSION } from '../premier-prize-table'

describe('lookupPremierPrize — men spot checks (2026 rulebook)', () => {
  it('Major M winner = €48,700', () => {
    expect(lookupPremierPrize({ tier: 'major_i', category: 'men', round: 'F', isWinner: true })).toBe(48_700)
  })
  it('Major M finalist = €24,350', () => {
    expect(lookupPremierPrize({ tier: 'major_i', category: 'men', round: 'F', isWinner: false })).toBe(24_350)
  })
  it('P1 M winner = €26,270', () => {
    expect(lookupPremierPrize({ tier: 'p1', category: 'men', round: 'F', isWinner: true })).toBe(26_270)
  })
  it('P1 M SF loser = €7,340', () => {
    expect(lookupPremierPrize({ tier: 'p1', category: 'men', round: 'SF', isWinner: false })).toBe(7_340)
  })
  it('P2 M winner = €13,960', () => {
    expect(lookupPremierPrize({ tier: 'p2', category: 'men', round: 'F', isWinner: true })).toBe(13_960)
  })
  it('P2 M R32 = €1,305', () => {
    expect(lookupPremierPrize({ tier: 'p2', category: 'men', round: 'R32', isWinner: false })).toBe(1_305)
  })
  it('Men have no Major II', () => {
    expect(lookupPremierPrize({ tier: 'major_ii', category: 'men', round: 'F', isWinner: true })).toBeNull()
  })
})

describe('lookupPremierPrize — women spot checks (2026 rulebook)', () => {
  it('Major I W winner = €48,700 (equal to men at this tier)', () => {
    expect(lookupPremierPrize({ tier: 'major_i', category: 'women', round: 'F', isWinner: true })).toBe(48_700)
  })
  it('Major II W winner = €24,750', () => {
    expect(lookupPremierPrize({ tier: 'major_ii', category: 'women', round: 'F', isWinner: true })).toBe(24_750)
  })
  it('P1 W winner = €17,000 (NOT equal to men)', () => {
    expect(lookupPremierPrize({ tier: 'p1', category: 'women', round: 'F', isWinner: true })).toBe(17_000)
  })
  it('P2 W winner = €11,000 (NOT equal to men)', () => {
    expect(lookupPremierPrize({ tier: 'p2', category: 'women', round: 'F', isWinner: true })).toBe(11_000)
  })
  it('P1 W has Q1 stage = €160', () => {
    expect(lookupPremierPrize({ tier: 'p1', category: 'women', round: 'Q1', isWinner: false })).toBe(160)
  })
})

describe('lookupPremierPrize — null cases', () => {
  it('returns null for tiers a category does not pay (Major II men)', () => {
    expect(lookupPremierPrize({ tier: 'major_ii', category: 'men', round: 'SF', isWinner: false })).toBeNull()
  })
  it('returns null for unpaid Q rounds (P1 men Q1)', () => {
    expect(lookupPremierPrize({ tier: 'p1', category: 'men', round: 'Q1', isWinner: false })).toBeNull()
  })
  it('returns null for R64 in P2 (P2 has no R64 stage)', () => {
    expect(lookupPremierPrize({ tier: 'p2', category: 'men', round: 'R64', isWinner: false })).toBeNull()
  })
})

describe('Brussels P2 2026 reconstruction (the hero verification)', () => {
  // Published total = €264,534. Decomposes into men + women per the rulebook.
  // Each round counts: 1 winner pair (2 players), 1 finalist pair (2),
  // 2 SF pairs (4), 4 QF pairs (8), 8 R16 pairs (16), 16 R32 pairs (32 — but
  // P2 men's draw is 12 R32 pairs = 24 players, same for women per the rulebook
  // table footers, with 4 Last-Q pairs (8 players)).
  //
  // From the men's rulebook table footers (the "Players" column):
  //   Major: 32 R32 / 16 R16 / 8 QF / 4 SF / 2 F-Loser / 2 F-Winner / 8 Last-Q
  //   P1:    32 R32 / 16 R16 / ...
  //   P2:    24 R32 / 16 R16 / 8 QF / 4 SF / 2 F-L / 2 F-W / 8 Last-Q
  // (R64 omitted in P2.)
  //
  // For Brussels P2 specifically the ACTUAL draw used 24 R32 + 8 Last-Q so we
  // pin to those counts here. PR 2B's backfill will count actual matches per
  // round to derive these dynamically — this test is just the algebra check.
  const reconstruct = (cat: 'men' | 'women') => {
    let sum = 0
    sum += 2 * (lookupPremierPrize({ tier: 'p2', category: cat, round: 'F',  isWinner: true })  ?? 0)
    sum += 2 * (lookupPremierPrize({ tier: 'p2', category: cat, round: 'F',  isWinner: false }) ?? 0)
    sum += 4 * (lookupPremierPrize({ tier: 'p2', category: cat, round: 'SF', isWinner: false }) ?? 0)
    sum += 8 * (lookupPremierPrize({ tier: 'p2', category: cat, round: 'QF', isWinner: false }) ?? 0)
    sum += 16 * (lookupPremierPrize({ tier: 'p2', category: cat, round: 'R16', isWinner: false }) ?? 0)
    sum += 24 * (lookupPremierPrize({ tier: 'p2', category: cat, round: 'R32', isWinner: false }) ?? 0)
    sum += 8 * (lookupPremierPrize({ tier: 'p2', category: cat, round: 'Q3', isWinner: false }) ?? 0)
    return sum
  }

  it('men P2 reconstructs to €154,534', () => {
    expect(reconstruct('men')).toBe(154_534)
  })

  it('women P2 reconstructs to €110,000 (within €100)', () => {
    // Women's P2 draw structure: 16 R32 (not 24), per the women's rulebook
    // table footer. Recompute with the actual women's structure:
    let sum = 0
    sum += 2 * (lookupPremierPrize({ tier: 'p2', category: 'women', round: 'F',  isWinner: true })  ?? 0)
    sum += 2 * (lookupPremierPrize({ tier: 'p2', category: 'women', round: 'F',  isWinner: false }) ?? 0)
    sum += 4 * (lookupPremierPrize({ tier: 'p2', category: 'women', round: 'SF', isWinner: false }) ?? 0)
    sum += 8 * (lookupPremierPrize({ tier: 'p2', category: 'women', round: 'QF', isWinner: false }) ?? 0)
    sum += 16 * (lookupPremierPrize({ tier: 'p2', category: 'women', round: 'R16', isWinner: false }) ?? 0)
    sum += 16 * (lookupPremierPrize({ tier: 'p2', category: 'women', round: 'R32', isWinner: false }) ?? 0)
    sum += 8 * (lookupPremierPrize({ tier: 'p2', category: 'women', round: 'Q3', isWinner: false }) ?? 0)
    sum += 16 * (lookupPremierPrize({ tier: 'p2', category: 'women', round: 'Q1', isWinner: false }) ?? 0)
    expect(Math.abs(sum - 110_000)).toBeLessThanOrEqual(100)
  })
})

describe('rulebook version is exposed', () => {
  it('exports the version stamp', () => {
    expect(RULEBOOK_VERSION).toBe('2026')
  })
})

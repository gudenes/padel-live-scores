import { describe, it, expect } from 'vitest'
import { bagelLineCopy, lineFor, planBagelLineMarkets, PLAY_LOCALES } from '../bagel-line.js'

const PARAMS = {
  lines: {
    p1: { men: { line: 4, seedProb: 0.421 }, women: { line: 4, seedProb: 0.389 } },
    p2: { men: { line: 2, seedProb: 0.412 }, women: { line: 3, seedProb: 0.353 } },
  },
}

describe('lineFor', () => {
  it('reads the line for a level × category, case-insensitive on level', () => {
    expect(lineFor(PARAMS, 'P1', 'women')).toEqual({ line: 4, seedProb: 0.389 })
  })
  it('returns null for a level with no calibrated line (no market, not a guessed one)', () => {
    expect(lineFor(PARAMS, 'major', 'men')).toBeNull()
    expect(lineFor(PARAMS, null, 'men')).toBeNull()
  })
  it('rejects a malformed entry rather than seeding at NaN', () => {
    expect(lineFor({ lines: { p1: { men: { line: 0, seedProb: 0.4 } } } }, 'p1', 'men')).toBeNull()
    expect(lineFor({ lines: { p1: { men: { line: 3, seedProb: 1 } } } }, 'p1', 'men')).toBeNull()
    expect(lineFor({ lines: { p1: { men: { line: 2.5, seedProb: 0.4 } } } }, 'p1', 'men')).toBeNull()
  })
})

const NOW = new Date('2026-10-05T08:00:00Z')
const T = { id: 't1', level: 'p2', name: 'CUPRA ROTTERDAM PREMIER PADEL P2' }
const row = (id: string, category: string, round: string | null, status: string, at: string | null) =>
  ({ id, tournament_id: 't1', category, round_canonical: round, status, scheduled_at: at })

describe('planBagelLineMarkets', () => {
  it('plans one market per draw, bound to the earliest main-draw match', () => {
    const plans = planBagelLineMarkets(PARAMS, [T], [
      row('m2', 'men', 'R32', 'scheduled', '2026-10-06T12:00:00Z'),
      row('m1', 'men', 'R32', 'scheduled', '2026-10-06T10:00:00Z'),
      row('w1', 'women', 'R32', 'scheduled', '2026-10-06T09:00:00Z'),
      row('q1', 'men', 'Q1', 'finished', '2026-10-05T07:00:00Z'),
    ], NOW)
    expect(plans).toHaveLength(2)
    const men = plans.find((p) => p.category === 'men')!
    expect(men).toMatchObject({ tournamentId: 't1', boundMatchId: 'm1', line: 2, seedProb: 0.412 })
    expect(men.locksAt.toISOString()).toBe('2026-10-06T10:00:00.000Z')
  })

  it('skips a draw once any main-draw match has started — the count would already be partly known', () => {
    const plans = planBagelLineMarkets(PARAMS, [T], [
      row('m1', 'men', 'R32', 'finished', '2026-10-04T10:00:00Z'),
      row('m2', 'men', 'R16', 'scheduled', '2026-10-06T10:00:00Z'),
    ], NOW)
    expect(plans).toHaveLength(0)
  })

  it('skips a draw with no timed main-draw match (no lock time → no market)', () => {
    expect(planBagelLineMarkets(PARAMS, [T], [row('m1', 'men', 'R32', 'scheduled', null)], NOW)).toHaveLength(0)
  })

  it('skips a draw whose first match is already in the past but still marked scheduled', () => {
    expect(planBagelLineMarkets(PARAMS, [T], [row('m1', 'men', 'R32', 'scheduled', '2026-10-05T07:00:00Z')], NOW)).toHaveLength(0)
  })

  it('skips a level with no calibrated line', () => {
    const plans = planBagelLineMarkets(PARAMS, [{ ...T, level: 'fip_platinum' }], [
      row('m1', 'men', 'R32', 'scheduled', '2026-10-06T10:00:00Z'),
    ], NOW)
    expect(plans).toHaveLength(0)
  })

  it('ignores rows with an unknown category', () => {
    expect(planBagelLineMarkets(PARAMS, [T], [row('x', 'mixed', 'R32', 'scheduled', '2026-10-06T10:00:00Z')], NOW)).toHaveLength(0)
  })
})

describe('bagelLineCopy', () => {
  const copy = bagelLineCopy({ tournamentName: 'Rotterdam P2', category: 'women', line: 3 })

  it('writes the question and rules in every app locale', () => {
    for (const l of PLAY_LOCALES) {
      expect(copy.question[l], `question ${l}`).toBeTruthy()
      expect(copy.rules[l], `rules ${l}`).toBeTruthy()
      expect(copy.question[l]).toContain('Rotterdam P2')
      expect(copy.question[l]).toContain('3')
    }
  })

  it('names the right draw in each language', () => {
    expect(copy.question.en).toContain("women's")
    expect(copy.question.es).toContain('femenino')
    expect(copy.question.pt).toContain('feminino')
    expect(copy.question.it).toContain('femminile')
    expect(copy.question.fr).toContain('féminin')
    const men = bagelLineCopy({ tournamentName: 'X', category: 'men', line: 2 })
    expect(men.question.en).toContain("men's")
    expect(men.question.es).toContain('masculino')
  })

  it('leaves no unreplaced placeholder', () => {
    for (const l of PLAY_LOCALES) {
      expect(copy.question[l]).not.toMatch(/\{\w+\}/)
      expect(copy.rules[l]).not.toMatch(/\{\w+\}/)
    }
  })
})

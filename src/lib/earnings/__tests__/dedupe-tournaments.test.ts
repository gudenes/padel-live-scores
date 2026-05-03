import { describe, it, expect } from 'vitest'
import { normalizeName, groupKey, scoreRow, dedupeTournaments, type DedupRow } from '../dedupe-tournaments'

describe('normalizeName', () => {
  it('strips noise tokens and keeps identity tokens', () => {
    expect(normalizeName('Lotto Brussels Premier Padel P2 Presented By Belfius'))
      .toBe('brussels|p2')
  })
  it('matches Brussels P2 2026 to the same key', () => {
    expect(normalizeName('Brussels P2 2026')).toBe('brussels|p2')
  })
  it('strips diacritics', () => {
    expect(normalizeName('Málaga P1')).toBe('malaga|p1')
  })
  it('drops pure-numeric tokens', () => {
    expect(normalizeName('FIP Silver Mendoza 2026')).toBe('fip|mendoza|silver')
  })
  it('handles single-word names', () => {
    expect(normalizeName('Acapulco')).toBe('acapulco')
  })
})

describe('groupKey', () => {
  it('combines normalized name + year', () => {
    const row: DedupRow = {
      id: 't-1', name: 'Brussels P2 2026', starts_at: '2026-04-20',
      prize_money_eur: null, prize_breakdown: null, fip_id: null, padelapi_id: null,
    }
    expect(groupKey(row)).toBe('brussels|p2::2026')
  })
  it('uses "unknown" year for null starts_at', () => {
    const row: DedupRow = {
      id: 't-2', name: 'X', starts_at: null,
      prize_money_eur: null, prize_breakdown: null, fip_id: null, padelapi_id: null,
    }
    expect(groupKey(row)).toBe('x::unknown')
  })
  it('separates same name in different years', () => {
    const r2024: DedupRow = {
      id: 't-3', name: 'Brussels P2', starts_at: '2024-04-20',
      prize_money_eur: null, prize_breakdown: null, fip_id: null, padelapi_id: null,
    }
    const r2026: DedupRow = {
      id: 't-4', name: 'Brussels P2', starts_at: '2026-04-20',
      prize_money_eur: null, prize_breakdown: null, fip_id: null, padelapi_id: null,
    }
    expect(groupKey(r2024)).not.toBe(groupKey(r2026))
  })
})

describe('scoreRow', () => {
  const base: DedupRow = {
    id: 't-1', name: 'X', starts_at: '2026-01-01',
    prize_money_eur: null, prize_breakdown: null, fip_id: null, padelapi_id: null,
  }
  it('scores 0 for an empty row', () => {
    expect(scoreRow(base)).toBe(0)
  })
  it('prize_money_eur is hard priority (1000)', () => {
    expect(scoreRow({ ...base, prize_money_eur: 5000 })).toBe(1000)
  })
  it('prize_breakdown adds 100', () => {
    expect(scoreRow({ ...base, prize_breakdown: { winner: 1000 } })).toBe(100)
  })
  it('fip_id adds 10, padelapi adds 1', () => {
    expect(scoreRow({ ...base, fip_id: 'x', padelapi_id: 'y' })).toBe(11)
  })
  it('full row scores 1111', () => {
    expect(scoreRow({
      ...base,
      prize_money_eur: 1, prize_breakdown: {}, fip_id: 'a', padelapi_id: 'b',
    })).toBe(1111)
  })
})

describe('dedupeTournaments — Brussels P2 scenario (3 rows → 1)', () => {
  // From real DB inspection during brainstorm:
  //   Row A: "Lotto Brussels Premier Padel P2 Presented By Belfius" — no prize data
  //   Row B: "Brussels P2"                                          — prize €252,250 (older snapshot)
  //   Row C: "Brussels P2 2026"                                     — prize €264,534 (current)
  // All 3 normalise to the same group key. Survivor should be C (highest prize).
  const rowA: DedupRow = {
    id: 'tA', name: 'Lotto Brussels Premier Padel P2 Presented By Belfius',
    starts_at: '2026-04-20',
    prize_money_eur: null, prize_breakdown: null, fip_id: null, padelapi_id: null,
  }
  const rowB: DedupRow = {
    id: 'tB', name: 'Brussels P2',
    starts_at: '2026-04-20',
    prize_money_eur: 252_250, prize_breakdown: null, fip_id: 'fip-bru', padelapi_id: null,
  }
  const rowC: DedupRow = {
    id: 'tC', name: 'Brussels P2 2026',
    starts_at: '2026-04-20',
    prize_money_eur: 264_534, prize_breakdown: { winner: 5000 }, fip_id: 'fip-bru-2', padelapi_id: '999',
  }

  it('collapses all 3 to a single survivor', () => {
    const r = dedupeTournaments([rowA, rowB, rowC])
    expect(r).toHaveLength(1)
  })

  it('picks the most-complete row (C wins)', () => {
    const r = dedupeTournaments([rowA, rowB, rowC])
    expect(r[0].id).toBe('tC')
  })

  it('order-independent', () => {
    const r1 = dedupeTournaments([rowA, rowB, rowC])
    const r2 = dedupeTournaments([rowC, rowA, rowB])
    expect(r1[0].id).toBe(r2[0].id)
  })
})

describe('dedupeTournaments — leaves unique rows alone', () => {
  it('different events stay separate', () => {
    const a: DedupRow = {
      id: 'a', name: 'Brussels P2', starts_at: '2026-04-20',
      prize_money_eur: 100, prize_breakdown: null, fip_id: null, padelapi_id: null,
    }
    const b: DedupRow = {
      id: 'b', name: 'Madrid P1', starts_at: '2026-05-15',
      prize_money_eur: 200, prize_breakdown: null, fip_id: null, padelapi_id: null,
    }
    expect(dedupeTournaments([a, b])).toHaveLength(2)
  })
})

describe('dedupeTournaments — score tie-break by id', () => {
  it('lexicographically smallest id wins on a tie', () => {
    const z: DedupRow = {
      id: 'z', name: 'X', starts_at: '2026-01-01',
      prize_money_eur: null, prize_breakdown: null, fip_id: null, padelapi_id: null,
    }
    const a: DedupRow = {
      id: 'a', name: 'X', starts_at: '2026-01-01',
      prize_money_eur: null, prize_breakdown: null, fip_id: null, padelapi_id: null,
    }
    const r = dedupeTournaments([z, a])
    expect(r).toHaveLength(1)
    expect(r[0].id).toBe('a')
  })
})

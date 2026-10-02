import { describe, it, expect } from 'vitest'
import {
  pairKey,
  generateMergeSuggestions,
  generatePlayerLinkSuggestions,
  type SuggestionCoach,
} from '../../lib/coach-suggestions.js'

const c = (id: string, normalized_name: string, extra: Partial<SuggestionCoach> = {}): SuggestionCoach => ({
  id, normalized_name, status: 'unreviewed', player_id: null, ...extra,
})

describe('pairKey', () => {
  it('orders ids', () => {
    expect(pairKey('b', 'a')).toBe('a|b')
    expect(pairKey('a', 'b')).toBe('a|b')
  })
})

describe('generateMergeSuggestions', () => {
  it('suggests subset matches with score 1', () => {
    const out = generateMergeSuggestions([c('1', 'juan cabrera'), c('2', 'juan cabrera gomez')], new Set())
    expect(out).toEqual([{ coach_a: '1', coach_b: '2', score: 1, reason: 'subset' }])
  })
  it('suggests one-letter typos', () => {
    const out = generateMergeSuggestions([c('1', 'pablo crosseti'), c('2', 'pablo crossetti')], new Set())
    expect(out).toHaveLength(1)
    expect(out[0].reason).toBe('typo')
  })
  it('surfaces Juan Gutierrez / Juan Jose Gutierrez only as a suggestion (never a merge)', () => {
    const out = generateMergeSuggestions([c('1', 'juan gutierrez'), c('2', 'juan jose gutierrez')], new Set())
    expect(out).toEqual([{ coach_a: '1', coach_b: '2', score: 1, reason: 'subset' }])
  })
  it('compares every absorbed spelling (Crosetti/Crossetti/Crosseti)', () => {
    const out = generateMergeSuggestions(
      [c('1', 'pablo crosetti', { names: ['pablo crosetti', 'pablo crossetti'] }), c('2', 'pablo crosseti')],
      new Set(),
    )
    expect(out).toHaveLength(1)
    expect(out[0].reason).toBe('typo')
  })
  it('ignores single-token absorbed spellings', () => {
    const out = generateMergeSuggestions(
      [c('1', 'juan restivo', { names: ['manuel'] }), c('2', 'manuel zamora aguilar'), c('3', 'manuel perez')],
      new Set(),
    )
    expect(out).toEqual([])
  })
  it('never pairs single-token names', () => {
    const out = generateMergeSuggestions(
      [c('1', 'manual'), c('2', 'manuel zamora aguilar'), c('3', 'juan'), c('4', 'juan restivo')],
      new Set(),
    )
    expect(out).toEqual([])
  })
  it('skips pairs that already have a row (pending, rejected or merged)', () => {
    const out = generateMergeSuggestions([c('1', 'juan gutierrez'), c('2', 'juan jose gutierrez')], new Set(['1|2']))
    expect(out).toEqual([])
  })
  it('skips junk and merged coaches', () => {
    const out = generateMergeSuggestions(
      [c('1', 'juan cabrera', { status: 'junk' }), c('2', 'juan cabrera gomez'), c('3', 'juan cabrera gome', { status: 'merged' })],
      new Set(),
    )
    expect(out).toEqual([])
  })
  it('does not suggest a 1-char typo on a short (<4 char) token', () => {
    const out = generateMergeSuggestions([c('1', 'ana lopez'), c('2', 'ena lopez')], new Set())
    expect(out).toEqual([])
  })
})

describe('generatePlayerLinkSuggestions', () => {
  const players = [
    { id: 'p1', normalized_name: 'gaby reca' },
    { id: 'p2', normalized_name: 'juan alday' },
  ]
  it('suggests an exact normalized-name match', () => {
    const out = generatePlayerLinkSuggestions([c('c1', 'gaby reca')], players, new Set(), new Set())
    expect(out).toEqual([{ coach_id: 'c1', player_id: 'p1' }])
  })
  it('does not suggest when the coach is already linked, junk, or single-token', () => {
    const out = generatePlayerLinkSuggestions(
      [c('c1', 'gaby reca', { player_id: 'p1' }), c('c2', 'juan alday', { status: 'junk' }), c('c3', 'reca')],
      players, new Set(), new Set(),
    )
    expect(out).toEqual([])
  })
  it('skips existing suggestion rows and players already linked to another coach', () => {
    const out = generatePlayerLinkSuggestions(
      [c('c1', 'gaby reca'), c('c2', 'juan alday')],
      players, new Set(['c1|p1']), new Set(['p2']),
    )
    expect(out).toEqual([])
  })
})

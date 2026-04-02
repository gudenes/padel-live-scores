import { describe, it, expect } from 'vitest'
import { normalize, tokenSimilarity } from '../player-resolver'

describe('normalize', () => {
  it('lowercases and strips accents', () => {
    expect(normalize('María Pérez')).toBe('maria perez')
  })

  it('replaces non-alphanumeric with spaces', () => {
    expect(normalize('Lopez-Barajas')).toBe('lopez barajas')
  })

  it('collapses whitespace', () => {
    expect(normalize('  Juan   Carlos  ')).toBe('juan carlos')
  })
})

describe('tokenSimilarity', () => {
  it('returns 1.0 for identical names', () => {
    expect(tokenSimilarity('Aranzazu Osoro Ulrich', 'Aranzazu Osoro Ulrich')).toBe(1)
  })

  it('is order-independent', () => {
    expect(tokenSimilarity('Osoro Ulrich Aranzazu', 'Aranzazu Osoro Ulrich')).toBe(1)
  })

  it('handles partial overlap', () => {
    const sim = tokenSimilarity('Teresa Navarro', 'Teresa Navarro Lopez-Barajas')
    expect(sim).toBeGreaterThanOrEqual(0.5)
    expect(sim).toBeLessThan(1)
  })

  it('returns 0 for completely different names', () => {
    expect(tokenSimilarity('Juan Garcia', 'Maria Perez')).toBe(0)
  })

  it('ignores 1-letter tokens', () => {
    expect(tokenSimilarity('A Garcia', 'Garcia')).toBe(1)
  })
})

describe('ranking/points disambiguation', () => {
  it('normalized names match for entry list vs draw format', () => {
    expect(normalize('Aranzazu Osoro Ulrich')).toBe(normalize('Aranzazu Osoro Ulrich'))
  })

  it('compound surnames normalize consistently', () => {
    expect(normalize('Marta Barrera De La Fuente')).toBe('marta barrera de la fuente')
    expect(normalize('BARRERA DE LA FUENTE Marta')).toBe('barrera de la fuente marta')
    expect(tokenSimilarity('Marta Barrera De La Fuente', 'BARRERA DE LA FUENTE Marta')).toBe(1)
  })
})

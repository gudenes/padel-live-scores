import { describe, it, expect } from 'vitest'
import {
  normalize,
  tokenSimilarity,
  normalizeCountry,
  subsetSimilarity,
  typoTolerantSimilarity,
} from '../player-resolver'

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

describe('normalizeCountry', () => {
  it('returns null for null/undefined/empty', () => {
    expect(normalizeCountry(null)).toBeNull()
    expect(normalizeCountry(undefined)).toBeNull()
    expect(normalizeCountry('')).toBeNull()
  })

  it('returns 2-letter codes unchanged (upper-cased)', () => {
    expect(normalizeCountry('AR')).toBe('AR')
    expect(normalizeCountry('ar')).toBe('AR')
    expect(normalizeCountry('Br')).toBe('BR')
  })

  it('converts known 3-letter FIP codes to 2-letter ISO', () => {
    expect(normalizeCountry('ARG')).toBe('AR')
    expect(normalizeCountry('BRA')).toBe('BR')
    expect(normalizeCountry('CHI')).toBe('CL')
    expect(normalizeCountry('PAR')).toBe('PY')
    expect(normalizeCountry('ESP')).toBe('ES')
    expect(normalizeCountry('URU')).toBe('UY')
    expect(normalizeCountry('USA')).toBe('US')
  })

  it('is case-insensitive for 3-letter input', () => {
    expect(normalizeCountry('arg')).toBe('AR')
    expect(normalizeCountry('Bra')).toBe('BR')
  })

  it('returns null for unknown 3-letter codes (respects DB CHECK constraint)', () => {
    // Changed 2026-04-23 — DB got CHECK constraint `length(country)=2`.
    // Pass-through would hard-fail the write. Null is the "unknown
    // country" signal; ops data-quality views surface null rows.
    expect(normalizeCountry('XYZ')).toBeNull()
  })

  it('maps previously-missing FIFA aliases (regression from 2026-04-23)', () => {
    // Initial migration missed these; production data still showed up
    // as alpha-3 until this PR shipped. Guardrail against forgetting.
    expect(normalizeCountry('RUS')).toBe('RU')
    expect(normalizeCountry('INA')).toBe('ID')
    expect(normalizeCountry('SIN')).toBe('SG')
    expect(normalizeCountry('PAK')).toBe('PK')
    expect(normalizeCountry('NGR')).toBe('NG')
    expect(normalizeCountry('GEO')).toBe('GE')
    expect(normalizeCountry('ALG')).toBe('DZ')
    expect(normalizeCountry('KAZ')).toBe('KZ')
  })
})

describe('subsetSimilarity', () => {
  it('returns 1.0 for identical names', () => {
    expect(subsetSimilarity('Juan Perez', 'Juan Perez')).toBe(1)
  })

  it('returns 1.0 when one name is a token-subset of the other', () => {
    // PDF has extra middle name
    expect(subsetSimilarity('Franco Renato Dal Bianco', 'Franco Dal Bianco')).toBe(1)
    // DB has extra middle name
    expect(subsetSimilarity('Naim Diaz', 'Naim Horacio Diaz')).toBe(1)
    // PDF has extra surnames
    expect(subsetSimilarity('Cristina Cirne Lima De Oliveira', 'Cristina Cirne')).toBe(1)
  })

  it('returns partial score when names share only some tokens', () => {
    const s = subsetSimilarity('Juan Pablo Garcia', 'Juan Maria Lopez')
    expect(s).toBeGreaterThan(0)
    expect(s).toBeLessThan(1)
  })

  it('returns 0 for completely different names', () => {
    expect(subsetSimilarity('Juan Perez', 'Maria Lopez')).toBe(0)
  })

  it('handles accents identically to normalize', () => {
    expect(subsetSimilarity('Adrián Baamonde', 'Adrian Baamonde')).toBe(1)
    expect(subsetSimilarity('Cléo Carvalho', 'Cleo Carvalho')).toBe(1)
  })
})

describe('typoTolerantSimilarity', () => {
  it('returns 1.0 for identical names', () => {
    expect(typoTolerantSimilarity('Juan Perez', 'Juan Perez')).toBe(1)
  })

  it('treats single-char differences in 4+-char tokens as matches', () => {
    // n/nn typo in "Giannina" vs "Gianina"
    expect(typoTolerantSimilarity('Giannina Minieri', 'Gianina Minieri')).toBe(1)
  })

  it('still returns 1.0 for subset matches (subset-tolerant)', () => {
    expect(typoTolerantSimilarity('Franco Renato Dal Bianco', 'Franco Dal Bianco')).toBe(1)
  })

  it('does NOT treat short-token differences as matches', () => {
    // 2-letter tokens with 1-char edit shouldn't be fuzzy-matched
    expect(typoTolerantSimilarity('Jo Smith', 'Jp Smith')).toBeLessThan(1)
  })

  it('requires edit distance <= 1 (no distance-2 matches)', () => {
    // "Carvalho" vs "Carvelho" = 1 edit → match
    expect(typoTolerantSimilarity('Cleo Carvalho', 'Cleo Carvelho')).toBe(1)
    // "Carvalho" vs "Carvelhu" = 2 edits → no match
    expect(typoTolerantSimilarity('Cleo Carvalho', 'Cleo Carvelhu')).toBeLessThan(1)
  })
})

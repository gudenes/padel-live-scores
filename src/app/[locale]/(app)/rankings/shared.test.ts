import { describe, expect, it } from 'vitest'
import { countryNameForLocale, countryFlagUrl } from './shared'

describe('countryNameForLocale', () => {
  it('returns localized name for ISO3 code in English', () => {
    expect(countryNameForLocale('ESP', 'en')).toBe('Spain')
  })

  it('returns localized name for ISO3 code in Spanish', () => {
    expect(countryNameForLocale('ESP', 'es')).toBe('España')
  })

  it('returns localized name for ISO2 code', () => {
    expect(countryNameForLocale('ES', 'es')).toBe('España')
  })

  it('returns localized name in Portuguese', () => {
    expect(countryNameForLocale('BRA', 'pt')).toBe('Brasil')
  })

  it('returns "Unknown" for null input', () => {
    expect(countryNameForLocale(null, 'en')).toBe('Unknown')
  })

  it('falls back to raw code when Intl cannot resolve it', () => {
    expect(countryNameForLocale('ZZZ', 'en')).toBe('ZZZ')
  })

  it('resolves QAT (Qatar) via the ISO3→ISO2 map', () => {
    expect(countryNameForLocale('QAT', 'en')).toBe('Qatar')
  })

  it('resolves QA (Qatar ISO2) directly', () => {
    expect(countryNameForLocale('QA', 'en')).toBe('Qatar')
  })
})

describe('countryFlagUrl', () => {
  it('maps ISO3 to lowercase ISO2 flag path', () => {
    expect(countryFlagUrl('ESP')).toBe('/flags/es.png')
  })

  it('passes through ISO2 lowercased', () => {
    expect(countryFlagUrl('AR')).toBe('/flags/ar.png')
  })

  it('returns null for null input', () => {
    expect(countryFlagUrl(null)).toBeNull()
  })

  it('returns null for unknown ISO3', () => {
    expect(countryFlagUrl('ZZZ')).toBeNull()
  })

  it('maps QAT to /flags/qa.png', () => {
    expect(countryFlagUrl('QAT')).toBe('/flags/qa.png')
  })
})

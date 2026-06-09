import { describe, it, expect } from 'vitest'
import { countryName, flagEmoji, countryLabel } from '@/lib/where-to-watch/iso2-names'

describe('countryName', () => {
  it('returns the English name for known codes (case-insensitive)', () => {
    expect(countryName('ar')).toBe('Argentina')
    expect(countryName('AR')).toBe('Argentina')
    expect(countryName('gb')).toBe('United Kingdom')
  })
  it('falls back to the uppercased code when unknown', () => {
    expect(countryName('zz')).toBe('ZZ')
  })
})

describe('flagEmoji', () => {
  it('derives the flag from the ISO code', () => {
    expect(flagEmoji('ar')).toBe('🇦🇷')
    expect(flagEmoji('ES')).toBe('🇪🇸')
  })
  it('returns empty string for malformed input', () => {
    expect(flagEmoji('zzz')).toBe('')
    expect(flagEmoji('1')).toBe('')
  })
})

describe('countryLabel', () => {
  it('combines flag and name', () => {
    expect(countryLabel('br')).toBe('🇧🇷 Brazil')
  })
  it('omits the flag for malformed codes', () => {
    expect(countryLabel('zzz')).toBe('ZZZ')
  })
})

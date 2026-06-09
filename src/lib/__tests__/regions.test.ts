import { describe, it, expect } from 'vitest'
import { REGIONS, REGION_NAMES, regionForCountry, countriesForRegion } from '@/lib/where-to-watch/regions'

describe('regions', () => {
  it('lists Latin America with the seeded countries', () => {
    expect(countriesForRegion('Latin America')).toContain('ar')
    expect(countriesForRegion('Latin America')).toContain('br')
    expect(countriesForRegion('Latin America').length).toBeGreaterThanOrEqual(20)
  })

  it('maps a country back to a single canonical region', () => {
    expect(regionForCountry('ar')).toBe('Latin America')
    expect(regionForCountry('es')).toBe('Europe')
    // mx is dual-listed for the picker but resolves to Latin America canonically
    expect(regionForCountry('mx')).toBe('Latin America')
  })

  it('returns null for an unknown country code', () => {
    expect(regionForCountry('zz')).toBeNull()
  })

  it('exposes region names in display order', () => {
    expect(REGION_NAMES[0]).toBe('Latin America')
    expect(REGION_NAMES).toContain('Middle East & North Africa')
    expect(Object.keys(REGIONS)).toEqual(REGION_NAMES)
  })
})

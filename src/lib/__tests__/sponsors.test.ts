import { describe, it, expect } from 'vitest'
import { getActiveSponsor, SPONSORS } from '@/lib/sponsors'

describe('getActiveSponsor', () => {
  it('returns AceProGrip for ES visitors on the sticky slot', () => {
    const s = getActiveSponsor('sticky-bottom', 'ES')
    expect(s?.id).toBe('aceprogrip')
    expect(s?.url).toBe('https://www.aceprogrip.es/')
    expect(s?.bannerImage).toBe('/sponsors/aceprogrip-banner.svg')
  })

  it('matches the country case-insensitively', () => {
    expect(getActiveSponsor('sticky-bottom', 'es')?.id).toBe('aceprogrip')
  })

  it('hides a region-locked sponsor for other countries', () => {
    expect(getActiveSponsor('sticky-bottom', 'PT')).toBeNull()
  })

  it('hides a region-locked sponsor when the country is unknown', () => {
    expect(getActiveSponsor('sticky-bottom', null)).toBeNull()
    expect(getActiveSponsor('sticky-bottom')).toBeNull()
  })

  it('every sponsor declares at least one slot', () => {
    for (const s of SPONSORS) expect(s.slots.length).toBeGreaterThan(0)
  })
})

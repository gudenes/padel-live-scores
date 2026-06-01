import { describe, it, expect } from 'vitest'
import { getActiveSponsor, SPONSORS, type AdSlotId } from '@/lib/sponsors'

describe('getActiveSponsor', () => {
  it('returns AceProGrip for the feed-inline slot', () => {
    const s = getActiveSponsor('feed-inline')
    expect(s?.id).toBe('aceprogrip')
    expect(s?.url).toBe('https://www.aceprogrip.es/')
    expect(s?.creativeImage).toBe('/sponsors/aceprogrip.svg')
  })

  it('returns AceProGrip for the match-detail-stats slot', () => {
    expect(getActiveSponsor('match-detail-stats')?.id).toBe('aceprogrip')
  })

  it('returns null when no sponsor is assigned to the slot', () => {
    expect(getActiveSponsor('no-such-slot' as AdSlotId)).toBeNull()
  })

  it('every sponsor declares at least one slot', () => {
    for (const s of SPONSORS) expect(s.slots.length).toBeGreaterThan(0)
  })
})

import { describe, it, expect } from 'vitest'
import { sortSeasonRefs, type AmateurSeasonRef } from '../amateur-profile'

const S = (label: string, startsOn: string | null): AmateurSeasonRef => ({
  seasonId: `id-${label}`,
  label,
  startsOn,
  teamId: 't-1',
  teamName: 'Blue Padel Mataró',
})

describe('sortSeasonRefs', () => {
  it('puts the most recent season first by start date', () => {
    const sorted = sortSeasonRefs([S('25/26', '2025-09-01'), S('26/27', '2026-09-01')])
    expect(sorted.map(s => s.label)).toEqual(['26/27', '25/26'])
  })

  it('falls back to the label when start dates are missing', () => {
    // The 25/26 import left starts_on null, so label ordering is what saves us.
    const sorted = sortSeasonRefs([S('25/26', null), S('26/27', null)])
    expect(sorted.map(s => s.label)).toEqual(['26/27', '25/26'])
  })

  it('ranks a dated season above an undated one', () => {
    const sorted = sortSeasonRefs([S('25/26', null), S('26/27', '2026-09-01')])
    expect(sorted[0].label).toBe('26/27')
  })

  it('returns an empty list untouched', () => {
    expect(sortSeasonRefs([])).toEqual([])
  })
})

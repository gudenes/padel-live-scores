import { describe, it, expect } from 'vitest'
import { localHourIn, zonedDayBoundsUtc } from '@/lib/tournament-day-window'

describe('localHourIn', () => {
  it('returns the wall-clock hour in the tz', () => {
    expect(localHourIn('Europe/Madrid', new Date('2026-06-09T06:30:00Z'))).toBe(8) // CEST +2
    expect(localHourIn('America/Argentina/Buenos_Aires', new Date('2026-06-09T06:30:00Z'))).toBe(3) // -3
  })
})

describe('zonedDayBoundsUtc', () => {
  it('returns the UTC instants bracketing the tz-local day + the local date', () => {
    const r = zonedDayBoundsUtc('Europe/Madrid', new Date('2026-06-09T06:30:00Z'))
    expect(r.localDate).toBe('2026-06-09')
    expect(r.startUtc).toBe('2026-06-08T22:00:00.000Z') // Madrid 00:00 CEST = 22:00Z prev day
    expect(r.endUtc).toBe('2026-06-09T22:00:00.000Z')
  })
})

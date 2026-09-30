import { describe, it, expect } from 'vitest'
import {
  parseWallClock, wallClockToUtc, venueTimezone, durationToSeconds, finishedAtFrom,
} from '../lib/ppl-schedule'

describe('parseWallClock', () => {
  it('reads the ISO-looking group-stage form', () => {
    expect(parseWallClock('2026-08-13T16:00:00')).toEqual({
      year: 2026, month: 8, day: 13, hours: 16, minutes: 0,
    })
  })

  it('reads the space-separated, unpadded-hour form', () => {
    // Real: new-york-ppl-ii-2026 podium. Found only after the import left two
    // matches dated null, because the ISO branch demanded two digits.
    expect(parseWallClock('2026-07-13 8:00:00')).toEqual({
      year: 2026, month: 7, day: 13, hours: 8, minutes: 0,
    })
  })

  it('reads an unpadded hour as 24-hour, not as AM', () => {
    // No meridiem anywhere in that form, and its siblings in the same payload
    // are plainly 24-hour ("11:00:00", "16:00:00").
    expect(parseWallClock('2026-07-13 19:00:00')!.hours).toBe(19)
  })

  it('rejects an out-of-range hour instead of wrapping it', () => {
    expect(parseWallClock('2026-07-13 25:00:00')).toBeNull()
  })

  it('reads the US-locale podium form, including PM', () => {
    expect(parseWallClock('8/16/2026 1:00:00 PM')).toEqual({
      year: 2026, month: 8, day: 16, hours: 13, minutes: 0,
    })
  })

  it('maps 12 AM to midnight and 12 PM to noon', () => {
    expect(parseWallClock('8/16/2026 12:30:00 AM')!.hours).toBe(0)
    expect(parseWallClock('8/16/2026 12:30:00 PM')!.hours).toBe(12)
  })

  it('returns null rather than a wrong guess', () => {
    expect(parseWallClock(null)).toBeNull()
    expect(parseWallClock('')).toBeNull()
    expect(parseWallClock('sometime on Tuesday')).toBeNull()
  })
})

describe('wallClockToUtc', () => {
  it('applies the summer offset in New York (UTC-4)', () => {
    // 9 July 2026 17:00 in New York is 21:00 UTC.
    expect(wallClockToUtc({ year: 2026, month: 7, day: 9, hours: 17, minutes: 0 }, 'America/New_York'))
      .toBe('2026-07-09T21:00:00.000Z')
  })

  it('applies the summer offset in Los Angeles (UTC-7)', () => {
    // 13 Aug 2026 16:00 in LA is 23:00 UTC.
    expect(wallClockToUtc({ year: 2026, month: 8, day: 13, hours: 16, minutes: 0 }, 'America/Los_Angeles'))
      .toBe('2026-08-13T23:00:00.000Z')
  })

  it('applies the WINTER offset for the December stop (UTC-5)', () => {
    // Miami on 3 Dec 2026 is EST, not EDT — a fixed offset would be an hour out.
    expect(wallClockToUtc({ year: 2026, month: 12, day: 3, hours: 17, minutes: 0 }, 'America/New_York'))
      .toBe('2026-12-03T22:00:00.000Z')
  })

  it('handles Cancun, which does NOT observe DST', () => {
    // America/Cancun is UTC-5 all year. Same offset in September and December.
    expect(wallClockToUtc({ year: 2026, month: 9, day: 24, hours: 12, minutes: 0 }, 'America/Cancun'))
      .toBe('2026-09-24T17:00:00.000Z')
    expect(wallClockToUtc({ year: 2026, month: 12, day: 24, hours: 12, minutes: 0 }, 'America/Cancun'))
      .toBe('2026-12-24T17:00:00.000Z')
  })

  it('survives a late-evening time that crosses the UTC day boundary', () => {
    // The trap the padelgod original documents: 23:00 in LA is 06:00 the NEXT
    // day in UTC. A naive localHour - utcHour would give the wrong sign.
    expect(wallClockToUtc({ year: 2026, month: 8, day: 13, hours: 23, minutes: 30 }, 'America/Los_Angeles'))
      .toBe('2026-08-14T06:30:00.000Z')
  })
})

describe('venueTimezone', () => {
  it('knows every 2026 stop, both divisions', () => {
    for (const slug of [
      'new-york-2026', 'new-york-ppl-ii-2026',
      'los-angeles-2026', 'los-angeles-ppl-ii-2026',
      'playa-del-carmen-2026', 'playa-del-carmen-ppl-ii-2026',
      'guadalajara-2026', 'guadalajara-ppl-ii-2026',
      'miami-2026', 'miami-ppl-ii-2026',
    ]) {
      expect(venueTimezone(slug), slug).toBeTruthy()
    }
  })

  it('does not guess at an unknown stop', () => {
    // A new venue must be added explicitly. Falling back to a country would
    // put a Los Angeles match three hours wrong.
    expect(venueTimezone('barcelona-2027')).toBeNull()
  })

  it('puts the two Mexican stops in different zones', () => {
    // Playa del Carmen does not observe DST; Guadalajara does. Treating
    // "Mexico" as one zone would be wrong for at least one of them.
    expect(venueTimezone('playa-del-carmen-2026')).not.toBe(venueTimezone('guadalajara-2026'))
  })
})

describe('durationToSeconds', () => {
  it('reads both HH:MM and HH:MM:SS', () => {
    expect(durationToSeconds('01:33')).toBe(5580)
    expect(durationToSeconds('01:33:47')).toBe(5627)
  })

  it('returns null rather than zero on junk', () => {
    expect(durationToSeconds(null)).toBeNull()
    expect(durationToSeconds('—')).toBeNull()
  })
})

describe('finishedAtFrom', () => {
  it('adds the duration to the start', () => {
    expect(finishedAtFrom('2026-08-13T23:00:00.000Z', 5627)).toBe('2026-08-14T00:33:47.000Z')
  })

  it('falls back to the start when the duration is unknown', () => {
    // Still far better than null: the profile orders on this column, so a
    // match without it is invisible.
    expect(finishedAtFrom('2026-08-13T23:00:00.000Z', null)).toBe('2026-08-13T23:00:00.000Z')
  })

  it('stays null when there is no start', () => {
    expect(finishedAtFrom(null, 5627)).toBeNull()
  })
})

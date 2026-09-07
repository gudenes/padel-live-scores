import { describe, it, expect } from 'vitest'
import { parseScheduleClock } from '../schedule-label-time'

describe('parseScheduleClock', () => {
  it('parses 12-hour AM/PM labels', () => {
    expect(parseScheduleClock('Starting at 11:00 AM')).toEqual({ hours: 11, minutes: 0 })
    expect(parseScheduleClock('Not before 4:00 PM')).toEqual({ hours: 16, minutes: 0 })
    expect(parseScheduleClock('Starting at 12:00 PM')).toEqual({ hours: 12, minutes: 0 })
    expect(parseScheduleClock('Starting at 12:00 AM')).toEqual({ hours: 0, minutes: 0 })
    expect(parseScheduleClock('starting at 4:30pm')).toEqual({ hours: 16, minutes: 30 })
  })

  it('parses 24-hour labels without AM/PM (Paris/Crionet locale)', () => {
    expect(parseScheduleClock('Starting at 12:00')).toEqual({ hours: 12, minutes: 0 })
    expect(parseScheduleClock('Not before 16:00')).toEqual({ hours: 16, minutes: 0 })
    expect(parseScheduleClock('Starting at 11:00')).toEqual({ hours: 11, minutes: 0 })
    expect(parseScheduleClock('Not before 18:00')).toEqual({ hours: 18, minutes: 0 })
  })

  it('returns null for labels without an absolute time', () => {
    expect(parseScheduleClock('Followed by')).toBeNull()
    expect(parseScheduleClock('')).toBeNull()
  })
})

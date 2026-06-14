// src/lib/__tests__/locale-time.test.ts

import { describe, it, expect } from 'vitest'
import {
  getLocaleHomeTz,
  getLocaleTodayIso,
  addDaysIso,
  formatIsoInTz,
  dateAtTzMidnight,
  localDayRangeUtc,
  isIsoDate,
  resolveDateSegment,
  isLocaleToday,
  matchesCanonicalPath,
} from '../locale-time'

describe('getLocaleHomeTz', () => {
  it('maps the 5 supported locales', () => {
    expect(getLocaleHomeTz('en')).toBe('UTC')
    expect(getLocaleHomeTz('es')).toBe('Europe/Madrid')
    expect(getLocaleHomeTz('pt')).toBe('Europe/Lisbon')
    expect(getLocaleHomeTz('it')).toBe('Europe/Rome')
    expect(getLocaleHomeTz('fr')).toBe('Europe/Paris')
  })

  it('falls back to UTC for unknown locale', () => {
    expect(getLocaleHomeTz('de')).toBe('UTC')
    expect(getLocaleHomeTz('')).toBe('UTC')
  })
})

describe('formatIsoInTz', () => {
  it('formats a UTC date as YYYY-MM-DD in the given TZ', () => {
    // 2026-04-17T22:00:00Z is 2026-04-18 00:00 in Madrid during CEST
    const d = new Date('2026-04-17T22:00:00Z')
    expect(formatIsoInTz(d, 'Europe/Madrid')).toBe('2026-04-18')
    expect(formatIsoInTz(d, 'UTC')).toBe('2026-04-17')
  })
})

describe('dateAtTzMidnight', () => {
  it('returns the UTC instant of midnight in a CEST TZ', () => {
    // Madrid summer time (CEST) is UTC+2 → midnight local = 22:00 UTC previous day
    const utc = dateAtTzMidnight('2026-07-15', 'Europe/Madrid')
    expect(utc.toISOString()).toBe('2026-07-14T22:00:00.000Z')
  })

  it('returns the UTC instant of midnight in a CET TZ', () => {
    // Madrid winter time (CET) is UTC+1 → midnight local = 23:00 UTC previous day
    const utc = dateAtTzMidnight('2026-01-15', 'Europe/Madrid')
    expect(utc.toISOString()).toBe('2026-01-14T23:00:00.000Z')
  })

  it('handles UTC itself', () => {
    const utc = dateAtTzMidnight('2026-04-17', 'UTC')
    expect(utc.toISOString()).toBe('2026-04-17T00:00:00.000Z')
  })

  it('throws on malformed ISO', () => {
    expect(() => dateAtTzMidnight('not-a-date', 'UTC')).toThrow()
  })
})

describe('addDaysIso', () => {
  it('adds a day in Madrid TZ', () => {
    expect(addDaysIso('2026-04-17', 1, 'Europe/Madrid')).toBe('2026-04-18')
    expect(addDaysIso('2026-04-17', -1, 'Europe/Madrid')).toBe('2026-04-16')
  })

  it('handles month boundaries', () => {
    expect(addDaysIso('2026-04-30', 1, 'Europe/Madrid')).toBe('2026-05-01')
    expect(addDaysIso('2026-05-01', -1, 'Europe/Madrid')).toBe('2026-04-30')
  })

  it('handles year boundaries', () => {
    expect(addDaysIso('2026-12-31', 1, 'UTC')).toBe('2027-01-01')
  })
})

describe('localDayRangeUtc', () => {
  it('returns a 24h window for Madrid in winter (UTC+1)', () => {
    const { startUtc, endUtc } = localDayRangeUtc('2026-01-15', 'Europe/Madrid')
    expect(startUtc.toISOString()).toBe('2026-01-14T23:00:00.000Z')
    expect(endUtc.toISOString()).toBe('2026-01-15T23:00:00.000Z')
  })

  it('returns a 24h window for UTC', () => {
    const { startUtc, endUtc } = localDayRangeUtc('2026-04-17', 'UTC')
    expect(startUtc.toISOString()).toBe('2026-04-17T00:00:00.000Z')
    expect(endUtc.toISOString()).toBe('2026-04-18T00:00:00.000Z')
  })
})

describe('isIsoDate', () => {
  it('accepts well-formed ISO dates', () => {
    expect(isIsoDate('2026-04-17')).toBe(true)
    expect(isIsoDate('1999-12-31')).toBe(true)
  })

  it('rejects malformed strings', () => {
    expect(isIsoDate('2026-4-17')).toBe(false)
    expect(isIsoDate('17-04-2026')).toBe(false)
    expect(isIsoDate('today')).toBe(false)
    expect(isIsoDate('')).toBe(false)
  })
})

describe('resolveDateSegment', () => {
  const fixedNow = new Date('2026-04-17T12:00:00Z') // mid-day UTC, safe for all EU TZs

  it('resolves today/yesterday/tomorrow in es', () => {
    expect(resolveDateSegment('today', 'es', fixedNow)).toBe('2026-04-17')
    expect(resolveDateSegment('yesterday', 'es', fixedNow)).toBe('2026-04-16')
    expect(resolveDateSegment('tomorrow', 'es', fixedNow)).toBe('2026-04-18')
  })

  it('passes through literal ISO dates', () => {
    expect(resolveDateSegment('2026-04-17', 'es', fixedNow)).toBe('2026-04-17')
    expect(resolveDateSegment('1999-12-31', 'en', fixedNow)).toBe('1999-12-31')
  })

  it('returns null for invalid segments', () => {
    expect(resolveDateSegment('banana', 'es', fixedNow)).toBeNull()
    expect(resolveDateSegment('17-04-2026', 'es', fixedNow)).toBeNull()
  })
})

describe('getLocaleTodayIso', () => {
  it('resolves today based on the locale TZ at 23:30 UTC', () => {
    // 23:30 UTC is already the next day in Madrid (UTC+1 or +2)
    const lateNight = new Date('2026-04-17T23:30:00Z')
    expect(getLocaleTodayIso('en', lateNight)).toBe('2026-04-17')
    // CEST in April: 23:30Z = 01:30 next day in Madrid
    expect(getLocaleTodayIso('es', lateNight)).toBe('2026-04-18')
  })
})

describe('isLocaleToday', () => {
  it('returns true for today and false otherwise', () => {
    const now = new Date('2026-04-17T12:00:00Z')
    const todayEs = getLocaleTodayIso('es', now)
    expect(isLocaleToday(todayEs, 'es', now)).toBe(true)
    expect(isLocaleToday('2026-04-16', 'es', now)).toBe(false)
    expect(isLocaleToday('2026-04-18', 'es', now)).toBe(false)
  })
})

describe('matchesCanonicalPath', () => {
  // 2026-04-17 10:00 UTC. ES home TZ is a day ahead late at night but not here.
  const now = new Date('2026-04-17T10:00:00Z')

  it('returns the permanent /matches hub for the locale today', () => {
    const todayEs = getLocaleTodayIso('es', now)
    expect(matchesCanonicalPath(todayEs, 'es', now)).toBe('/matches')
    const todayEn = getLocaleTodayIso('en', now)
    expect(matchesCanonicalPath(todayEn, 'en', now)).toBe('/matches')
  })

  it('returns the dated archive path for any other day', () => {
    expect(matchesCanonicalPath('2026-04-16', 'es', now)).toBe('/matches/2026-04-16')
    expect(matchesCanonicalPath('2026-04-18', 'en', now)).toBe('/matches/2026-04-18')
  })
})

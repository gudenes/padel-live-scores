import { describe, it, expect } from 'vitest'
import { countryToTimezone } from '../country-timezone'

describe('countryToTimezone', () => {
  it('returns the IANA timezone for a known country code', () => {
    expect(countryToTimezone('PY')).toBe('America/Asuncion')
    expect(countryToTimezone('AR')).toBe('America/Argentina/Buenos_Aires')
    expect(countryToTimezone('ES')).toBe('Europe/Madrid')
    expect(countryToTimezone('GB')).toBe('Europe/London')
    expect(countryToTimezone('TH')).toBe('Asia/Bangkok')
    expect(countryToTimezone('XK')).toBe('Europe/Belgrade')
  })

  it('is case-insensitive on the input', () => {
    expect(countryToTimezone('py')).toBe('America/Asuncion')
    expect(countryToTimezone('Ar')).toBe('America/Argentina/Buenos_Aires')
  })

  it('returns null for null / undefined / empty', () => {
    expect(countryToTimezone(null)).toBeNull()
    expect(countryToTimezone(undefined)).toBeNull()
    expect(countryToTimezone('')).toBeNull()
  })

  it('returns null for unknown country codes', () => {
    expect(countryToTimezone('ZZ')).toBeNull()
    expect(countryToTimezone('XYZ')).toBeNull()
  })

  it('all mapped values are valid IANA timezones (Intl resolves them)', () => {
    // Sample a few — we don't iterate every entry to keep the test
    // fast, but if any entry is malformed it'll throw here.
    for (const cc of ['PY', 'AR', 'ES', 'US', 'JP', 'AU', 'XK', 'AE']) {
      const tz = countryToTimezone(cc)
      expect(tz).toBeTruthy()
      // Throws RangeError if tz is invalid
      expect(() => new Intl.DateTimeFormat('en-CA', { timeZone: tz! }).format(new Date())).not.toThrow()
    }
  })

  it('covers new FIP destinations added 2026-05 (Albania, Senegal, Georgia, Malta)', () => {
    // Pinned to lock in entries added after the 2026-05-25 incident
    // where FIP PLATINUM ALBANIA matches were stuck with no scheduled_at
    // because the country fell through the lookup. If FIP keeps
    // expanding, add new entries here as you add them above.
    expect(countryToTimezone('AL')).toBe('Europe/Tirane')
    expect(countryToTimezone('SN')).toBe('Africa/Dakar')
    expect(countryToTimezone('GE')).toBe('Asia/Tbilisi')
    expect(countryToTimezone('MT')).toBe('Europe/Malta')
  })
})

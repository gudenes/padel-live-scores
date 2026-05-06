import { describe, it, expect } from 'vitest'
import {
  parseConsent,
  isExpired,
  migrateLegacy,
  serializeConsent,
  RECONSENT_INTERVAL_MS,
  type ConsentState,
} from '../consent'

describe('parseConsent', () => {
  it('returns null for missing input', () => {
    expect(parseConsent(null)).toBeNull()
  })

  it('returns null for invalid JSON', () => {
    expect(parseConsent('not json')).toBeNull()
  })

  it('returns null when required fields missing', () => {
    expect(parseConsent('{"analytics":true}')).toBeNull()
  })

  it('parses a valid consent object', () => {
    const raw = JSON.stringify({
      analytics: true,
      push: false,
      decided_at: '2026-05-06T18:00:00Z',
    })
    const out = parseConsent(raw)
    expect(out).toEqual({
      analytics: true,
      push: false,
      decided_at: '2026-05-06T18:00:00Z',
    })
  })

  it('coerces bools that are actually strings/0/1 to false (strict)', () => {
    const raw = JSON.stringify({
      analytics: 'true',
      push: 1,
      decided_at: '2026-05-06T18:00:00Z',
    })
    expect(parseConsent(raw)).toBeNull()
  })
})

describe('isExpired', () => {
  it('returns false for a fresh decision', () => {
    const decided = new Date(Date.now() - 86400_000) // 1 day ago
    expect(isExpired(decided.toISOString(), Date.now())).toBe(false)
  })

  it('returns true when older than the reconsent interval', () => {
    const decided = new Date(Date.now() - RECONSENT_INTERVAL_MS - 1_000)
    expect(isExpired(decided.toISOString(), Date.now())).toBe(true)
  })

  it('returns true exactly at the boundary plus 1ms', () => {
    const now = Date.now()
    const decided = new Date(now - RECONSENT_INTERVAL_MS - 1)
    expect(isExpired(decided.toISOString(), now)).toBe(true)
  })

  it('returns true for an unparseable date', () => {
    expect(isExpired('not a date', Date.now())).toBe(true)
  })
})

describe('migrateLegacy', () => {
  it('returns null when neither pn_consent nor legacy flag exists', () => {
    expect(migrateLegacy(null, null)).toBeNull()
  })

  it('returns null when pn_consent already exists (caller uses parseConsent)', () => {
    expect(migrateLegacy('{"any":"value"}', '1')).toBeNull()
  })

  it('produces a denied state when only the legacy flag is set to "1"', () => {
    const out = migrateLegacy(null, '1')
    expect(out).not.toBeNull()
    expect(out!.analytics).toBe(false)
    expect(out!.push).toBe(false)
    expect(typeof out!.decided_at).toBe('string')
    expect(new Date(out!.decided_at).getTime()).not.toBeNaN()
  })

  it('returns null when the legacy flag is anything other than "1"', () => {
    expect(migrateLegacy(null, '0')).toBeNull()
    expect(migrateLegacy(null, '')).toBeNull()
  })
})

describe('serializeConsent', () => {
  it('round-trips a consent object', () => {
    const c: ConsentState = {
      analytics: true,
      push: false,
      decided_at: '2026-05-06T18:00:00Z',
    }
    expect(parseConsent(serializeConsent(c))).toEqual(c)
  })
})

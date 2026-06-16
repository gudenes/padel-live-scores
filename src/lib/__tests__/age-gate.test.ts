import { describe, it, expect } from 'vitest'
import {
  parseAgeVerification,
  serializeAgeVerification,
  computeAge,
  isOldEnough,
  type AgeVerification,
} from '@/lib/age-gate'

const NOW = new Date('2026-06-16T12:00:00Z')

describe('computeAge', () => {
  it('computes full years, not-yet-had-birthday this year', () => {
    expect(computeAge('2000-12-31', NOW)).toBe(25)
  })
  it('counts a birthday that already passed this year', () => {
    expect(computeAge('2000-01-01', NOW)).toBe(26)
  })
  it('counts exactly on the birthday', () => {
    expect(computeAge('2008-06-16', NOW)).toBe(18)
  })
  it('returns -1 for an invalid or future date', () => {
    expect(computeAge('not-a-date', NOW)).toBe(-1)
    expect(computeAge('2030-01-01', NOW)).toBe(-1)
  })
})

describe('isOldEnough', () => {
  it('is true exactly at the minimum age', () => {
    expect(isOldEnough('2008-06-16', 18, NOW)).toBe(true)
  })
  it('is false one day short of the minimum age', () => {
    expect(isOldEnough('2008-06-17', 18, NOW)).toBe(false)
  })
  it('is false for invalid input', () => {
    expect(isOldEnough('nonsense', 18, NOW)).toBe(false)
  })
})

describe('parse/serialize', () => {
  it('round-trips a valid verification', () => {
    const v: AgeVerification = { verified: true, birthdate: '2000-01-01', decided_at: '2026-06-16T12:00:00.000Z' }
    expect(parseAgeVerification(serializeAgeVerification(v))).toEqual(v)
  })
  it('accepts a denial with null birthdate', () => {
    const v: AgeVerification = { verified: false, birthdate: null, decided_at: '2026-06-16T12:00:00.000Z' }
    expect(parseAgeVerification(serializeAgeVerification(v))).toEqual(v)
  })
  it('rejects malformed json / wrong shape / null', () => {
    expect(parseAgeVerification(null)).toBeNull()
    expect(parseAgeVerification('{')).toBeNull()
    expect(parseAgeVerification('{"verified":"yes"}')).toBeNull()
  })
})

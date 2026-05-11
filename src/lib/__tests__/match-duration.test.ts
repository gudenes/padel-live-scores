import { describe, it, expect } from 'vitest'
import {
  parseDurationHHMM,
  sanitizeDurationHHMM,
  MAX_DURATION_MINUTES,
} from '../match-duration'

describe('parseDurationHHMM', () => {
  it('parses HH:MM into total minutes', () => {
    expect(parseDurationHHMM('00:00')).toBe(0)
    expect(parseDurationHHMM('01:20')).toBe(80)
    expect(parseDurationHHMM('22:09')).toBe(1329)
  })

  it('returns null for null, empty, or malformed input', () => {
    expect(parseDurationHHMM(null)).toBeNull()
    expect(parseDurationHHMM(undefined)).toBeNull()
    expect(parseDurationHHMM('')).toBeNull()
    expect(parseDurationHHMM('garbage')).toBeNull()
    expect(parseDurationHHMM('1-20')).toBeNull()
  })
})

describe('sanitizeDurationHHMM', () => {
  it('passes through plausible durations', () => {
    expect(sanitizeDurationHHMM('00:00')).toBe('00:00')
    expect(sanitizeDurationHHMM('01:45')).toBe('01:45')
    expect(sanitizeDurationHHMM('03:59')).toBe('03:59')
    expect(sanitizeDurationHHMM('04:00')).toBe('04:00')
  })

  it('returns null for the exact incident values', () => {
    // ASUNCION P2 2026-05-08 QF leaks
    expect(sanitizeDurationHHMM('22:09')).toBeNull()
    expect(sanitizeDurationHHMM('20:05')).toBeNull()
  })

  it('returns null for values just past the cap', () => {
    expect(sanitizeDurationHHMM('04:01')).toBeNull()
  })

  it('returns null for null, undefined, empty, or malformed', () => {
    expect(sanitizeDurationHHMM(null)).toBeNull()
    expect(sanitizeDurationHHMM(undefined)).toBeNull()
    expect(sanitizeDurationHHMM('')).toBeNull()
    expect(sanitizeDurationHHMM('not-a-time')).toBeNull()
  })

  it('exposes MAX_DURATION_MINUTES = 240', () => {
    expect(MAX_DURATION_MINUTES).toBe(240)
  })
})

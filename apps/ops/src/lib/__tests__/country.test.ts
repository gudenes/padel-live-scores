import { describe, it, expect } from 'vitest'
import { COUNTRY_OPTIONS } from '@/lib/country'

describe('COUNTRY_OPTIONS', () => {
  it('includes well-known countries with their English name', () => {
    const byCode = new Map(COUNTRY_OPTIONS.map((c) => [c.code, c.name]))
    expect(byCode.get('US')).toBe('United States')
    expect(byCode.get('ES')).toBe('Spain')
    expect(byCode.get('BR')).toBe('Brazil')
  })

  it('excludes codes Intl.DisplayNames cannot resolve to a real name', () => {
    // "QQ" and "XX" are unassigned in ISO 3166-1 — Intl.DisplayNames echoes
    // the code back verbatim for these, which is exactly the signal our
    // filter excludes on. ("ZZ" is a bad example: CLDR maps it to the
    // string "Unknown Region", which differs from the code and would pass
    // the naive filter — a reminder the filter is about "differs from
    // code", not "is a real country" in every edge case.)
    expect(COUNTRY_OPTIONS.some((c) => c.code === 'QQ')).toBe(false)
    expect(COUNTRY_OPTIONS.some((c) => c.code === 'XX')).toBe(false)
  })

  it('has no duplicate codes', () => {
    const codes = COUNTRY_OPTIONS.map((c) => c.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('only contains uppercase two-letter codes', () => {
    for (const { code } of COUNTRY_OPTIONS) {
      expect(code).toMatch(/^[A-Z]{2}$/)
    }
  })

  it('is sorted by display name', () => {
    const names = COUNTRY_OPTIONS.map((c) => c.name)
    const sorted = [...names].sort((a, b) => a.localeCompare(b))
    expect(names).toEqual(sorted)
  })

  it('resolves roughly the size of the real ISO-3166-1 alpha-2 set', () => {
    // ~249 assigned regions as of recent CLDR data; a loose bound guards
    // against the scan logic silently breaking (e.g. filter always true/false)
    // without being brittle to CLDR churn.
    expect(COUNTRY_OPTIONS.length).toBeGreaterThan(150)
    expect(COUNTRY_OPTIONS.length).toBeLessThan(300)
  })
})

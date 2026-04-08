// src/lib/__tests__/source-matcher.test.ts

import { describe, it, expect } from 'vitest'
import {
  tokenize,
  isTokenSubset,
  resolveSingleCandidate,
  yearOf,
  normalizeRound,
  extractCategoryFromPremierRound,
} from '../source-matcher'

// ── tokenize ──────────────────────────────────────────────────

describe('tokenize', () => {
  it('lowercases and splits on non-alphanumerics', () => {
    expect(tokenize('Newgiza P2 2026')).toEqual(['newgiza', 'p2'])
  })

  it('strips diacritics', () => {
    expect(tokenize('GIJÓN P2')).toEqual(['gijon', 'p2'])
  })

  it('strips 4-digit years', () => {
    expect(tokenize('Newgiza P2 2026')).toEqual(['newgiza', 'p2'])
    expect(tokenize('Brussels P2 1999')).toEqual(['brussels', 'p2'])
  })

  it('filters noise tokens (premier, padel, tour, etc.)', () => {
    const tokens = tokenize('LOTTO BRUSSELS PREMIER PADEL P2 PRESENTED BY BELFIUS')
    expect(tokens).toContain('brussels')
    expect(tokens).toContain('p2')
    expect(tokens).not.toContain('premier')
    expect(tokens).not.toContain('padel')
    expect(tokens).not.toContain('presented')
    expect(tokens).not.toContain('by')
  })

  it('returns empty array for null/undefined/empty', () => {
    expect(tokenize(null)).toEqual([])
    expect(tokenize(undefined)).toEqual([])
    expect(tokenize('')).toEqual([])
  })
})

// ── isTokenSubset ─────────────────────────────────────────────

describe('isTokenSubset', () => {
  it('matches "NEWGIZA P2" against "Newgiza P2 2026"', () => {
    expect(isTokenSubset('NEWGIZA P2', 'Newgiza P2 2026')).toBe(true)
  })

  it('matches "Brussels P2" inside sponsored name', () => {
    expect(isTokenSubset(
      'Brussels P2',
      'Lotto Brussels Premier Padel P2 Presented By Belfius',
    )).toBe(true)
  })

  it('rejects different tiers (P1 vs P2)', () => {
    expect(isTokenSubset('Riyadh P1', 'Riyadh P2')).toBe(false)
    expect(isTokenSubset('Riyadh P2', 'Riyadh P1')).toBe(false)
  })

  it('rejects mismatched base names', () => {
    expect(isTokenSubset('Brussels P2', 'Madrid P2')).toBe(false)
  })

  it('accepts reverse subset (haystack tokens all in needle)', () => {
    expect(isTokenSubset('Big Sponsor Miami P1 2026', 'MIAMI P1')).toBe(true)
  })
})

// ── yearOf ────────────────────────────────────────────────────

describe('yearOf', () => {
  it('extracts year from ISO date string', () => {
    expect(yearOf('2026-03-01')).toBe(2026)
    expect(yearOf('2026-03-01T10:00:00Z')).toBe(2026)
  })

  it('returns null for empty/null/invalid dates', () => {
    expect(yearOf(null)).toBeNull()
    expect(yearOf('')).toBeNull()
    expect(yearOf('not-a-date')).toBeNull()
  })
})

// ── resolveSingleCandidate ────────────────────────────────────

describe('resolveSingleCandidate', () => {
  const candidates = [
    { id: 'A', name: 'Newgiza P2 2026', starts_at: '2026-04-13' },
    { id: 'B', name: 'Miami P1 2026', starts_at: '2026-03-23' },
    { id: 'C', name: 'Brussels P2 2025', starts_at: '2025-04-15' },
  ]

  it('picks single year-matched candidate', () => {
    const result = resolveSingleCandidate(
      { name: 'NEWGIZA P2', year: 2026 },
      candidates,
    )
    expect(result.match?.id).toBe('A')
    expect(result.reason).toBe('single')
  })

  it('returns null when no candidate matches', () => {
    const result = resolveSingleCandidate(
      { name: 'FAKE TOURNAMENT', year: 2026 },
      candidates,
    )
    expect(result.match).toBeNull()
    expect(result.reason).toBe('no_candidate')
  })

  it('returns null when multiple candidates match', () => {
    const result = resolveSingleCandidate(
      { name: 'BRUSSELS P2', year: null },
      [
        { id: 'X', name: 'Brussels P2 2025', starts_at: '2025-04-15' },
        { id: 'Y', name: 'Brussels P2 2026', starts_at: '2026-04-20' },
      ],
    )
    expect(result.match).toBeNull()
    expect(result.reason).toBe('multiple_candidates')
  })

  it('filters by year when provided', () => {
    const result = resolveSingleCandidate(
      { name: 'BRUSSELS P2', year: 2025 },
      [
        { id: 'X', name: 'Brussels P2 2025', starts_at: '2025-04-15' },
        { id: 'Y', name: 'Brussels P2 2026', starts_at: '2026-04-20' },
      ],
    )
    expect(result.match?.id).toBe('X')
  })
})

// ── normalizeRound ────────────────────────────────────────────
//
// Our DB has BOTH formats coexisting:
//   Verbose: "Round of 64", "Round of 32", "Round of 16", "Quarter",
//            "Semifinals", "Finals"
//   Short:   "R64", "R32", "R16", "QF", "SF", "F"
//
// Premier's API uses: "Men SF", "Men QF", "Women R32", "Men R64", "Men F",
// "Men Q1" (qualification), etc.
//
// normalizeRound canonicalizes anything to the short form: R64, R32, R16,
// QF, SF, F, Q1, Q2, Q3. Returns null for unrecognized input.

describe('normalizeRound', () => {
  it('normalizes our verbose format to short codes', () => {
    expect(normalizeRound('Round of 64')).toBe('R64')
    expect(normalizeRound('Round of 32')).toBe('R32')
    expect(normalizeRound('Round of 16')).toBe('R16')
    expect(normalizeRound('Quarter')).toBe('QF')
    expect(normalizeRound('Quarterfinals')).toBe('QF')
    expect(normalizeRound('Semifinals')).toBe('SF')
    expect(normalizeRound('Semifinal')).toBe('SF')
    expect(normalizeRound('Finals')).toBe('F')
    expect(normalizeRound('Final')).toBe('F')
  })

  it('passes through our short format unchanged', () => {
    expect(normalizeRound('R64')).toBe('R64')
    expect(normalizeRound('R32')).toBe('R32')
    expect(normalizeRound('R16')).toBe('R16')
    expect(normalizeRound('QF')).toBe('QF')
    expect(normalizeRound('SF')).toBe('SF')
    expect(normalizeRound('F')).toBe('F')
  })

  it("strips Premier's category prefix", () => {
    expect(normalizeRound('Men SF')).toBe('SF')
    expect(normalizeRound('Men QF')).toBe('QF')
    expect(normalizeRound('Women R32')).toBe('R32')
    expect(normalizeRound('Men R64')).toBe('R64')
    expect(normalizeRound('Men F')).toBe('F')
  })

  it('handles Premier qualification rounds', () => {
    expect(normalizeRound('Men Q1')).toBe('Q1')
    expect(normalizeRound('Men Q2')).toBe('Q2')
    expect(normalizeRound('Women Q1')).toBe('Q1')
  })

  it('is case insensitive', () => {
    expect(normalizeRound('round of 32')).toBe('R32')
    expect(normalizeRound('SEMIFINALS')).toBe('SF')
    expect(normalizeRound('men sf')).toBe('SF')
  })

  it('returns null for null/undefined/empty', () => {
    expect(normalizeRound(null)).toBeNull()
    expect(normalizeRound(undefined)).toBeNull()
    expect(normalizeRound('')).toBeNull()
  })

  it('returns null for unrecognized input', () => {
    expect(normalizeRound('Garbage')).toBeNull()
    expect(normalizeRound('Something Else')).toBeNull()
  })

  it('trims whitespace', () => {
    expect(normalizeRound('  SF  ')).toBe('SF')
    expect(normalizeRound(' Semifinals ')).toBe('SF')
  })
})

// ── extractCategoryFromPremierRound ───────────────────────────

describe('extractCategoryFromPremierRound', () => {
  it('extracts men from "Men SF", "Men R32", "Men Q1"', () => {
    expect(extractCategoryFromPremierRound('Men SF')).toBe('men')
    expect(extractCategoryFromPremierRound('Men R32')).toBe('men')
    expect(extractCategoryFromPremierRound('Men Q1')).toBe('men')
  })

  it('extracts women from "Women QF", "Women R16"', () => {
    expect(extractCategoryFromPremierRound('Women QF')).toBe('women')
    expect(extractCategoryFromPremierRound('Women R16')).toBe('women')
  })

  it('is case insensitive', () => {
    expect(extractCategoryFromPremierRound('MEN SF')).toBe('men')
    expect(extractCategoryFromPremierRound('women qf')).toBe('women')
  })

  it('returns null for strings without a category prefix', () => {
    expect(extractCategoryFromPremierRound('SF')).toBeNull()
    expect(extractCategoryFromPremierRound('Round of 32')).toBeNull()
  })

  it('returns null for null/undefined/empty', () => {
    expect(extractCategoryFromPremierRound(null)).toBeNull()
    expect(extractCategoryFromPremierRound(undefined)).toBeNull()
    expect(extractCategoryFromPremierRound('')).toBeNull()
  })
})

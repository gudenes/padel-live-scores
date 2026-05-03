import { describe, it, expect } from 'vitest'
import { roundCanonical } from '../round-canonical'

describe('roundCanonical', () => {
  // Final variants
  it('maps "Final" → F', () => expect(roundCanonical('Final')).toBe('F'))
  it('maps "Finals" → F', () => expect(roundCanonical('Finals')).toBe('F'))
  it('maps "F" → F', () => expect(roundCanonical('F')).toBe('F'))

  // Semifinal variants
  it('maps "Semifinal" → SF', () => expect(roundCanonical('Semifinal')).toBe('SF'))
  it('maps "Semifinals" → SF', () => expect(roundCanonical('Semifinals')).toBe('SF'))
  it('maps "SemiFinals" (mixed case) → SF', () => expect(roundCanonical('SemiFinals')).toBe('SF'))
  it('maps "SF" → SF', () => expect(roundCanonical('SF')).toBe('SF'))

  // Quarter variants
  it('maps "Quarter" → QF', () => expect(roundCanonical('Quarter')).toBe('QF'))
  it('maps "Quarterfinals" → QF', () => expect(roundCanonical('Quarterfinals')).toBe('QF'))
  it('maps "QF" → QF', () => expect(roundCanonical('QF')).toBe('QF'))

  // Round-of-N variants
  it('maps "Round of 16" → R16', () => expect(roundCanonical('Round of 16')).toBe('R16'))
  it('maps "R16" → R16', () => expect(roundCanonical('R16')).toBe('R16'))
  it('maps "Round of 32" → R32', () => expect(roundCanonical('Round of 32')).toBe('R32'))
  it('maps "R32" → R32', () => expect(roundCanonical('R32')).toBe('R32'))
  it('maps "Round of 64" → R64', () => expect(roundCanonical('Round of 64')).toBe('R64'))
  it('maps "R64" → R64', () => expect(roundCanonical('R64')).toBe('R64'))

  // Qualifier rounds
  it('maps "Q1" → Q1', () => expect(roundCanonical('Q1')).toBe('Q1'))
  it('maps "Q2" → Q2', () => expect(roundCanonical('Q2')).toBe('Q2'))
  it('maps "Q3" → Q3', () => expect(roundCanonical('Q3')).toBe('Q3'))

  // Whitespace + case insensitivity
  it('trims surrounding whitespace', () => expect(roundCanonical('  Final  ')).toBe('F'))
  it('is case-insensitive', () => expect(roundCanonical('round of 16')).toBe('R16'))
  it('is case-insensitive on uppercase', () => expect(roundCanonical('FINAL')).toBe('F'))

  // Null / undefined / empty
  it('returns null for null input', () => expect(roundCanonical(null)).toBeNull())
  it('returns null for undefined input', () => expect(roundCanonical(undefined)).toBeNull())
  it('returns null for empty string', () => expect(roundCanonical('')).toBeNull())
  it('returns null for whitespace-only string', () => expect(roundCanonical('   ')).toBeNull())

  // Unrecognized labels — we don't guess
  it('returns null for "Group A" (RR group stage)', () => expect(roundCanonical('Group A')).toBeNull())
  it('returns null for "Exhibition"', () => expect(roundCanonical('Exhibition')).toBeNull())
  it('returns null for "Playoff"', () => expect(roundCanonical('Playoff')).toBeNull())
  it('returns null for "32"', () => expect(roundCanonical('32')).toBeNull())
})

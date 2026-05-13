import { describe, it, expect } from 'vitest'
import { playerShortName } from '../player-short-name'

describe('playerShortName (paternal-surname convention)', () => {
  it('3-token Spanish name → middle token (paternal surname)', () => {
    expect(playerShortName('Alejandra Salazar Bengoechea')).toBe('Salazar')
    expect(playerShortName('Alejandra Alonso De Villa')).toBe('Alonso')
  })
  it('4-token name with compound first name → second token', () => {
    expect(playerShortName('Juan Carlos Ruiz Diaz')).toBe('Carlos')
    // Acceptable trade-off: heuristic can't know "Juan Carlos" is one name.
    // Document this limitation; rare and visually still recognizable.
  })
  it('2-token name → last token', () => {
    expect(playerShortName('Agustin Tapia')).toBe('Tapia')
    expect(playerShortName('Juan Lebron')).toBe('Lebron')
  })
  it('1-token name → return as-is', () => {
    expect(playerShortName('Madonna')).toBe('Madonna')
  })
  it('null / empty → fallback dash', () => {
    expect(playerShortName(null)).toBe('—')
    expect(playerShortName('')).toBe('—')
    expect(playerShortName('   ')).toBe('—')
  })
  it('trims and collapses whitespace', () => {
    expect(playerShortName('  Alejandra  Salazar  Bengoechea  ')).toBe('Salazar')
  })
})

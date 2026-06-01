import { describe, it, expect } from 'vitest'
import { toShortName } from '@/types/match'

describe('toShortName (initial + paternal-surname convention)', () => {
  it('3-token Spanish name → initial + paternal surname', () => {
    expect(toShortName('Agustin Dominguez Gracia')).toBe('A. Dominguez')
    expect(toShortName('Alejandra Salazar Bengoechea')).toBe('A. Salazar')
  })

  it('2-token name → initial + surname', () => {
    expect(toShortName('Agustin Tapia')).toBe('A. Tapia')
    expect(toShortName('Juan Lebron')).toBe('J. Lebron')
  })

  it('absorbs romance particles in the paternal surname', () => {
    expect(toShortName('Martin Di Nenno')).toBe('M. Di Nenno')
    expect(toShortName('Martin de la Fuente')).toBe('M. de la Fuente')
  })

  it('drops the maternal surname when paternal surname is plain', () => {
    // particle belongs to the SECOND surname → not absorbed, paternal stands alone
    expect(toShortName('Alejandra Alonso De Villa')).toBe('A. Alonso')
  })

  it('1-token name → returned as-is', () => {
    expect(toShortName('Madonna')).toBe('Madonna')
  })

  it('collapses surrounding/duplicate whitespace', () => {
    expect(toShortName('  Agustin   Dominguez  Gracia ')).toBe('A. Dominguez')
  })

  it('compound first name limitation → second token (override via display_name)', () => {
    // Heuristic cannot know "Ana Cristina" is one given name.
    expect(toShortName('Ana Cristina Sanchez Perez')).toBe('A. Cristina')
  })
})

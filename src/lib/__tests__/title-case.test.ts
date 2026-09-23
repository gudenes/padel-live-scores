import { describe, it, expect } from 'vitest'
import { titleCase } from '@/lib/title-case'

// titleCase re-cases every tournament name in the app, and it lowercases
// anything it does not recognise as an acronym. That is how "Los Angeles
// PPL II" reached the Events tab reading "Los Angeles Ppl II" — a league's
// own name rendered as a typo.

describe('titleCase', () => {
  it('keeps league and circuit acronyms upper', () => {
    expect(titleCase('Los Angeles PPL II')).toBe('Los Angeles PPL II')
    expect(titleCase('FIP GOLD MADRID')).toBe('FIP Gold Madrid')
  })

  it('keeps PPL upper however upstream cased it', () => {
    // Upstream is inconsistent — "Miami PPL II", "New York -- PPL II".
    expect(titleCase('miami ppl ii')).toBe('Miami PPL II')
  })

  it('does not shout ordinary words that look like acronyms', () => {
    expect(titleCase('APPLE CUP')).toBe('Apple Cup')
  })

  it('still upper-cases roman numerals', () => {
    expect(titleCase('XX MEDITERRANEAN GAMES')).toBe('XX Mediterranean Games')
  })

  it('does not lowercase a mid-name particle — KNOWN GAP', () => {
    // Documents current behaviour, which is wrong: the city is "Playa del
    // Carmen". Fixing it inside titleCase would re-case every Spanish and
    // Portuguese tournament name in the app, so it is deliberately left
    // alone here and raised separately rather than changed in passing.
    expect(titleCase('PLAYA DEL CARMEN')).toBe('Playa Del Carmen')
  })
})

import { describe, it, expect } from 'vitest'
import {
  normalizeSearchQuery,
  playerSearchOr,
  tournamentNameMatches,
} from '../search-normalize'

describe('normalizeSearchQuery', () => {
  it('strips diacritics so "Goñi" folds to "goni"', () => {
    expect(normalizeSearchQuery('Goñi')).toBe('goni')
    expect(normalizeSearchQuery('Aimar Goñi Lacabe')).toBe('aimar goni lacabe')
  })

  it('lowercases, collapses whitespace, and trims', () => {
    expect(normalizeSearchQuery('  Aimar   Goñi  ')).toBe('aimar goni')
  })

  it('folds punctuation to spaces, matching the DB normalized_name formula', () => {
    expect(normalizeSearchQuery("O'Brien")).toBe('o brien')
    expect(normalizeSearchQuery('Málaga Padel Open 1000 2023')).toBe(
      'malaga padel open 1000 2023',
    )
  })

  it('returns empty string for whitespace/punctuation-only input', () => {
    expect(normalizeSearchQuery('')).toBe('')
    expect(normalizeSearchQuery('   ')).toBe('')
    expect(normalizeSearchQuery('!!!')).toBe('')
  })
})

describe('playerSearchOr', () => {
  it('builds an accent + display-name OR filter', () => {
    expect(playerSearchOr('goni')).toBe(
      'normalized_name.ilike.%goni%,display_name.ilike.%goni%',
    )
  })

  it('produces a value free of PostgREST-breaking characters', () => {
    const norm = normalizeSearchQuery("Momo, (test)")
    expect(norm).not.toMatch(/[,()]/)
    expect(playerSearchOr(norm)).toBe(
      'normalized_name.ilike.%momo test%,display_name.ilike.%momo test%',
    )
  })
})

describe('tournamentNameMatches', () => {
  it('matches an accented stored name from an unaccented query', () => {
    expect(tournamentNameMatches('Málaga Padel Open 1000 2023', 'malaga')).toBe(true)
    expect(tournamentNameMatches('FIP PROMISES MALÉ', 'male')).toBe(true)
    expect(tournamentNameMatches('FIP PROMISES SAN LUIS POTOSÍ', 'potosi')).toBe(true)
  })

  it('still matches plain (non-accented) names', () => {
    expect(tournamentNameMatches('Madrid Premier Padel P1', 'madrid')).toBe(true)
  })

  it('returns false for non-matches and empty query', () => {
    expect(tournamentNameMatches('Madrid Premier Padel P1', 'barcelona')).toBe(false)
    expect(tournamentNameMatches('Madrid', '')).toBe(false)
  })
})

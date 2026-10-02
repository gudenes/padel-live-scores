import { describe, it, expect } from 'vitest'
import { normalizeCoachName, coachTokens, slugifyCoach, uniqueSlug } from '../../lib/coach-normalize.js'

describe('normalizeCoachName', () => {
  it('strips accents and case', () => {
    expect(normalizeCoachName('Fábio Faísca')).toBe('fabio faisca')
    expect(normalizeCoachName('Fabio Faisca')).toBe('fabio faisca')
  })
  it('removes apostrophes instead of splitting on them', () => {
    expect(normalizeCoachName('Martín D’antonio')).toBe('martin dantonio')
    expect(normalizeCoachName("Kevin O'brien")).toBe('kevin obrien')
    expect(normalizeCoachName('Kevin O’brien')).toBe('kevin obrien')
  })
  it('collapses whitespace and punctuation', () => {
    expect(normalizeCoachName('  Alejandro  Del Moral ')).toBe('alejandro del moral')
    expect(normalizeCoachName('Juan-José Mieres')).toBe('juan jose mieres')
  })
  it('returns empty string for punctuation-only input', () => {
    expect(normalizeCoachName(' - ')).toBe('')
  })
})

describe('coachTokens', () => {
  it('drops 1-char tokens', () => {
    expect(coachTokens('sandy f')).toEqual(['sandy'])
    expect(coachTokens('juan jose gutierrez')).toEqual(['juan', 'jose', 'gutierrez'])
  })
})

describe('slugifyCoach / uniqueSlug', () => {
  it('slugifies', () => {
    expect(slugifyCoach('Agustín Gómez Silingo')).toBe('agustin-gomez-silingo')
  })
  it('dedupes against taken slugs', () => {
    const taken = new Set(['juan-alday', 'juan-alday-2'])
    expect(uniqueSlug('juan-alday', taken)).toBe('juan-alday-3')
    expect(taken.has('juan-alday-3')).toBe(true)
    expect(uniqueSlug('pablo-pesce', taken)).toBe('pablo-pesce')
  })
  it('falls back to "coach" for an empty slug', () => {
    expect(uniqueSlug(slugifyCoach('-'), new Set())).toBe('coach')
  })
})

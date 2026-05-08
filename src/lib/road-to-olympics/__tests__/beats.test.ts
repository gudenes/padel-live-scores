// src/lib/road-to-olympics/__tests__/beats.test.ts
import { describe, it, expect } from 'vitest'
import { isOlympicArticle, OLYMPIC_KEYWORD_REGEX } from '../beats'

describe('isOlympicArticle', () => {
  it('matches "olympic" case-insensitive', () => {
    expect(isOlympicArticle({
      title: 'Padel eyes Olympic inclusion',
      summary: null,
    })).toBe(true)
    expect(isOlympicArticle({
      title: 'OLYMPICS news',
      summary: null,
    })).toBe(true)
  })

  it('matches "ioc"', () => {
    expect(isOlympicArticle({
      title: 'IOC Session preview',
      summary: null,
    })).toBe(true)
  })

  it('matches "Brisbane 2032"', () => {
    expect(isOlympicArticle({
      title: 'Brisbane 2032 sports programme',
      summary: null,
    })).toBe(true)
  })

  it('matches "Aichi-Nagoya"', () => {
    expect(isOlympicArticle({
      title: 'Aichi-Nagoya 2026 Asian Games',
      summary: null,
    })).toBe(true)
  })

  it('matches in summary when title is generic', () => {
    expect(isOlympicArticle({
      title: 'New tournament announcement',
      summary: 'The event will count toward the IOC criteria.',
    })).toBe(true)
  })

  it('does not match unrelated padel news', () => {
    expect(isOlympicArticle({
      title: 'Premier Padel Cairo P2 results',
      summary: 'Lebron / Galan defeat Coello / Tapia in three sets',
    })).toBe(false)
  })

  it('does not match the substring "olympic" inside another word like "metropolitan"', () => {
    expect(isOlympicArticle({
      title: 'Metropolitan padel club opens',
      summary: 'New venue in city centre',
    })).toBe(false)
  })
})

describe('OLYMPIC_KEYWORD_REGEX', () => {
  it('is case-insensitive', () => {
    expect('Olympic'.match(OLYMPIC_KEYWORD_REGEX)).not.toBeNull()
    expect('OLYMPIC'.match(OLYMPIC_KEYWORD_REGEX)).not.toBeNull()
  })
})

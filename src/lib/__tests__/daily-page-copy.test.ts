// src/lib/__tests__/daily-page-copy.test.ts

import { describe, it, expect } from 'vitest'
import { buildDailyIntro, buildDailyFaq, type DailyMatchSummary } from '../daily-page-copy'

const mkMatch = (overrides: Partial<DailyMatchSummary> = {}): DailyMatchSummary => ({
  status: 'scheduled',
  scheduledAt: '2026-04-17T14:00:00Z',
  tournament: { name: 'Miami P1', level: 'p1' },
  featuredPlayer: null,
  ...overrides,
})

describe('buildDailyIntro', () => {
  it('returns no-matches h1 + lead when the day is empty', () => {
    const result = buildDailyIntro({
      iso: '2026-04-17',
      locale: 'en',
      dateLong: 'April 17, 2026',
      matches: [],
    })
    expect(result.h1).toContain('April 17, 2026')
    expect(result.h1).not.toContain('(0 matches)')
    expect(result.lead).toContain('No professional padel')
  })

  it('includes match count and event name in English h1', () => {
    const result = buildDailyIntro({
      iso: '2026-04-17',
      locale: 'en',
      dateLong: 'April 17, 2026',
      matches: [mkMatch(), mkMatch(), mkMatch()],
    })
    expect(result.h1).toBe('Padel matches today — April 17, 2026 (3 matches)')
    expect(result.lead).toContain('3 padel matches')
    expect(result.lead).toContain('Miami P1')
  })

  it('joins two tournaments with locale-specific joiner in Spanish', () => {
    const result = buildDailyIntro({
      iso: '2026-04-17',
      locale: 'es',
      dateLong: '17 de abril de 2026',
      matches: [
        mkMatch({ tournament: { name: 'Miami P1' } }),
        mkMatch({ tournament: { name: 'FIP Gold Almaty' } }),
      ],
    })
    expect(result.h1).toBe('Partidos de pádel hoy — 17 de abril de 2026 (2 partidos)')
    expect(result.lead).toContain('Miami P1 y FIP Gold Almaty')
  })

  it('joins three tournaments with commas + locale joiner in Portuguese', () => {
    const result = buildDailyIntro({
      iso: '2026-04-17',
      locale: 'pt',
      dateLong: '17 de abril de 2026',
      matches: [
        mkMatch({ tournament: { name: 'Miami P1' } }),
        mkMatch({ tournament: { name: 'Almaty' } }),
        mkMatch({ tournament: { name: 'Riyadh P1' } }),
      ],
    })
    expect(result.lead).toContain('Miami P1, Almaty e Riyadh P1')
  })

  it('picks the highest-ranked featured player across matches', () => {
    const result = buildDailyIntro({
      iso: '2026-04-17',
      locale: 'es',
      dateLong: '17 de abril de 2026',
      matches: [
        mkMatch({ featuredPlayer: { name: 'Juan López', ranking: 42 } }),
        mkMatch({ featuredPlayer: { name: 'Arturo Coello', ranking: 1 } }),
        mkMatch({ featuredPlayer: { name: 'María García', ranking: 8 } }),
      ],
    })
    expect(result.lead).toContain('Arturo Coello')
    expect(result.lead).not.toContain('Juan López')
  })

  it('deduplicates tournament names that repeat across matches', () => {
    const result = buildDailyIntro({
      iso: '2026-04-17',
      locale: 'en',
      dateLong: 'April 17, 2026',
      matches: [mkMatch(), mkMatch(), mkMatch()],
    })
    // "Miami P1" should appear exactly once in the lead, not three times
    const occurrences = (result.lead.match(/Miami P1/g) || []).length
    expect(occurrences).toBe(1)
  })

  it('falls back to English phrases for unknown locale', () => {
    const result = buildDailyIntro({
      iso: '2026-04-17',
      locale: 'de',
      dateLong: 'April 17, 2026',
      matches: [mkMatch()],
    })
    expect(result.h1).toContain('Padel matches today')
  })

  it('skips featured-player lead when no player has a ranking', () => {
    const result = buildDailyIntro({
      iso: '2026-04-17',
      locale: 'en',
      dateLong: 'April 17, 2026',
      matches: [
        mkMatch({ featuredPlayer: { name: 'Nobody', ranking: null } }),
        mkMatch({ featuredPlayer: null }),
      ],
    })
    expect(result.lead).not.toContain('Nobody')
    expect(result.lead).toContain('Follow live scores')
  })
})

describe('buildDailyFaq', () => {
  it('always includes the count question and live question', () => {
    const faqs = buildDailyFaq({
      iso: '2026-04-17',
      locale: 'en',
      dateLong: 'April 17, 2026',
      matches: [],
    })
    expect(faqs.map(f => f.q)).toContain('How many padel matches are there today?')
    expect(faqs.map(f => f.q)).toContain('Can I watch today\'s padel matches live?')
  })

  it('includes the featured-player question when a player is featured', () => {
    const faqs = buildDailyFaq({
      iso: '2026-04-17',
      locale: 'es',
      dateLong: '17 de abril de 2026',
      matches: [mkMatch({ featuredPlayer: { name: 'Arturo Coello', ranking: 1 } })],
    })
    const hasPlayerQ = faqs.some(f => f.q.includes('Arturo Coello'))
    expect(hasPlayerQ).toBe(true)
  })

  it('omits the featured-player FAQ when nobody is featured', () => {
    const faqs = buildDailyFaq({
      iso: '2026-04-17',
      locale: 'en',
      dateLong: 'April 17, 2026',
      matches: [mkMatch()],
    })
    const hasPlayerQ = faqs.some(f => f.q.toLowerCase().includes('when does'))
    expect(hasPlayerQ).toBe(false)
  })

  it('omits the tournaments FAQ on empty days', () => {
    const faqs = buildDailyFaq({
      iso: '2026-04-17',
      locale: 'en',
      dateLong: 'April 17, 2026',
      matches: [],
    })
    const hasEventsQ = faqs.some(f => f.q.toLowerCase().includes('tournaments'))
    expect(hasEventsQ).toBe(false)
  })

  it('always has at least 2 items and at most 4', () => {
    const full = buildDailyFaq({
      iso: '2026-04-17',
      locale: 'en',
      dateLong: 'April 17, 2026',
      matches: [mkMatch({ featuredPlayer: { name: 'Coello', ranking: 1 } })],
    })
    expect(full.length).toBe(4)

    const empty = buildDailyFaq({
      iso: '2026-04-17',
      locale: 'en',
      dateLong: 'April 17, 2026',
      matches: [],
    })
    expect(empty.length).toBe(2)
  })

  it('returns Portuguese phrases for pt locale', () => {
    const faqs = buildDailyFaq({
      iso: '2026-04-17',
      locale: 'pt',
      dateLong: '17 de abril de 2026',
      matches: [mkMatch()],
    })
    const countQ = faqs[0].q
    expect(countQ).toBe('Quantos jogos de padel acontecem hoje?')
  })
})

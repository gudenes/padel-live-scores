// apps/ops/tests/seo-url-classifier.test.ts
import { describe, it, expect } from 'vitest'
import { parseLocaleFromUrl } from '../src/lib/seo/url-classifier'

describe('parseLocaleFromUrl', () => {
  it('classifies English root as home/en', () => {
    expect(parseLocaleFromUrl('https://padelnachos.com/')).toEqual({ locale: 'en', page_type: 'home' })
  })

  it('classifies /home as home/en', () => {
    expect(parseLocaleFromUrl('https://padelnachos.com/home')).toEqual({ locale: 'en', page_type: 'home' })
  })

  it('classifies /es/home as home/es', () => {
    expect(parseLocaleFromUrl('https://padelnachos.com/es/home')).toEqual({ locale: 'es', page_type: 'home' })
  })

  it('classifies /pt/matches/2026-05-24 as matches/pt', () => {
    expect(parseLocaleFromUrl('https://padelnachos.com/pt/matches/2026-05-24'))
      .toEqual({ locale: 'pt', page_type: 'matches' })
  })

  it('classifies /match/abc-123 as match/en', () => {
    expect(parseLocaleFromUrl('https://padelnachos.com/match/abc-123'))
      .toEqual({ locale: 'en', page_type: 'match' })
  })

  it('classifies /it/player/coello as player/it', () => {
    expect(parseLocaleFromUrl('https://padelnachos.com/it/player/coello'))
      .toEqual({ locale: 'it', page_type: 'player' })
  })

  it('classifies /tournaments/p1-rome-2026 as tournament/en', () => {
    expect(parseLocaleFromUrl('https://padelnachos.com/tournaments/p1-rome-2026'))
      .toEqual({ locale: 'en', page_type: 'tournament' })
  })

  it('classifies /fr/news/some-slug as news/fr', () => {
    expect(parseLocaleFromUrl('https://padelnachos.com/fr/news/some-slug'))
      .toEqual({ locale: 'fr', page_type: 'news' })
  })

  it('classifies unrecognised path as other/en', () => {
    expect(parseLocaleFromUrl('https://padelnachos.com/about'))
      .toEqual({ locale: 'en', page_type: 'other' })
  })

  it('strips query string before classifying', () => {
    expect(parseLocaleFromUrl('https://padelnachos.com/es/home?utm=x'))
      .toEqual({ locale: 'es', page_type: 'home' })
  })

  it('rejects "en" as a prefix (English is unprefixed)', () => {
    // /en/home should NOT exist on the site; if it appears, treat as other/en
    expect(parseLocaleFromUrl('https://padelnachos.com/en/home'))
      .toEqual({ locale: 'en', page_type: 'other' })
  })

  it('classifies bare /es (no trailing slash) as other/es', () => {
    expect(parseLocaleFromUrl('https://padelnachos.com/es'))
      .toEqual({ locale: 'es', page_type: 'other' })
  })

  it('returns en/other for a malformed URL', () => {
    expect(parseLocaleFromUrl('not a valid url'))
      .toEqual({ locale: 'en', page_type: 'other' })
  })
})

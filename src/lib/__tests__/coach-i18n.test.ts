import { describe, it, expect } from 'vitest'
import { createTranslator } from 'next-intl'
import en from '../../messages/en.json'
import es from '../../messages/es.json'
import pt from '../../messages/pt.json'
import it_ from '../../messages/it.json'
import fr from '../../messages/fr.json'

const locales = { en, es, pt, it: it_, fr } as const

const samples: Record<string, Record<string, string | number>> = {
  pageLabel: {},
  rankChip: { rank: 1 },
  subtitle: { players: 9, titles: 2, year: 2026 },
  menPoints: {},
  womenPoints: {},
  playersCount: { count: 3 },
  nextMatches: {},
  live: {},
  players: {},
  men: {},
  women: {},
  titles: { year: 2026 },
  titlesFootnote: {},
  showMore: { count: 3 },
  indexTitle: {},
  indexIntro: {},
  tabOverall: {},
  tabMen: {},
  tabWomen: {},
  loadMore: {},
  metaTitle: { name: 'Gustavo Pratto' },
  metaDescription: { name: 'Gustavo Pratto', players: 'Tapia, Coello' },
  indexMetaTitle: {},
  indexMetaDescription: {},
  rankingsLink: {},
  vs: {},
  indexEmpty: {},
  previous: {},
}

describe('coach i18n namespace', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    describe(locale, () => {
      const t = createTranslator({ locale, messages: messages as never, namespace: 'coach' } as never) as unknown as (
        key: string,
        values?: Record<string, string | number>,
      ) => string

      it('formats every key to a non-empty string', () => {
        for (const [key, values] of Object.entries(samples)) {
          const out = t(key, values)
          expect(typeof out).toBe('string')
          expect(out.length).toBeGreaterThan(0)
        }
      })

      it('has no keys outside the sample list', () => {
        expect(Object.keys((messages as { coach: object }).coach).sort()).toEqual(Object.keys(samples).sort())
      })

      it('subtitle differs between 0 and 2 titles', () => {
        expect(t('subtitle', { players: 9, titles: 0, year: 2026 })).not.toBe(t('subtitle', { players: 9, titles: 2, year: 2026 }))
      })
    })
  }
})

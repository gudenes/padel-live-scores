// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createTranslator } from 'next-intl'
import { racketBalanceKey } from '../PlaysWithCard'
import en from '../../../../../messages/en.json'
import es from '../../../../../messages/es.json'
import pt from '../../../../../messages/pt.json'
import it_ from '../../../../../messages/it.json'
import fr from '../../../../../messages/fr.json'

describe('racketBalanceKey', () => {
  it('maps both balance vocabularies onto the translated keys', () => {
    expect(racketBalanceKey('high')).toBe('head-heavy')
    expect(racketBalanceKey('medium')).toBe('balanced')
    expect(racketBalanceKey('low')).toBe('head-light')
    expect(racketBalanceKey('head-heavy')).toBe('head-heavy')
    expect(racketBalanceKey(' Balanced ')).toBe('balanced')
  })
  it('returns null for unknown values so the raw value is shown', () => {
    expect(racketBalanceKey('weird')).toBeNull()
  })
})

describe('player profile strings exist and format in every locale', () => {
  const locales = { en, es, pt, it: it_, fr } as const
  for (const [locale, messages] of Object.entries(locales)) {
    it(locale, () => {
      const t = createTranslator({ locale, messages, namespace: 'player' })
      for (const k of ['head-heavy', 'balanced', 'head-light'] as const) expect(t(`balance_${k}`)).toBeTruthy()
      expect(t('currentPartner')).toBeTruthy()
      const one = t('partnerMatchesLine', { count: 1, wins: 1, losses: 0, date: 'D' })
      const many = t('partnerMatchesLine', { count: 12, wins: 9, losses: 3, date: 'D' })
      expect(one).toMatch(/^1 \S+ · 1-0 · \S+ D$/)
      expect(many).toMatch(/^12 \S+ · 9-3 · \S+ D$/)
      expect(one).not.toBe(many.replace('12', '1').replace('9-3', '1-0'))
      expect(t('firstMatchTogether', { date: 'D' })).toMatch(/ D$/)
    })
  }
})

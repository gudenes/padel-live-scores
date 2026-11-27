import { describe, expect, it } from 'vitest'
import { createTranslator, type AbstractIntlMessages } from 'next-intl'
import { competitionRoundLabel, competitionCourtLabel, localizedRegionName } from '../competition-display'
import { buildMatchSummary } from '../seo/match-summary'
import { buildTournamentResults } from '../seo/tournament-results'
import { buildSeoSummary } from '../where-to-watch/build-seo-summary'
import en from '../../messages/en.json'
import es from '../../messages/es.json'
import fr from '../../messages/fr.json'
import it_ from '../../messages/it.json'
import pt from '../../messages/pt.json'

type TestTranslator = (key: string, values?: Record<string, string | number>) => string
const locales = { en, es, fr, it: it_, pt }
for (const [locale, messages] of Object.entries(locales)) {
  describe(locale, () => {
    const errors: unknown[] = []
    const t = createTranslator({ locale, messages: messages as AbstractIntlMessages, namespace: 'competitionLabels', onError: e => errors.push(e) }) as unknown as TestTranslator
    it('formats all labels, ICU plurals and known provider rounds without missing keys', () => {
      for (const [key, value] of Object.entries(messages.competitionLabels)) {
        if (typeof value === 'string') expect(t(key, { count: 2, date: '2026-04-26' })).not.toContain('competitionLabels.')
      }
      for (const aliases of [['F', 'Final', 'Finals'], ['SF', 'SemiFinals', 'semi-finals'], ['QF', 'Quarterfinals', 'quarter finals'], ['R16', 'Round of 16'], ['R128', 'Round of 128'], ['Q1'], ['Q2'], ['Q3']]) {
        for (const alias of aliases) expect(competitionRoundLabel(alias, t)).toBe(t(`rounds.${aliases[0]}`))
      }
      expect(competitionRoundLabel('provider_unknown_99', t)).toBe('—')
      expect(competitionRoundLabel(null, t)).toBe('')
      expect(t('matchCount', { count: 1 })).not.toBe(t('matchCount', { count: 2 }))
      expect(errors).toEqual([])
    })
    it('preserves court sponsors while translating generic prefixes', () => {
      expect(competitionCourtLabel('COURT CBC', t)).toBe(`${t('court')} CBC`)
      expect(competitionCourtLabel('Nextensa', t)).toBe('Nextensa')
      expect(competitionCourtLabel(null, t)).toBe('')
    })
    it('localizes summary sentences, status suffixes and broadcaster countries', () => {
      const summary = buildMatchSummary({ status: 'finished', round: competitionRoundLabel('SF', t), winner_pair: 1, scheduled_at: '2026-04-26', finished_at: null, pair1: { names: ['A One'] }, pair2: { names: ['B Two'] }, sets: [], tournament: { name: 'Brussels', country: localizedRegionName('BE', locale), level: 'P2' } }, t)
      expect(summary.headline).toContain(t('defeated'))
      expect(summary.headline).toContain(t('rounds.SF'))
      expect(summary.facts[0]).toContain(t('tournament'))
      const results = buildTournamentResults([{ id: '1', status: 'retired', round: 'F', category: 'men', winner_pair: 1, finished_at: null, scheduled_at: null, pair1: [{ id: 'a', name: 'A One' }], pair2: [{ id: 'b', name: 'B Two' }], sets: [] }], { translate: t })
      expect(results.rows[0].headline).toBe(`One ${t('beat')} Two (${t('retired')})`)
      expect(buildSeoSummary({ locale, broadcasters: [{ name: 'TV', country_iso2: 'es' }] }).named[0].countriesShown).toEqual([localizedRegionName('ES', locale)])
    })
    it('formats the legacy locked prediction without exposing keys', () => {
      const p = createTranslator({ locale, messages: messages as AbstractIntlMessages, namespace: 'prediction', onError: e => errors.push(e) }) as unknown as TestTranslator
      expect(p('yourPrediction')).not.toContain('prediction.')
      expect(p('locked')).not.toContain('prediction.')
      expect(p('win', { pair: 'A / B', margin: '2-0' })).toContain('A / B')
      expect(errors).toEqual([])
    })
  })
}

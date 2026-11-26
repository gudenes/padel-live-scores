import { describe, expect, it } from 'vitest'
import { createTranslator } from 'next-intl'
import { playerBestRound, playerCircuit, playerLevelLabel, playerRoundCode, playerRoundLabel, playerStatsBreakdown } from '../player-display'
import { buildPlayerSummary } from '../seo/player-summary'
import type { MatchRowForTitles } from '../derive-titles'
import en from '../../messages/en.json'
import es from '../../messages/es.json'
import fr from '../../messages/fr.json'
import itMessages from '../../messages/it.json'
import pt from '../../messages/pt.json'

const match = (round: string, level: string, won: boolean): MatchRowForTitles => ({
  id: round, round, status: 'finished', winner_pair: won ? 1 : 2,
  pair1_player1: { id: 'p1' }, pair1_player2: null, pair2_player1: { id: 'p2' }, pair2_player2: null,
  tournament: { id: 't', name: 'Tournament', level },
  finished_at: '2026-01-01', scheduled_at: null, played_at: null,
})

describe('player display normalization', () => {
  it.each(['Semifinals', 'SemiFinals', 'Semi-final', 'Semi finals', 'SF'])('normalizes %s', round => {
    expect(playerRoundCode(round)).toBe('SF')
  })
  it('selects the deepest round across provider formats', () => {
    expect(playerBestRound([{ round: 'Round of 32' }, { round: 'Quarter-finals' }, { round: 'R16' }])).toBe('QF')
    expect(playerRoundCode('Round of 128')).toBe('R128')
    expect(playerRoundCode('unrecognized.key')).toBeNull()
  })
  it('combines round aliases without losing results', () => {
    const rows = [match('R16', 'fip_bronze', true), match('Round of 16', 'fip_silver', false)]
    expect(playerStatsBreakdown(rows, 'p1', 'round')).toEqual([['R16', { wins: 1, losses: 1 }]])
    expect(playerStatsBreakdown(rows, 'p1', 'circuit')).toEqual([['FIP', { wins: 1, losses: 1 }]])
  })
  it('keeps separate circuits and ignores unresolved outcomes', () => {
    const rows = [match('F', 'premier_p2', true), match('F', 'ppl', false), { ...match('F', 'fip_gold', true), winner_pair: null }]
    expect(playerStatsBreakdown(rows, 'p1', 'circuit')).toEqual([['Premier Padel', { wins: 1, losses: 0 }], ['PPL', { wins: 0, losses: 1 }]])
    expect(playerCircuit('wpt_master')).toBe('World Padel Tour')
    expect(playerCircuit('unknown')).toBe('Other')
  })
})

for (const [locale, messages] of Object.entries({ en, es, fr, it: itMessages, pt })) {
  describe(`player labels: ${locale}`, () => {
    const errors: Error[] = []
    const t = createTranslator({ locale, messages, namespace: 'player', onError: e => { errors.push(e) } })
    it('formats new labels and dynamic rounds without translation errors', () => {
      const keys = ['goBack', 'viewSeasonTitles', 'men', 'women', 'world', 'ranked', 'oldest', 'latest', 'fipRanking', 'pointsShort', 'profileInfo', 'noPartners', 'winShort', 'lossShort', 'live', 'liveShort', 'retiredShort', 'walkoverShort', 'noPartner', 'noMatches', 'loadMoreTournaments', 'noFinishedMatches', 'career', 'byRound', 'byCircuit', 'finals', 'other', 'ytdEarnings', 'earningsTabNewPill']
      for (const key of keys) expect(t(key)).not.toContain('player.')
      expect(t('allPartners', { count: 3 })).toContain('3')
      expect(t('withPartnerShort', { name: 'Oscar' })).toContain('Oscar')
      expect(t('ytdEarningsCard', { year: 2026 })).toContain('2026')
      for (const round of ['W', 'F', 'SF', 'QF', 'R16', 'R32', 'R64', 'R128', 'Q1', 'Q2', 'Q3', 'Round of 16', null, 'bad.provider.key']) {
        expect(playerRoundLabel(round, t)).not.toContain('player.')
      }
      expect(playerRoundLabel('bad.provider.key', t)).toBe(t('other'))
      expect(playerLevelLabel('bad_provider_key', t)).toBe(t('other'))
      expect(playerLevelLabel('wpt_master', t)).toBe('World Padel Tour')
      expect(errors).toEqual([])
    })
    it('localizes the accessible player summary', () => {
      const summary = buildPlayerSummary({ name: 'Oscar', country: 'Denmark', category: 'men', ranking: 363, tier: 'pro', total_matches: 24, win_rate: 54, recent: [] }, t)
      expect(summary.headline).toContain('Oscar')
      expect(summary.facts).toContain(`${t('currentRanking')}: #363 (${t('men')})`)
      expect(errors).toEqual([])
    })
  })
}

import { describe, it, expect } from 'vitest'
import type { Match } from '@/types/match'
import { CUP_DAYS, cupPairOrder, pairCountry, cupTieScore, cupMatchDay, groupCupMatches } from '../world-cup-matches'
import { cupSeed } from '../world-cup'
const match = (id: string, a = 'ESP', b = 'SWE', extra = {}) => ({
  id, category: 'men', scheduled_at: '2026-11-03T15:00:00Z', round: 'Group stage',
  pair1_player1_country: a, pair1_player2_country: a,
  pair2_player1_country: b, pair2_player2_country: b, ...extra,
}) as unknown as Match

describe('World Cup presentation', () => {
  it('groups reversed country orientations together and preserves court order', () => {
    const rows = [match('second', 'SE', 'ES', { court_order: 2 }), match('first', 'ESP', 'SWE', { court_order: 1 })]
    const groups = groupCupMatches(rows, 'men', '2026-11-03')
    expect(groups).toHaveLength(1)
    expect(groups[0].countries).toEqual(['ES', 'SE'])
    expect(groups[0].matches.map(m => m.id)).toEqual(['first', 'second'])
  })
  it('prefers the represented country over a player profile nationality', () => {
    const row = match('expat', 'UAE', 'ESP', {pair1_player1:{country:'ES'},pair1_player2:{country:'ES'}})
    expect(groupCupMatches([row], 'men', '2026-11-03')[0].countries).toEqual(['AE','ES'])
  })
  it('separates date, category and round', () => {
    const rows = [match('one'), match('tomorrow', 'ESP', 'SWE', { scheduled_at:'2026-11-04T15:00:00Z' }), match('women', 'ESP','SWE',{category:'women'}), match('other-round', 'ESP','SWE',{round:'Final'})]
    expect(groupCupMatches(rows, 'men', '2026-11-03')).toHaveLength(2)
  })
  it('does not combine unknown or inconsistent countries into a guessed tie', () => {
    const rows = [match('unknown', '', ''), match('mixed', 'ESP', 'SWE', {pair1_player2_country:'ARG'})]
    expect(groupCupMatches(rows, 'men', '2026-11-03').map(g=>g.countries)).toEqual([null,null])
  })
  it('uses Qatar calendar dates and retains undated fixtures separately', () => {
    expect(cupMatchDay(match('late', 'ESP','SWE',{scheduled_at:'2026-11-02T22:00:00Z'}))).toBe('2026-11-03')
    expect(groupCupMatches([match('unknown', 'ESP','SWE',{scheduled_at:null})], 'men', null)).toHaveLength(1)
  })
  it('includes all six days and only assigns verified leading seeds', () => {
    expect(CUP_DAYS).toHaveLength(6)
    expect(CUP_DAYS[5].stage).toBe('finals')
    expect(cupSeed('ARG','men')).toBe(1)
    expect(cupSeed('ESP','women')).toBe(1)
    expect(cupSeed('GER','men')).toBeNull()
  })
})

describe('country tie score', () => {
  it('counts completed rubbers in country order even when pairs are reversed', () => {
    const rows = [match('one','ESP','SWE',{status:'finished',winner_pair:1}), match('two','SWE','ESP',{status:'finished',winner_pair:2}), match('three','SWE','ESP',{status:'scheduled',winner_pair:null})]
    expect(cupTieScore(groupCupMatches(rows,'men','2026-11-03')[0])).toEqual([2,0])
  })
  it('does not invent a result for unplayed matches', () => {
    expect(cupTieScore(groupCupMatches([match('one','ESP','SWE',{status:'scheduled',winner_pair:null})],'men','2026-11-03')[0])).toBeNull()
  })
})

describe('World Cup player row presentation', () => {
  it('aligns reversed player and score rows with the country header', () => {
    const row = match('portugal-netherlands', 'POR', 'NED')
    expect(cupPairOrder(row, ['NL', 'PT'])).toEqual([2, 1])
    expect(cupPairOrder(row, ['PT', 'NL'])).toEqual([1, 2])
    expect(cupPairOrder(row)).toEqual([1, 2])
  })
  it('uses represented Netherlands even when player profiles contain Niger', () => {
    const row = match('bad-profile', 'POR', 'NED', {pair2_player1:{country:'NE'},pair2_player2:{country:'NE'}})
    expect(pairCountry(row, 2)).toBe('NL')
    expect(cupPairOrder(row, ['NL', 'PT'])).toEqual([2, 1])
  })
})

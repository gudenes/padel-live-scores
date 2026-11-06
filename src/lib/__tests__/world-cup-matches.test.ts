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

import { cupQuarterBracket, cupCountryPriority } from '../world-cup-matches'
import type { CupData } from '../world-cup'
describe('quarterfinal placement', () => {
  const data = { groups: [{category:'women', teams:[{country:'ESP'},{country:'BRA'},{country:'GBR'},{country:'GER'}]}] } as CupData
  it('uses the published tie-break order even when group points are tied', () => {
    expect(cupQuarterBracket(['ES','BR'],'women',data)).toBe('title')
    expect(cupQuarterBracket(['GB','DE'],'women',data)).toBe('placement')
    expect(cupQuarterBracket(['ES','DE'],'women',data)).toBe('unknown')
    expect(cupQuarterBracket(['ES','BR'],'men',data)).toBe('unknown')
  })
  it('puts Argentina then Spain before the other title contenders', () => {
    expect([['IT','BR'],['ES','SE'],['AR','PT']].sort((a,b)=>cupCountryPriority(a)-cupCountryPriority(b))[0]).toEqual(['AR','PT'])
  })
})
import { cupSemiBracket } from '../world-cup-matches'
describe('semifinal placement from completed quarterfinals', () => {
  const data = {groups:[
    {category:'men',teams:[{country:'AR'},{country:'ES'},{country:'GB'},{country:'DE'}]},
    {category:'men',teams:[{country:'IT'},{country:'BR'},{country:'US'},{country:'CL'}]},
  ]} as CupData
  const rows = [['AR','IT'],['ES','BR'],['GB','US'],['DE','CL']].flatMap(([a,b],i)=>
    [1,2].map(n=>match(i+'-'+n,a,b,{scheduled_at:'2026-11-05T12:00:00Z',status:'finished',winner_pair:1})))
  const quarters=groupCupMatches(rows,'men','2026-11-05')
  it.each([
    [['AR','ES'],'places1to4'],[['IT','BR'],'places5to8'],
    [['GB','DE'],'places9to12'],[['US','CL'],'places13to16'],
  ])('assigns %j to %s', (countries,expected)=>{
    expect(cupSemiBracket(countries as string[],'men',data,quarters)).toBe(expected)
  })
  it('waits for missing results and rejects incompatible brackets',()=>{
    expect(cupSemiBracket(['AR','ES'],'men',data,[])).toBe('bracketPending')
    expect(cupSemiBracket(['AR','BR'],'men',data,quarters)).toBe('bracketPending')
  })
})
import { cupBroadcastOnDay } from '../world-cup-matches'
import type { CupTie } from '../world-cup'
describe('knockout broadcast dates', () => {
  const stale = { category:'women', group:'D', scheduledAt:null, liveObservedAt:'2026-11-06T11:00:00Z' } as CupTie
  it('does not promote a group replay observed today to a semifinal', () => {
    expect(cupBroadcastOnDay(stale,'women','2026-11-06')).toBe(false)
    expect(cupBroadcastOnDay({...stale,group:null},'women','2026-11-06')).toBe(false)
  })
  it('accepts an explicitly scheduled knockout broadcast', () => {
    expect(cupBroadcastOnDay({...stale,group:null,scheduledAt:'2026-11-06T11:00:00Z'},'women','2026-11-06')).toBe(true)
  })
})

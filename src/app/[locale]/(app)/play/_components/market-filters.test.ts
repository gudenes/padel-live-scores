import { describe, expect, it } from 'vitest'
import { filterMarkets, unplayedFirst } from './market-filters'
import type { PlayMarket } from './types'

const market = (id: string, values: Partial<PlayMarket>) => ({ id, horizon: 'match', live: false, ...values }) as PlayMarket
const now = new Date(2026, 8, 26, 15)
const markets = [
  market('today', { startsAt: new Date(2026, 8, 26, 23).toISOString() }),
  market('tomorrow', { startsAt: new Date(2026, 8, 27, 0).toISOString() }),
  market('unknown', { startsAt: null }),
  market('live', { horizon: 'live', live: true }),
  market('tournament', { horizon: 'tourn' }),
  market('season', { horizon: 'season' }),
]
describe('market filters', () => {
  it('includes local-day matches and live matches, without treating unknown starts as today', () => {
    expect(filterMarkets(markets, 'today', now).map(m => m.id)).toEqual(['today', 'live'])
  })
  it('keeps the three time horizons distinct and preserves all markets', () => {
    expect(filterMarkets(markets, 'tourn', now).map(m => m.id)).toEqual(['tournament'])
    expect(filterMarkets(markets, 'season', now).map(m => m.id)).toEqual(['season'])
    expect(filterMarkets(markets, 'all', now)).toEqual(markets)
  })
})

it('combines time, competition and category without guessing missing metadata', () => {
  const dated = { startsAt: new Date(2026, 8, 26, 20).toISOString() }
  const list = [market('a', { ...dated, competition: 'Lyon', category: 'women' }), market('b', { ...dated, competition: 'Lyon', category: 'men' }), market('unknown', dated)]
  expect(filterMarkets(list, 'today', now, { competition: 'Lyon', category: 'women' }).map(m => m.id)).toEqual(['a'])
  expect(filterMarkets(list, 'all', now, { competition: '', category: '' })).toHaveLength(3)
})

it('shows scheduled, undated and live match markets in the Matches tab',()=>{
 expect(filterMarkets(markets,'match',now).map(m=>m.id)).toEqual(['today','tomorrow','unknown','live'])
})
it('puts unplayed markets first without changing order within groups or mutating inputs',()=>{
 const positions=[{marketId:'today',shares:10},{marketId:'unknown',shares:5},{marketId:'tomorrow',shares:0}] as import('./types').PlayPosition[]
 expect(unplayedFirst(markets,positions).map(m=>m.id)).toEqual(['tomorrow','live','tournament','season','today','unknown'])
 expect(markets[0].id).toBe('today')
 expect(unplayedFirst(markets,[])).toEqual(markets)
})

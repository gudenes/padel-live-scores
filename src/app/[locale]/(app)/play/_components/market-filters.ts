import type { PlayMarket } from './types'

export type MarketFilter = 'all' | 'today' | 'tourn' | 'season'

export interface MarketFacets { competition: string; category: string }
export const EMPTY_FACETS: MarketFacets = { competition: '', category: '' }

/** Today follows the viewer's local calendar; an unknown start is not today. */
export function filterMarkets(markets: PlayMarket[], filter: MarketFilter, now = new Date(), facets: MarketFacets = EMPTY_FACETS) {
  return markets.filter(market => {
    if (facets.competition && market.competition !== facets.competition) return false
    if (facets.category && market.category !== facets.category) return false
    if (filter === 'all') return true
    if (filter !== 'today') return market.horizon === filter
    if (market.horizon !== 'match' && market.horizon !== 'live') return false
    if (market.live) return true
    return !!market.startsAt && new Date(market.startsAt).toDateString() === now.toDateString()
  })
}

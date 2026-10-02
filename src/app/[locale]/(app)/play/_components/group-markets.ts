import type { PlayMarket, PlayPosition } from './types'

/** Group by the match identity, never by player names or translated copy. */
export function groupMarkets(markets: PlayMarket[], positions: PlayPosition[]) {
  const groups = new Map<string, PlayMarket[]>()
  const held = new Set(positions.filter(p => p.shares > 0).map(p => p.marketId))
  for (const market of markets) {
    const key = market.matchId && !market.editorial ? `match:${market.matchId}` : `market:${market.id}`
    const group = groups.get(key) ?? []
    group.push(market)
    groups.set(key, group)
  }
  const entries = [...groups].map(([id, questions]) => ({ id, questions,
    fullyPlayed: questions.every(m => held.has(m.id)) }))
  return [...entries.filter(g => !g.fullyPlayed), ...entries.filter(g => g.fullyPlayed)]
}

'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import MarketCard from './MarketCard'
import type { PlayMarket, PlayPosition, Side } from './types'

export default function MarketFeed({ markets, positions, onViewPositions, onChoose, onDetail }: {
  markets: PlayMarket[]
  positions: PlayPosition[]
  onViewPositions: () => void
  onChoose: (market: PlayMarket, side: Side) => void
  onDetail: (market: PlayMarket) => void
}) {
  const t = useTranslations('play')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  return <div className="pl-natural-feed" role="region" aria-label={t('subnav.markets')} tabIndex={0}>
    {markets.map(market => {
      const held = positions.filter(position => position.marketId === market.id && position.shares > 0)
      const collapsed = held.length > 0 && !expanded.has(market.id)
      return <div className="pl-market-group" key={market.id}><article className={`pl-mcard${collapsed ? ' pl-card-collapsed' : ''}`} key={market.id} aria-label={market.question}>
        <MarketCard market={market} positions={held} onViewPositions={onViewPositions} onDetail={onDetail} onChoose={side => onChoose(market, side)}
          collapsed={collapsed}
          onToggleExpanded={held.length ? () => setExpanded(previous => {
            const next = new Set(previous)
            if (next.has(market.id)) next.delete(market.id)
            else next.add(market.id)
            return next
          }) : undefined}
        />
      </article>
      </div>
    })}
  </div>
}

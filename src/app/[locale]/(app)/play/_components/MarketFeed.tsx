'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import MarketCard from './MarketCard'
import MatchMarketCard from './MatchMarketCard'
import { groupMarkets } from './group-markets'
import type { ConfirmedTrade } from './ConfirmScreen'
import type { PlayMarket, PlayPosition, Side } from './types'

export default function MarketFeed({ markets, positions, onViewPositions, onChoose, onDetail, completedTrade }: {
  completedTrade?: ConfirmedTrade | null
  markets: PlayMarket[]
  positions: PlayPosition[]
  onViewPositions: () => void
  onChoose: (market: PlayMarket, side: Side) => void
  onDetail: (market: PlayMarket) => void
}) {
  const t = useTranslations('play')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const feed = useRef<HTMLDivElement>(null)
  const resume = useRef<{marketId: string; shares: number; candidates: string[]} | null>(null)
  const handled = useRef<ConfirmedTrade | null>(null)
  const groups = groupMarkets(markets, positions)
  const remember = (market: PlayMarket) => {
    const index = groups.findIndex(group => group.questions.some(question => question.id === market.id))
    const held = new Set(positions.filter(p => p.shares > 0).map(p => p.marketId))
    held.add(market.id)
    // Continue within a partially played match, then down the feed, then wrap.
    const ordered = [...groups.slice(index), ...groups.slice(0, index)]
    resume.current = {marketId: market.id,
      shares: positions.filter(p => p.marketId === market.id).reduce((sum, p) => sum + p.shares, 0),
      candidates: ordered.filter(group => group.questions.some(question => !held.has(question.id))).map(group => group.id)}
  }
  const choose = (market: PlayMarket, side: Side) => { remember(market); onChoose(market, side) }
  const detail = (market: PlayMarket) => { remember(market); onDetail(market) }
  useLayoutEffect(() => {
    const anchor = resume.current
    const element = feed.current
    if (!completedTrade || handled.current === completedTrade || !anchor || !element || anchor.marketId !== completedTrade.market?.id) return
    const shares = positions.filter(p => p.marketId === anchor.marketId).reduce((sum, p) => sum + p.shares, 0)
    if (shares <= anchor.shares) return // Wait for the refreshed position before the list reorders.
    const held = new Set(positions.filter(p => p.shares > 0).map(p => p.marketId))
    const nextId = anchor.candidates.find(id => groups.some(group => group.id === id && group.questions.some(m => !held.has(m.id))))
    const target = Array.from(element.children).find(child => child.getAttribute('data-feed-group') === nextId) as HTMLElement | undefined
    if (target) {
      element.scrollTop += target.getBoundingClientRect().top - element.getBoundingClientRect().top - 14
    }
    handled.current = completedTrade
    resume.current = null
  }, [completedTrade, positions, groups])
  return <div ref={feed} className="pl-natural-feed" role="region" aria-label={t('subnav.markets')} tabIndex={0}>
    {groups.map(group => {
      const market = group.questions[0]
      if (market.matchId && !market.editorial) return <div className="pl-market-group" data-feed-group={group.id} key={group.id}><MatchMarketCard markets={group.questions} positions={positions} onChoose={choose} onDetail={detail} onViewPositions={onViewPositions}/></div>

      const held = positions.filter(position => position.marketId === market.id && position.shares > 0)
      const collapsed = held.length > 0 && !expanded.has(market.id)
      return <div className="pl-market-group" data-feed-group={group.id} key={group.id}><article className={`pl-mcard${collapsed ? ' pl-card-collapsed' : ''}`} key={market.id} aria-label={market.question}>
        <MarketCard market={market} positions={held} onViewPositions={onViewPositions} onDetail={detail} onChoose={side => choose(market, side)}
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

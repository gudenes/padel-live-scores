'use client'

import { useTranslations } from 'next-intl'
import { filterMarkets, type MarketFilter } from './market-filters'
import LiveNudge from './LiveNudge'
import type { PlayMarket } from './types'

type Props = {
  markets: PlayMarket[]
  filter: MarketFilter
  onFilter: (filter: MarketFilter) => void
}

export default function MarketToolbar({ markets, filter, onFilter }: Props) {
  const t = useTranslations('play')
  return <div className="pl-tap-filters">
    <nav className="pl-tap-row" aria-label={t('filters.label')}>
      {(['all', 'match', 'tourn', 'season'] as const).map(value => <button type="button" key={value}
        aria-pressed={filter === value} onClick={() => onFilter(value)}>{t(`filters.${value}`)}<LiveNudge count={filterMarkets(markets, value, new Date()).filter(m => m.live).length} /></button>)}
    </nav>
  </div>
}

'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { EMPTY_FACETS, filterMarkets, type MarketFacets, type MarketFilter } from './market-filters'
import LiveNudge from './LiveNudge'
import type { PlayMarket } from './types'

type Props = {
  markets: PlayMarket[]
  filter: MarketFilter
  facets: MarketFacets
  onFilter: (filter: MarketFilter) => void
  onFacets: (facets: MarketFacets) => void
}

export default function MarketToolbar({ markets, filter, facets, onFilter, onFacets }: Props) {
  const t = useTranslations('play')
  const [expanded, setExpanded] = useState(false)
  const count = Number(!!facets.competition) + Number(!!facets.category)
  const competitions = [...new Set(markets.map(m => m.competition).filter((v): v is string => !!v))].sort()
  const categories = [...new Set(markets.map(m => m.category).filter((v): v is string => !!v))].sort()
  return <div className="pl-tap-filters">
    <nav className="pl-tap-row" aria-label={t('filters.label')}>
      {(['all', 'match', 'tourn', 'season'] as const).map(value => <button type="button" key={value}
        aria-pressed={filter === value} onClick={() => onFilter(value)}>{t(`filters.${value}`)}<LiveNudge count={filterMarkets(markets, value, new Date(), facets).filter(m => m.live).length} /></button>)}
      <button type="button" aria-expanded={expanded} aria-controls="pl-extra-filters" onClick={() => setExpanded(!expanded)}>
        {t('filters.more')}{count > 0 && <span className="pl-filter-count">{count}</span>}<span aria-hidden>{expanded ? '▴' : '▾'}</span>
      </button>
    </nav>
    {expanded && <div id="pl-extra-filters" className="pl-inline-filters">
      <fieldset><legend>{t('filters.category')}</legend><div className="pl-tap-row">
        <button type="button" aria-pressed={!facets.category} onClick={() => onFacets({ ...facets, category: '' })}>{t('filters.all')}</button>
        {categories.map(value => <button type="button" key={value} aria-pressed={facets.category === value}
          onClick={() => onFacets({ ...facets, category: value })}>{value === 'men' || value === 'women' ? t(`filters.${value}`) : value}</button>)}
      </div></fieldset>
      <fieldset><legend>{t('filters.competition')}</legend><div className="pl-tap-row">
        <button type="button" aria-pressed={!facets.competition} onClick={() => onFacets({ ...facets, competition: '' })}>{t('filters.all')}</button>
        {competitions.map(value => <button type="button" key={value} aria-pressed={facets.competition === value}
          onClick={() => onFacets({ ...facets, competition: value })}>{value}</button>)}
      </div></fieldset>
    </div>}
    {count > 0 && <div className="pl-active-filters">
      {facets.category && <button type="button" onClick={() => onFacets({ ...facets, category: '' })}>{facets.category === 'men' || facets.category === 'women' ? t(`filters.${facets.category}`) : facets.category} <span aria-hidden>×</span></button>}
      {facets.competition && <button type="button" onClick={() => onFacets({ ...facets, competition: '' })}>{facets.competition} <span aria-hidden>×</span></button>}
      <button type="button" onClick={() => onFacets(EMPTY_FACETS)}>{t('filters.reset')}</button>
    </div>}
  </div>
}

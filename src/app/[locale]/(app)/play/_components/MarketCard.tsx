'use client'
// src/app/[locale]/(app)/play/_components/MarketCard.tsx
//
// The market question, player pairs, press controls and details nudge.
//
// Rendered INSIDE the `.pl-mcard` element that SwipeDeck owns — the card
// shell is the thing being dragged, so its transform must not be re-applied
// by a React render of this subtree.

import { useLocale, useTranslations } from 'next-intl'
import Image from 'next/image'
import { VersusIdentity } from './PlayerIdentity'
import { previewBuy } from './market-preview'
import PositionNudge from './PositionNudge'
import { Press } from './shared'
import type { PlayMarket, PlayPosition, Side } from './types'

export interface MarketCardProps {
  collapsed?: boolean
  onToggleExpanded?: () => void
  positions?: PlayPosition[]
  onViewPositions?: () => void
  market: PlayMarket
  /** Opens the detail sheet. Absent on the cards stacked behind the top one. */
  onDetail?: (market: PlayMarket) => void
  onChoose?: (side: Side) => void
}

export default function MarketCard({ market, onDetail, onChoose, positions = [], onViewPositions, collapsed = false, onToggleExpanded }: MarketCardProps) {
  const t = useTranslations('play')
  const locale = useLocale()

  const odds = (side: Side) => {
    const quote = previewBuy(market, side, 1)
    return quote ? `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(quote.shares / quote.cost)}×` : '—'
  }
  const horizonClass =
    market.horizon === 'season' ? ' pl-season' : market.horizon === 'tourn' ? ' pl-tourn' : ''

  const players = market.players

  return (
    <>
      <div className="pl-card-backdrop" aria-hidden="true">
        <Image className="pl-arena-bg" src="/play/arena-subtle-v1.png" alt="" fill sizes="(max-width: 500px) 100vw, 420px" />
      </div>
        <div className="pl-chips pl-card-chips">
          {market.live && (
            <span className="pl-tag pl-live">
              <span className="pl-dot" />
              {t('live')}
            </span>
          )}
          <span className={`pl-tag pl-horizon${horizonClass}`}>
            {t(`horizon.${market.horizon}`)}
          </span>
          {market.context && <span className="pl-tag pl-ctx">{market.context}</span>}
        </div>
      <h2 className="pl-q pl-card-title">{market.question}</h2>
      {onViewPositions && <PositionNudge positions={positions} onOpen={collapsed ? undefined : onViewPositions} />}
      {!collapsed && <>
      <div className="pl-hero">
        {players ? (
          // Real player portraits sit over the shared arena backdrop.
          <VersusIdentity
            pair1={players.pair1}
            pair2={players.pair2}
            vsLabel={t('deck.vs')}
            subjectPair={market.subjectPair}
          />
        ) : (
          // Tournament- and season-horizon markets have no match and therefore
          // no four players; they keep the ghosted monogram.
          <div className="pl-mono" aria-hidden>
            <i>{market.monogram.a}</i>
            {market.monogram.b && (
              <>
                <s>vs</s>
                <i>{market.monogram.b}</i>
              </>
            )}
          </div>
        )}

      </div>

      <div className="pl-odds pl-pair-choices">
        {(players && market.subjectPair === 2 ? ['no', 'yes'] as const : ['yes', 'no'] as const).map(side => (
          <Press key={side} className={`pl-choice-press pl-${side}`} size="size-lg" intent="intent-neutral" disabled={!onChoose}
            onClick={() => onChoose?.(side)} ariaLabel={`${t(`deck.${side}`)} · ${odds(side)}`}>
            <span className="pl-lbl">{t(`deck.${side}`)}</span>
            <span className="pl-pct">{odds(side)}</span>
          </Press>
        ))}
      </div>

      {onDetail && <button type="button" className="pl-details-nudge" onClick={() => onDetail(market)}>
        <span>{t('detail.openShort')}</span><span aria-hidden="true">↗</span>
      </button>}

      <div className="pl-stamp pl-s-yes">{t('deck.yes')}</div>
      <div className="pl-stamp pl-s-no">{t('deck.no')}</div>
      </>}
      {collapsed && onToggleExpanded && <button type="button" className="pl-card-open"
        aria-expanded={false} aria-label={`${t('positions.expandMarket')} · ${market.question}`}
        onClick={onToggleExpanded} />}
      {!collapsed && onToggleExpanded && <button type="button" className="pl-card-toggle" aria-expanded={!collapsed} onClick={onToggleExpanded}>
        <span>{t(collapsed ? 'positions.expandMarket' : 'positions.collapseMarket')}</span>
        <span aria-hidden="true">{collapsed ? '⌄' : '⌃'}</span>
      </button>}
    </>
  )
}

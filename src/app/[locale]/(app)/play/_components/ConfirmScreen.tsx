'use client'
// src/app/[locale]/(app)/play/_components/ConfirmScreen.tsx
//
// Post-trade confirmation. Reports what the trade ACTUALLY filled at —
// `shares`, `cost` and `avgPrice` come straight from the trade response, not
// from the estimate the sheet showed.
//
// The "Up next" card exists so the deck never dead-ends: the mockup's note
// is that a confirmation which is only a confirmation ends the session.

import { useLocale, useTranslations } from 'next-intl'
import { ConfirmArt, ThumbArt } from './art'
import { Press, formatGuacas, formatPrice, formatShares } from './shared'
import type { PlayMarket, Side } from './types'

export interface ConfirmedTrade {
  side: Side
  question: string
  /** Guacas actually debited. */
  cost: number
  shares: number
  avgPrice: number
}

export interface ConfirmScreenProps {
  trade: ConfirmedTrade
  /** The card the deck will show next, if there is one. */
  upNext: PlayMarket | null
  onViewPositions: () => void
  onNext: () => void
}

export default function ConfirmScreen({
  trade,
  upNext,
  onViewPositions,
  onNext,
}: ConfirmScreenProps) {
  const t = useTranslations('play')
  const locale = useLocale()

  return (
    <div className="pl-confirm">
      <div className="pl-confirm-art">
        <ConfirmArt />
        <div className="pl-tick">
          <svg viewBox="0 0 24 24">
            <path d="M4 12.5l5.2 5.2L20 7" />
          </svg>
        </div>
      </div>

      <h3>{t('done.title')}</h3>
      <p className="pl-deal">
        {t.rich('done.deal', {
          sideLabel: trade.side === 'yes' ? t('deck.yes') : t('deck.no'),
          amount: formatGuacas(trade.cost, locale),
          price: formatPrice(trade.avgPrice),
          side: (chunks) => (
            <span className={trade.side === 'yes' ? 'pl-sideY' : 'pl-sideN'}>{chunks}</span>
          ),
          b: (chunks) => <b>{chunks}</b>,
        })}
      </p>
      <p className="pl-approx">
        {t('done.approx', {
          shares: formatShares(trade.shares, locale),
          question: trade.question,
        })}
      </p>

      <div className="pl-confirm-cta">
        <Press size="size-md" block onClick={onViewPositions}>
          {t('done.viewPositions')}
        </Press>
        <Press size="size-md" intent="intent-neutral" block onClick={onNext}>
          {t('done.next')}
        </Press>
      </div>

      {upNext && (
        <div className="pl-upnext">
          <div className="pl-k">{t('done.upNext')}</div>
          <button type="button" className="pl-upnext-card" onClick={onNext}>
            <div className="pl-thumb">
              <ThumbArt tone={upNext.horizon} />
            </div>
            <div className="pl-t">
              <div className="pl-h">{t(`horizon.${upNext.horizon}`)}</div>
              <div className="pl-q2">{upNext.question}</div>
              <div className="pl-m">{upNext.context}</div>
            </div>
            <div className="pl-go" aria-hidden>
              ›
            </div>
          </button>
        </div>
      )}
    </div>
  )
}

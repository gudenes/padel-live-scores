'use client'
// src/app/[locale]/(app)/play/_components/ConfirmScreen.tsx
//
// Post-trade confirmation. Reports what the trade ACTUALLY filled at —
// `shares`, `cost` and `avgPrice` come straight from the trade response, not
// from the estimate the sheet showed.
//
// The "Up next" card exists so the deck never dead-ends: the mockup's note
// is that a confirmation which is only a confirmation ends the session.

import motion from '@/components/GameMotion.module.css'
import GuacaCoin from '@/components/GuacaCoin'
import { useLocale, useTranslations } from 'next-intl'
import Image from 'next/image'
import { PairIdentity } from './PlayerIdentity'
import { Press, formatGuacas, formatShares } from './shared'
import type { PlayMarket, Side } from './types'

export interface ConfirmedTrade {
  market?: PlayMarket
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

  const pair = trade.market?.players
    ? (trade.side === 'yes' ? trade.market.subjectPair !== 2 : trade.market.subjectPair === 2)
      ? trade.market.players.pair1 : trade.market.players.pair2
    : null

  return (
    <div className={`pl-confirm pl-receipt pl-receipt-${trade.side}`}>
      <div className="pl-receipt-hero">
        <Image src="/play/arena-subtle-v1.webp" alt="" fill sizes="500px" className="pl-receipt-arena" />
        <div className="pl-tick" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 12.5l5.2 5.2L20 7" /></svg></div>
        <h3 role="status">{t('done.title')}</h3>
      </div>
      <div className={`pl-receipt-ticket ${motion.sweep}`}>
        <div className="pl-receipt-top"><span className="pl-tag">{t('done.yourPick')}</span><strong>{t(`deck.${trade.side}`)}</strong></div>
        <h2>{trade.question}</h2>
        {pair && <div className="pl-receipt-pair"><PairIdentity players={pair} size={40} accent={trade.side === 'yes' ? 'subject' : 'other'} />
          <p>{pair.map(player => player.surname).join(' / ')}</p>
        </div>}
        <div className="pl-receipt-stake"><span>{t('done.placed')}</span><b>{formatGuacas(trade.cost, locale)} <GuacaCoin size={24} /></b></div>
        <div className="pl-receipt-return"><span>{t('done.ifWin')}</span><strong>{formatShares(trade.shares, locale)} <GuacaCoin size={24} /></strong>
          <p>{t('done.includesStake')}</p>
        </div>
      </div>
      <div className="pl-confirm-cta">
        <Press size="size-md" block onClick={onNext}>{t('done.keepExploring')}</Press>
        <Press size="size-md" intent="intent-neutral" block onClick={onViewPositions}>{t('done.viewPositions')}</Press>
      </div>
      {upNext && <button type="button" className="pl-receipt-next" onClick={onNext}>
        <span>{t('done.upNext')}</span><b>{upNext.question}</b><span aria-hidden>↗</span>
      </button>}
    </div>
  )
}

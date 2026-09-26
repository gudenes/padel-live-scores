'use client'
// src/app/[locale]/(app)/play/_components/PositionsScreen.tsx
//
// Open / Resolved / History, with live P&L.
//
// P&L is shown in G only — never a € or a $. In a play-money product a
// currency symbol anywhere is a regulatory and trust problem, and the
// design brief calls it out explicitly.

import { useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Blank, Press, SkeletonList, formatGuacas, formatPrice, toPct } from './shared'
import type { PlayMe, PlayPosition, PositionFilter } from './types'
import type { LoadStatus } from './usePlayData'

const FILTERS: PositionFilter[] = ['open', 'resolved', 'history']

// `markets.status` values, bucketed for the segmented control. 'held' is a
// market whose answer flapped and is waiting on an operator — it is still
// an open exposure from the holder's point of view, so it sits under Open.
const OPEN_STATUSES = new Set(['open', 'locked', 'proposed', 'held'])
const RESOLVED_STATUSES = new Set(['settled', 'void'])

function bucket(position: PlayPosition, filter: PositionFilter): boolean {
  if (filter === 'history') return true
  if (filter === 'resolved') return RESOLVED_STATUSES.has(position.status)
  return OPEN_STATUSES.has(position.status)
}

export interface PositionsScreenProps {
  me: PlayMe | null
  status: LoadStatus
  onExplore: () => void
  onRetry: () => void
}

export default function PositionsScreen({ me, status, onExplore, onRetry }: PositionsScreenProps) {
  const t = useTranslations('play')
  const locale = useLocale()
  const [filter, setFilter] = useState<PositionFilter>('open')

  const rows = useMemo(
    () => (me?.positions ?? []).filter((p) => bucket(p, filter)),
    [me, filter],
  )

  return (
    <>
      <div className="pl-pos-head">
        <h2>{t('positions.title')}</h2>
        {/* Net worth — balance plus the live value of open positions. The
            sub-nav chip next to it shows spendable balance; they differ, and
            that difference is the point of holding a position. */}
        <div className="pl-guacas" title={t('positions.netWorth')}>
          <span className="pl-coin">G</span>
          <span>{formatGuacas(me?.netWorth ?? 0, locale)}</span>
        </div>
      </div>

      <div className="pl-seg">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={f === filter ? 'pl-on' : undefined}
            onClick={() => setFilter(f)}
          >
            {t(`positions.${f}`)}
          </button>
        ))}
      </div>

      {status === 'loading' && <SkeletonList rows={3} height={84} />}

      {status === 'error' && (
        <Blank
          icon="warning"
          title={t('error.title')}
          body={t('error.body')}
          action={
            <Press size="size-sm" intent="intent-ghost" onClick={onRetry}>
              {t('error.retry')}
            </Press>
          }
        />
      )}

      {status === 'ready' && rows.length === 0 && (
        <Blank
          icon="wallet"
          title={t(`positions.empty.${filter}.title`)}
          body={t(`positions.empty.${filter}.body`)}
        />
      )}

      {status === 'ready' && rows.length > 0 && (
        <div className="pl-pos-list">
          {rows.map((p) => {
            const up = p.deltaPct >= 0
            return (
              <div className="pl-pos" key={`${p.marketId}-${p.side}`}>
                <div className={`pl-side pl-${p.side}`}>
                  <div className="pl-s">{p.side === 'yes' ? t('deck.yes') : t('deck.no')}</div>
                  <div className="pl-p">{toPct(p.currentPrice)}%</div>
                </div>
                <div className="pl-mid">
                  <div className="pl-q3">{p.question}</div>
                  <div className="pl-ctx">
                    {p.context}
                    {p.live && (
                      <>
                        {p.context ? ' · ' : ''}
                        <span className="pl-livepill">{t('live')}</span>
                      </>
                    )}
                  </div>
                  <div className="pl-stake">
                    {t('positions.stake', {
                      amount: formatGuacas(p.costBasis, locale),
                      price: formatPrice(p.avgPrice),
                    })}
                  </div>
                </div>
                <div className="pl-pnl">
                  <div className={`pl-d ${up ? 'pl-up' : 'pl-down'}`}>
                    {up ? '+' : ''}
                    {Math.round(p.deltaPct)}%
                  </div>
                  <div className="pl-now">{formatGuacas(p.valueNow, locale)} G</div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ padding: '0 16px 16px', flex: 'none' }}>
        <Press size="size-md" intent="intent-ghost" block onClick={onExplore}>
          {t('positions.explore')}
        </Press>
      </div>
    </>
  )
}

'use client'

import GuacaCoin from '@/components/GuacaCoin'
import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { TradeAvatar } from './MarketActivity'
import { Blank, Press, SkeletonList, formatGuacas, formatPrice, relativeShort } from './shared'
import type { PlayTrade } from './types'
import type { LoadStatus } from './usePlayData'

/** Stakes at or above this get the "Big" flag, so conviction is visible. */
const WHALE_GUACAS = 1000

export interface ActivityScreenProps {
  trades: PlayTrade[] | null
  status: LoadStatus
  onRetry: () => void
}

export default function ActivityScreen({ trades, status, onRetry }: ActivityScreenProps) {
  const t = useTranslations('play')
  const locale = useLocale()

  // One clock for the whole list, ticked every 30s. Reading Date.now() per
  // row would give rows within a render slightly different "now"s.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const timeLabels = {
    now: t('time.now'),
    s: (n: number) => t('time.seconds', { n }),
    m: (n: number) => t('time.minutes', { n }),
    h: (n: number) => t('time.hours', { n }),
    d: (n: number) => t('time.days', { n }),
  }

  const rows = trades ?? []

  return (
    <>
      <div className="pl-act-head">
        <div className="pl-t">
          {rows.length > 0 && <span className="pl-dot" style={{ background: 'var(--color-live)' }} />}
          {t('activity.latest')}
        </div>
      </div>

      {status === 'loading' && <SkeletonList rows={5} height={58} />}

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
        <Blank icon="pulse" title={t('activity.empty.all.title')} body={t('activity.empty.all.body')} />
      )}

      {status === 'ready' && rows.length > 0 && (
        <div className="pl-act-list">
          {rows.map((a) => {
            const name = a.displayName || t('activity.someone')
            return (
              <div className="pl-act" key={a.id}>
                <TradeAvatar trade={a} />
                <div className="pl-body">
                  <div className="pl-line1">
                    <span className="pl-who">{a.isMe ? t('courtside.you') : name}</span>
                    {a.isSimulation && <span className="pl-chip">{t('courtside.simulated')}</span>}
                    <span className="pl-verb">
                      {a.direction === 'sell' ? t('activity.sold') : t('activity.bought')}
                    </span>
                    <span className={`pl-chip pl-${a.side}`}>
                      {a.side === 'yes' ? t('deck.yes') : t('deck.no')}
                    </span>
                    <span className="pl-verb">{t('activity.at')}</span>
                    <span className="pl-at">{formatPrice(a.price)}</span>
                    {a.guacas >= WHALE_GUACAS && (
                      <span className="pl-chip pl-whale">{t('activity.big')}</span>
                    )}
                  </div>
                  <div className="pl-q4">
                    {a.marketStatus && a.marketStatus !== 'open' && <span className="pl-chip" style={{ marginRight: 6 }}>{t('results.closed')}</span>}
                    {formatGuacas(a.guacas, locale)} <GuacaCoin size={16} />
                    {a.question ? ` · ${a.question}` : ''}
                  </div>
                </div>
                <div className="pl-ago">{relativeShort(a.createdAt, now, timeLabels)}</div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

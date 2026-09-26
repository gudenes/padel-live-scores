'use client'
// src/app/[locale]/(app)/play/_components/ActivityScreen.tsx
//
// Other people's trades.
//
// The mockup ran a setInterval that invented a new trade every 3.2s from a
// pool of fake usernames, to make a thin market feel liquid. That ticker is
// NOT ported, and neither is the fake pool. Production has zero trades, and
// manufacturing user activity on a social feed is not a design decision we
// get to make — it is a lie about other people. What ships instead is an
// honest empty state and a real poll of the real endpoint.
//
// What IS ported is the identity treatment: real display names with
// generated character avatars. ADI shows anonymous wallet hashes because
// on-chain it has no choice; we have accounts, so the feed can carry names
// and be social rather than just noisy.
//
// The mockup's All / Following filter pair is NOT rendered: GET
// /api/play/activity reads no filter parameter, so a "Following" pill would
// send the same request and present everyone's trades as your friends'.
// Restore it the moment the endpoint learns the parameter.

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import GeneratedAvatar from '@/components/GeneratedAvatar'
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
                <GeneratedAvatar name={name} className="pl-av" />
                <div className="pl-body">
                  <div className="pl-line1">
                    <span className="pl-who">{name}</span>
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
                    {formatGuacas(a.guacas, locale)} G
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

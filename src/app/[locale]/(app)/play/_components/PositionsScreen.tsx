'use client'
import MatchLink from './MatchLink'
import resultStyles from './PositionsScreen.module.css'
// src/app/[locale]/(app)/play/_components/PositionsScreen.tsx
//
// Pending predictions, completed results, and all plays.
//
// P&L is shown in G only — never a € or a $. In a play-money product a
// currency symbol anywhere is a regulatory and trust problem, and the
// design brief calls it out explicitly.

import GuacaCoin from '@/components/GuacaCoin'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Blank, Press, SkeletonList, formatGuacas } from './shared'
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
  if (filter === 'resolved') return RESOLVED_STATUSES.has(position.status) && position.result !== 'pending'
  return OPEN_STATUSES.has(position.status) || position.result === 'pending'
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
  const [timeZone, setTimeZone] = useState<string | null>(null)
  useEffect(() => {
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    try {
      const cookie = document.cookie.split('; ').find(value => value.startsWith('geo-timezone='))
      const zone = cookie ? decodeURIComponent(cookie.slice('geo-timezone='.length)) : browserZone
      new Intl.DateTimeFormat(locale, { timeZone: zone }).format()
      setTimeZone(zone)
    } catch { setTimeZone(browserZone) }
  }, [locale])
  const [filter, setFilter] = useState<PositionFilter>('open')
  const counts = Object.fromEntries(FILTERS.map(f => [f, (me?.positions ?? []).filter(p => bucket(p, f)).length]))

  const rows = useMemo(
    () => {
      const filtered = (me?.positions ?? []).filter(p => bucket(p, filter))
      const timestamp = (p: PlayPosition) => p.resolutionAt && Number.isFinite(Date.parse(p.resolutionAt)) ? Date.parse(p.resolutionAt) : Infinity
      return filter === 'open' ? filtered.sort((a, b) => timestamp(a) - timestamp(b)) : filter === 'resolved' ? filtered.sort((a,b) => (Date.parse(b.settledAt ?? '') || 0) - (Date.parse(a.settledAt ?? '') || 0)) : filtered
    },
    [me, filter],
  )

  return (
    <>
      {(me?.notices ?? []).filter(n => n.corrected).slice(0, 3).map(n => <div className="pl-result-notice" role="status" key={n.id}>
        <strong>{t('results.corrected')}</strong>
        {n.question && <p>{n.question}</p>}
        <p>{t('results.adjustment', { amount: `${n.delta > 0 ? '+' : ''}${formatGuacas(n.delta, locale)}` })}</p>
        <small>{n.reason}</small>
      </div>)}
      {(me?.balance ?? 0) < 0 && <p className="pl-result-notice">{t('results.owed')}</p>}
      <div className="pl-seg">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={f === filter ? 'pl-on' : undefined}
            aria-pressed={f === filter}
            aria-label={`${t(`positions.filters.${f}`)}${status === 'ready' ? ` ${counts[f]}` : ''}`}
            onClick={() => setFilter(f)}
          >
            {t(`positions.filters.${f}`)}{status === 'ready' && <span className={resultStyles.count}> {counts[f]}</span>}
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
        <div className={`pl-pos-list ${resultStyles.list}`} data-results={filter === 'resolved'} key={filter}>
          {rows.map((p, index) => {
            const resolved = RESOLVED_STATUSES.has(p.status) && p.result !== 'pending'
            const gain = Math.round(p.valueNow - p.costBasis)
            const date = p.resolutionAt && Number.isFinite(Date.parse(p.resolutionAt)) ? new Date(p.resolutionAt) : null
            const dateLabel = date && timeZone ? new Intl.DateTimeFormat(locale, {
              day:'numeric', month:'short', timeZone: p.resolutionAt?.includes('T') ? timeZone : 'UTC',
              ...(p.resolutionAt?.includes('T') ? {hour:'2-digit' as const, minute:'2-digit' as const, hour12:false} : {}),
            }).format(date) : null
            const dayKey = (value?: string | null) => value && Number.isFinite(Date.parse(value)) && timeZone ? new Intl.DateTimeFormat('en-CA', {timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value)) : null
            const resultDay = dayKey(p.settledAt)
            const now = new Date()
            const yesterday = new Date(now.getTime() - 86400000)
            const groupLabel = resultDay === null ? t('positions.earlierResults') : resultDay === dayKey(now.toISOString()) ? t('positions.today') : resultDay === dayKey(yesterday.toISOString()) ? t('positions.yesterday') : new Intl.DateTimeFormat(locale, {timeZone:timeZone!, day:'numeric',month:'short',year:'numeric'}).format(new Date(p.settledAt!))
            const showGroup = filter === 'resolved' && (index === 0 || resultDay !== dayKey(rows[index - 1].settledAt))
            const outcome = resolved && p.result ? t(`results.${p.result}`) : t('positions.filters.open')
            const payout = resolved ? p.valueNow : Math.floor(p.shares)
            const timingTitle = `${t(`positions.resolution.${p.resolutionKind ?? 'unknown'}`)}${dateLabel ? ` · ${t(p.resolutionKind === 'match' ? 'positions.matchStarts' : 'positions.targetDate', {date:dateLabel})}` : ''}`
            return <Fragment key={`${p.marketId}-${p.side}`}>
              {showGroup && <h3 className={resultStyles.dayHeading}>{groupLabel}</h3>}
              <article className={resolved ? resultStyles.resultRow : resultStyles.pendingCard} aria-label={p.question}>
                <div className={resultStyles.badge} data-tone={resolved ? p.result : p.side}>
                  <span>{resolved ? outcome : t(`deck.${p.side}`)}</span>
                </div>
                <div className={resultStyles.body}>
                  {!resolved && <div className={resultStyles.topline}>
                    <span className={resultStyles.pendingChip}><span>{outcome}</span></span>
                    <MatchLink matchId={p.matchId} live={p.live}/>
                  </div>}
                  <h4 className={resultStyles.question}>{p.question}</h4>
                  {p.matchLabel && <p className={resultStyles.matchLabel}>{p.matchLabel}</p>}
                  {!resolved && p.context && <p className={resultStyles.context}>{p.context.replace(/^CUPRA /, '').replace(/ PREMIER PADEL/g, '').replace(/Quarterfinal/gi, 'QF').replace(/Semifinal/gi, 'SF')}</p>}
                  <div className={resultStyles.bottomline}>
                    <div className={resultStyles.amounts} title={resolved ? t('results.totalPaid') : `${t('positions.ifCorrect')} · ${t('positions.includesPlayed')}`}>
                      <GuacaCoin size={17}/><span aria-label={`${t('positions.played')} ${formatGuacas(p.costBasis,locale)}`}>{formatGuacas(p.costBasis,locale)}</span>
                      <span aria-hidden="true">→</span>
                      <strong data-lost={p.result === 'lost'} aria-label={`${resolved ? t('positions.received') : t('positions.ifCorrect')} ${formatGuacas(payout,locale)}`}>{formatGuacas(payout,locale)}</strong>
                    </div>
                    {!resolved && <time className={resultStyles.timing} dateTime={p.resolutionAt ?? undefined} title={timingTitle}>{dateLabel ?? t('positions.dateUnconfirmed')}</time>}
                  </div>
                  {!resolved && <span className={resultStyles.caption}>{t('positions.ifCorrect')} · {t('positions.includesPlayed')}</span>}
                  {resolved && <span className={resultStyles.resultPick}>{t('done.yourPick')} · {t(`deck.${p.side}`)}</span>}
                  {p.corrected && <span className={resultStyles.caption}>{t('results.corrected')}</span>}
                </div>
                {resolved && <div className={resultStyles.resultAside}>
                  <strong data-negative={gain < 0} aria-label={`${t('results.netResult')} ${gain}`}>{gain > 0 ? '+' : ''}{formatGuacas(gain,locale)}</strong>
                  {p.settledAt && timeZone && Number.isFinite(Date.parse(p.settledAt)) && <time dateTime={p.settledAt}>{new Intl.DateTimeFormat(locale,{timeZone,hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(p.settledAt))}</time>}
                  <MatchLink matchId={p.matchId} live={false} iconOnly/>
                </div>}
              </article>
            </Fragment>
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

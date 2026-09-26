'use client'
// src/app/[locale]/(app)/play/_components/LeadersScreen.tsx
//
// Season leaderboard, ranked by net worth — balance plus the live value of
// open positions — so holding a winning position counts before it resolves.
//
// Your own row stays pinned to the bottom of the list no matter how far
// down you are. It uses an opaque background (#28311F = lime .10
// pre-composited over --bg-card) rather than the translucent --lime-bg,
// because list rows scroll visibly THROUGH a translucent pin.
//
// The mockup's nine fake leaders are not ported. An empty leaderboard is a
// real state of a brand-new season and is rendered as one.

import { useLocale, useTranslations } from 'next-intl'
import GeneratedAvatar from '@/components/GeneratedAvatar'
import { Blank, Press, SkeletonList, formatGuacas } from './shared'
import type { LeaderPeriod, PlayLeader, PlayLeaderboard } from './types'
import type { LoadStatus } from './usePlayData'

const PERIODS: LeaderPeriod[] = ['week', 'season', 'all']

/**
 * Rank movement. /api/play/leaderboard does not compute it yet, and an
 * absent value renders NOTHING — a dash in every row would read as "nobody
 * moved this week", which is a claim, not a gap. A real 0 does get the dash.
 */
function Move({ move }: { move: number | null }) {
  if (move === null) return null
  if (move === 0) return <div className="pl-m2 pl-flat">—</div>
  if (move > 0) return <div className="pl-m2 pl-up">▲ {move}</div>
  return <div className="pl-m2 pl-down">▼ {Math.abs(move)}</div>
}

export interface LeadersScreenProps {
  board: PlayLeaderboard | null
  status: LoadStatus
  period: LeaderPeriod
  onPeriod: (p: LeaderPeriod) => void
  onRetry: () => void
}

export default function LeadersScreen({
  board,
  status,
  period,
  onPeriod,
  onRetry,
}: LeadersScreenProps) {
  const t = useTranslations('play')
  const locale = useLocale()

  const rows = board?.rows ?? []
  // The podium needs a full three to read as a podium; below that it is
  // just three boxes of different heights with nothing in two of them.
  const hasPodium = rows.length >= 3
  const podiumOrder = [1, 0, 2] // 2nd · 1st · 3rd — first place centre and tallest
  const listRows = hasPodium ? rows.slice(3) : rows

  // Accuracy and streak are not in the leaderboard payload today. Returning
  // an empty string keeps the sub-line out of the DOM rather than rendering
  // "0% accurate" for everybody.
  const secondary = (l: PlayLeader): string => {
    const bits: string[] = []
    if (l.accuracy !== null) bits.push(t('leaders.accuracy', { pct: Math.round(l.accuracy) }))
    if (l.streak) bits.push(t('leaders.streak', { n: l.streak }))
    return bits.join(' · ')
  }

  /** Real users can have no display_name; they are anonymous, not invented. */
  const nameOf = (l: PlayLeader) => l.displayName || t('activity.someone')

  return (
    <>
      <div className="pl-lb-head">
        <h2>{t('leaders.title')}</h2>
        <div className="pl-per">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              className={p === period ? 'pl-on' : undefined}
              onClick={() => onPeriod(p)}
            >
              {t(`leaders.${p}`)}
            </button>
          ))}
        </div>
      </div>

      {status === 'loading' && (
        <div style={{ paddingTop: 16 }}>
          <SkeletonList rows={6} height={48} />
        </div>
      )}

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

      {status === 'ready' && rows.length === 0 && !board?.me && (
        <Blank icon="trophy" title={t('leaders.empty.title')} body={t('leaders.empty.body')} />
      )}

      {status === 'ready' && hasPodium && (
        <div className="pl-podium">
          {podiumOrder.map((i) => {
            const l = rows[i]!
            const place = i + 1
            return (
              <div className={`pl-pod${place === 1 ? ' pl-p1' : ''}`} key={l.userId ?? place}>
                <div className="pl-rk">
                  {place === 1 ? `① ${t('leaders.champion')}` : place === 2 ? '②' : '③'}
                </div>
                <GeneratedAvatar
                  name={nameOf(l)}
                  fallbackSeed={l.userId ?? 'anonymous'}
                  className={place === 1 ? 'pl-av pl-lg' : 'pl-av'}
                />
                <div className="pl-nm">{nameOf(l)}</div>
                <div className="pl-gv">{formatGuacas(l.netWorth, locale)}</div>
                {secondary(l) && <div className="pl-sec">{secondary(l)}</div>}
              </div>
            )
          })}
        </div>
      )}

      {status === 'ready' && (rows.length > 0 || board?.me) && (
        <div className="pl-lb-list">
          {listRows.map((l, k) => (
            <div className={`pl-lbr${l.isMe ? ' pl-me' : ''}`} key={l.userId ?? `r${k}`}>
              <div className="pl-r">{l.rank || (hasPodium ? k + 4 : k + 1)}</div>
              <GeneratedAvatar
                name={nameOf(l)}
                fallbackSeed={l.userId ?? 'anonymous'}
                className="pl-av"
              />
              <div className="pl-who2">
                <div className="pl-n2">{nameOf(l)}</div>
                {secondary(l) && <div className="pl-s2">{secondary(l)}</div>}
              </div>
              <div className="pl-g2">
                <div className="pl-v2">{formatGuacas(l.netWorth, locale)}</div>
                <Move move={l.move} />
              </div>
            </div>
          ))}

          {/* Pinned "you" row — only when the user isn't already visible in
              the list above, otherwise they appear twice. */}
          {board?.me && !listRows.some((l) => l.isMe) && (
            <div className="pl-lbr pl-me">
              <div className="pl-r">{board.me.rank}</div>
              <GeneratedAvatar
                name={board.me.displayName || t('leaders.you')}
                fallbackSeed={board.me.userId ?? 'anonymous'}
                className="pl-av"
              />
              <div className="pl-who2">
                <div className="pl-n2">{board.me.displayName || t('leaders.you')}</div>
                {secondary(board.me) && <div className="pl-s2">{secondary(board.me)}</div>}
              </div>
              <div className="pl-g2">
                <div className="pl-v2">{formatGuacas(board.me.netWorth, locale)}</div>
                <Move move={board.me.move} />
              </div>
            </div>
          )}
        </div>
      )}

      {status === 'ready' && rows.length > 0 && <div className="pl-lb-note">{t('leaders.note')}</div>}
    </>
  )
}

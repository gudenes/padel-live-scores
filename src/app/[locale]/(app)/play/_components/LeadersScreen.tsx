'use client'
// src/app/[locale]/(app)/play/_components/LeadersScreen.tsx
//
// Season leaderboard, ranked by net worth — balance plus the live value of
// open positions — so holding a winning position counts before it resolves.
//
// The full ladder opens around the signed-in player’s actual rank.

import { useEffect, useRef, useState } from 'react'
import GuacaCoin from '@/components/GuacaCoin'
import { useLocale, useTranslations } from 'next-intl'
import { simulationPlayerLook } from '@/lib/player-outfit'
import Avatar from '@/components/Avatar'
import { PlayerAvatar, PlayerFigure, usePlayerOutfit } from '@/components/PlayerAvatar'
import { useAuth } from '@/components/AuthProvider'
import { useRouter } from '@/i18n/navigation'
import styles from './LeadersScreen.module.css'
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

/** Only the signed-in player has a locally equipped outfit. Other users'
 * profile photos remain authoritative; Starter is a neutral fallback. */
function LeaderAvatar({ leader, size = 44 }: { leader: PlayLeader; size?: number }) {
  const { user, profile } = useAuth()
  const mine = !!user && leader.userId === user.id
  const { outfit } = usePlayerOutfit(mine ? user.id : undefined)
  const photo = mine ? profile?.avatar_url ?? leader.avatarUrl : leader.avatarUrl
  if (leader.isSimulation) {
    return <PlayerAvatar outfit={simulationPlayerLook(leader.avatarSeed || leader.displayName)} size={size} />
  }
  if (outfit) return <PlayerAvatar outfit={outfit} size={size} />
  if (photo) return <Avatar src={photo} alt="" size={size} unoptimized />
  return <PlayerAvatar outfit="starter" size={size} />
}

export interface LeadersScreenProps {
  active: boolean
  board: PlayLeaderboard | null
  status: LoadStatus
  period: LeaderPeriod
  onPeriod: (p: LeaderPeriod) => void
  onRetry: () => void
}

export default function LeadersScreen({
  active,
  board,
  status,
  period,
  onPeriod,
  onRetry,
}: LeadersScreenProps) {
  const t = useTranslations('play')
  const locale = useLocale()
  const router = useRouter()

  const list = useRef<HTMLDivElement>(null)
  const ownRow = useRef<HTMLButtonElement>(null)
  const centeredPeriod = useRef<string | null>(null)
  const [selected, setSelected] = useState<PlayLeader | null>(null)
  const jumpToMe = () => {
    if (list.current && ownRow.current) {
      list.current.scrollTop += ownRow.current.getBoundingClientRect().top
        - list.current.getBoundingClientRect().top
        - (list.current.clientHeight - ownRow.current.clientHeight) / 2
    }
  }
  useEffect(() => {
    if (!active) { centeredPeriod.current = null; return }
    if (status !== 'ready' || centeredPeriod.current === period) return
    centeredPeriod.current = period
    jumpToMe()
  }, [active, status, period, board])
  const rows = board?.rows ?? []
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
              aria-pressed={p === period}
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

      {status === 'ready' && board?.me && <button className={styles.jump} onClick={jumpToMe}>
        <LeaderAvatar leader={board.me} size={34} />
        <span>{t('leaders.yourPosition')} <strong>#{board.me.rank}</strong></span>
        <span className={styles.jumpLabel}>{t('leaders.findMe')} <span aria-hidden>↕</span></span>
      </button>}

      {status === 'ready' && rows.length > 0 && <div className={styles.scope}>
        <span>{t(period === 'week' ? 'leaders.weeklyCount' : 'leaders.playerCount', { count: rows.length })}</span>
        {period === 'week' && <button onClick={() => onPeriod('season')}>{t('leaders.seeEveryone')} ↗</button>}
      </div>}

      {status === 'ready' && (rows.length > 0 || board?.me) && (
        <div ref={list} className={`pl-lb-list ${styles.list}`} tabIndex={0} role="region" aria-label={t('leaders.standings')}>
          {rows.map((l, k) => (
            <button type="button" data-podium={l.rank <= 3 ? l.rank : undefined} data-tone={l.rank % 3} ref={l.isMe ? ownRow : undefined} className={`pl-lbr ${styles.row}${l.isMe ? ' pl-me' : ''}`} key={l.userId ?? `r${k}`} onClick={() => setSelected(l)} aria-label={t('leaders.openPlayer', { name: nameOf(l), rank: l.rank })}>
              <div className="pl-r">{l.rank || (k + 1)}</div>
              <LeaderAvatar leader={l} size={36} />
              <div className="pl-who2">
                <div className="pl-n2">{nameOf(l)}{l.isSimulation && <span className={styles.you}>{t('courtside.simulated')}</span>}{l.isMe && <span className={styles.you}>{t('leaders.you')}</span>}</div>
                {secondary(l) && <div className="pl-s2">{secondary(l)}</div>}
              </div>
              <div className="pl-g2">
                <div className="pl-v2">{formatGuacas(l.netWorth, locale)} <GuacaCoin size={18} /></div>
                <Move move={l.move} />
              </div>
            </button>
          ))}


        </div>
      )}

      {selected && <PlayerPreview leader={selected} name={nameOf(selected)} period={period} onClose={() => setSelected(null)} onProfile={() => router.push('/profile')} />}
      {status === 'ready' && rows.length > 0 && <div className="pl-lb-note">{board?.hasSimulation ? t('leaders.simulationNote') : t('leaders.note')}</div>}
    </>
  )
}

function PlayerPreview({ leader, name, period, onClose, onProfile }: {
  leader: PlayLeader; name: string; period: LeaderPeriod; onClose: () => void; onProfile: () => void
}) {
  const t = useTranslations('play')
  const locale = useLocale()
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    const previous = document.activeElement as HTMLElement | null
    element?.showModal()
    return () => { element?.close(); previous?.focus({ preventScroll: true }) }
  }, [])
  return <dialog ref={dialog} className={`pl-trade-dialog pl-amount-dialog ${styles.preview}`} aria-labelledby="leader-player-title" onCancel={e => { e.preventDefault(); onClose() }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className="pl-trade-content">
      <div className="pl-sheet-head"><h2 id="leader-player-title">{name}</h2><button className="pl-x" onClick={onClose} aria-label={t('detail.close')}>×</button></div>
      <div className={styles.playerHero}>{leader.isSimulation ? <div className={styles.figure}><PlayerFigure outfit={simulationPlayerLook(leader.avatarSeed || leader.displayName)} /></div> : <LeaderAvatar leader={leader} size={112} />}<span>{leader.isSimulation ? t('courtside.simulated') : leader.isMe ? t('leaders.you') : t('leaders.player')}</span></div>
      <div className={styles.stats}><div><span>{t(`leaders.${period}`)}</span><strong>#{leader.rank}</strong></div><div><span>{t('leaders.netWorth')}</span><strong>{formatGuacas(leader.netWorth, locale)} <GuacaCoin size={24} /></strong></div></div>
      {leader.humanRank && <p className={styles.profileNote}>{t('leaders.humanRank', { rank: leader.humanRank })}</p>}
      {leader.isSimulation && <p className={styles.profileNote}>{t('leaders.simulationNote')}</p>}
      {leader.isMe && <Press onClick={onProfile}>{t('leaders.myProfile')} ↗</Press>}
    </div>
  </dialog>
}

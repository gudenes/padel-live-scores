'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { TIME_24H, DATE_SHORT } from '@/lib/format-patterns'
import { Match, pairName, parseSetScore, parseSetFromGames } from '@/types/match'
import FollowButton from '@/components/FollowButton'
import { FlagImage } from '@/components/FlagImage'
import { useMatchNotification } from '@/hooks/useMatchNotification'

// Brand colours — local duplication for now; future extraction candidate
const GREEN = '#7ED321'
const LIVE_RED = '#FF4655'
const MUTED = '#6B7280'
const BORDER = 'rgba(255,255,255,0.06)'
const MEN_BLUE = '#4A9EFF'
const WOMEN_PURPLE = '#D966FF'

const CHUNKY = {
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
}

// ── Point ordinal for score-change detection ─────────────────
const PT_ORD: Record<string, number> = { '0': 0, '15': 1, '30': 2, '40': 3, 'AD': 4 }
// Module-level map so score tracking survives component remounts
export const _prevScores = new Map<string, { p1Games: number; p2Games: number; p1Pts: string; p2Pts: string }>()
// Track when matches finish so they linger in the Live tab
export const _finishedAt = new Map<string, number>()
export const _prevLiveIds = new Set<string>()
export const LINGER_MS = 2 * 60 * 1000 // 2 minutes

// ── Inline match row (replaces MatchCard for v3) ──────────────

function MatchRow({ match }: { match: Match }) {
  const format = useFormatter()
  const t = useTranslations('matches')

  const sets = (match.sets ?? []).sort((a, b) => a.set_number - b.set_number)
  const currentSet = sets.find(s => s.is_current)
  const currentGame = currentSet?.games?.find(g => g.is_current)

  const currentPoints = currentGame?.points?.length
    ? currentGame.points[currentGame.points.length - 1]
    : ''
  const pointsParts = (currentPoints ?? '').split(/[:\-]/)
  const p1GamePts = pointsParts[0] ?? ''
  const p2GamePts = pointsParts[1] ?? ''

  const isLive = match.status === 'live'
  const isFinished = ['finished', 'retired', 'walkover'].includes(match.status)
  const category = (match as any).category as string | null
  const genderColor = category === 'women' ? WOMEN_PURPLE : category === 'men' ? MEN_BLUE : MUTED

  const pair1Name = pairName(match.pair1_player1, match.pair1_player2)
  const pair2Name = pairName(match.pair2_player1, match.pair2_player2)

  // ── Score-change flash animation (unchanged behavior from extracted V3MatchRow) ─
  const [flashPair, setFlashPair] = useState<1 | 2 | null>(null)
  const flashKeyRef = useRef(0)
  const p1TotalGames = useMemo(() => sets.reduce((s, st) => s + (st.pair1_games ?? 0), 0), [sets])
  const p2TotalGames = useMemo(() => sets.reduce((s, st) => s + (st.pair2_games ?? 0), 0), [sets])

  useEffect(() => {
    if (!isLive) { _prevScores.delete(match.id); return }
    const cur = { p1Games: p1TotalGames, p2Games: p2TotalGames, p1Pts: p1GamePts, p2Pts: p2GamePts }
    const prev = _prevScores.get(match.id)
    if (prev && (prev.p1Games !== cur.p1Games || prev.p2Games !== cur.p2Games || prev.p1Pts !== cur.p1Pts || prev.p2Pts !== cur.p2Pts)) {
      let scorer: 1 | 2 | null = null
      if (cur.p1Games > prev.p1Games) scorer = 1
      else if (cur.p2Games > prev.p2Games) scorer = 2
      else {
        const curP1 = PT_ORD[cur.p1Pts] ?? 0
        const curP2 = PT_ORD[cur.p2Pts] ?? 0
        const prevP1 = PT_ORD[prev.p1Pts] ?? 0
        const prevP2 = PT_ORD[prev.p2Pts] ?? 0
        if (curP1 > prevP1) scorer = 1
        else if (curP2 > prevP2) scorer = 2
        else if (prevP1 > prevP2 && curP1 <= curP2) scorer = 2
        else if (prevP2 > prevP1 && curP2 <= curP1) scorer = 1
      }
      _prevScores.set(match.id, cur)
      if (scorer) {
        flashKeyRef.current += 1
        setFlashPair(scorer)
        const tout = setTimeout(() => setFlashPair(null), 2800)
        return () => clearTimeout(tout)
      }
    } else {
      _prevScores.set(match.id, cur)
    }
  }, [isLive, match.id, p1TotalGames, p2TotalGames, p1GamePts, p2GamePts])

  const winnerPair = match.winner_pair as 1 | 2 | null | undefined
  const isPair1Winner = isFinished && winnerPair === 1
  const isPair2Winner = isFinished && winnerPair === 2

  return (
    <Link href={`/match/${match.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
      <div style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        alignItems: 'center',
        padding: '12px 14px 12px 17px',
        borderTop: `1px solid ${BORDER}`,
        cursor: 'pointer',
      }}>
        <span style={{
          position: 'absolute', left: 0, top: 8, bottom: 8, width: 3,
          background: genderColor,
        }} />

        {/* ── Pairs (2 rows, one per pair) ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <PairLine
            p1={match.pair1_player1}
            p2={match.pair1_player2}
            name={pair1Name}
            isWinner={isPair1Winner}
            isLoser={isPair2Winner}
            flash={flashPair === 1}
          />
          <PairLine
            p1={match.pair2_player1}
            p2={match.pair2_player2}
            name={pair2Name}
            isWinner={isPair2Winner}
            isLoser={isPair1Winner}
            flash={flashPair === 2}
          />
        </div>

        {/* ── Right side (variant by status) ── */}
        {isLive && (
          <LiveRight
            sets={sets}
            currentSetNumber={currentSet?.set_number ?? sets.length}
            p1Pts={p1GamePts}
            p2Pts={p2GamePts}
            setUnit={t('setUnit')}
            setOrdinal={(n: number) => t(`setOrdinal.${n}` as any)}
          />
        )}
        {isFinished && (
          <FinishedRight
            sets={sets}
            label={match.status === 'retired' ? 'RET' : match.status === 'walkover' ? 'W/O' : t('final')}
          />
        )}
        {!isLive && !isFinished && (
          <UpcomingRight match={match} format={format} t={t} />
        )}
      </div>
    </Link>
  )
}

function PairLine({ p1, p2, name, isWinner, isLoser, flash }: {
  p1: any
  p2: any
  name: string
  isWinner: boolean
  isLoser: boolean
  flash: boolean
}) {
  const color = isLoser ? 'rgba(156,163,175,0.75)' : '#fff'
  const weight = isWinner ? 800 : 700
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, minWidth: 0,
      animation: flash ? 'v3-score-roll 0.9s cubic-bezier(0.34, 1.56, 0.64, 1) both' : undefined,
    }}>
      <DualFlag p1={p1} p2={p2} />
      <span style={{
        fontSize: 14, fontWeight: weight, color,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {name}
      </span>
    </div>
  )
}

function DualFlag({ p1, p2 }: { p1: any; p2: any }) {
  return (
    <div style={{ position: 'relative', width: 24, height: 18, flexShrink: 0 }}>
      <div style={{ position: 'absolute', top: 0, left: 0, zIndex: 2 }}>
        <FlagImage country={p1?.country ?? null} size={14} />
      </div>
      <div style={{ position: 'absolute', top: 5, left: 7, zIndex: 1 }}>
        <FlagImage country={p2?.country ?? null} size={14} />
      </div>
    </div>
  )
}

function LiveRight({ sets, currentSetNumber, p1Pts, p2Pts, setUnit, setOrdinal }: {
  sets: any[]
  currentSetNumber: number
  p1Pts: string
  p2Pts: string
  setUnit: string
  setOrdinal: (n: number) => string
}) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'auto auto 1px auto',
      columnGap: 8, alignItems: 'center',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1, color: LIVE_RED }}>
        <span style={{ fontSize: 12, fontWeight: 900 }}>{setOrdinal(currentSetNumber)}</span>
        <span style={{
          fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: 0.4, marginTop: 2, opacity: 0.85,
        }}>{setUnit}</span>
      </div>

      <div style={{ display: 'flex', gap: 8, fontVariantNumeric: 'tabular-nums' }}>
        {sets.map(s => {
          const parsed = parseSetScore(s.set_score) ?? parseSetFromGames(s.pair1_games, s.pair2_games)
          const p1 = parsed?.p1 ?? s.pair1_games ?? 0
          const p2 = parsed?.p2 ?? s.pair2_games ?? 0
          const isCurrent = s.is_current
          return (
            <div key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
              <span style={{
                fontSize: 15, fontWeight: 800, fontFamily: 'monospace',
                minWidth: 14, textAlign: 'center',
                color: isCurrent ? GREEN : (p1 > p2 ? '#fff' : 'rgba(156,163,175,0.75)'),
              }}>{p1}</span>
              <span style={{
                fontSize: 15, fontWeight: 800, fontFamily: 'monospace',
                minWidth: 14, textAlign: 'center',
                color: isCurrent ? GREEN : (p2 > p1 ? '#fff' : 'rgba(156,163,175,0.75)'),
              }}>{p2}</span>
            </div>
          )
        })}
      </div>

      <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,0.18)' }} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
        <span style={{
          fontSize: 16, fontWeight: 900, color: LIVE_RED, fontFamily: 'monospace',
          minWidth: 22, textAlign: 'center',
        }}>{p1Pts || '—'}</span>
        <span style={{
          fontSize: 16, fontWeight: 900, color: LIVE_RED, fontFamily: 'monospace',
          minWidth: 22, textAlign: 'center',
        }}>{p2Pts || '—'}</span>
      </div>
    </div>
  )
}

function FinishedRight({ sets, label }: {
  sets: any[]
  label: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      <span style={{
        fontSize: 8, fontWeight: 900, letterSpacing: 0.6,
        textTransform: 'uppercase', color: MUTED,
      }}>{label}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontVariantNumeric: 'tabular-nums' }}>
        {[1, 2].map(pairNum => (
          <div key={pairNum} style={{ display: 'flex', gap: 6 }}>
            {sets.map(s => {
              const parsed = parseSetScore(s.set_score) ?? parseSetFromGames(s.pair1_games, s.pair2_games)
              const games = pairNum === 1 ? (parsed?.p1 ?? s.pair1_games ?? 0) : (parsed?.p2 ?? s.pair2_games ?? 0)
              const oppGames = pairNum === 1 ? (parsed?.p2 ?? s.pair2_games ?? 0) : (parsed?.p1 ?? s.pair1_games ?? 0)
              const wonSet = games > oppGames
              return (
                <span key={s.id} style={{
                  fontSize: 15, fontWeight: 800, fontFamily: 'monospace',
                  minWidth: 14, textAlign: 'center',
                  color: wonSet ? '#fff' : 'rgba(156,163,175,0.75)',
                }}>
                  {games}
                </span>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function UpcomingRight({ match, format, t }: {
  match: Match
  format: ReturnType<typeof useFormatter>
  t: ReturnType<typeof useTranslations>
}) {
  const { isNotifying, toggleNotify } = useMatchNotification(match.id)

  const scheduleDisplay = (() => {
    if (!match.scheduled_at) return { time: '', date: '', approximate: false }
    const d = new Date(match.scheduled_at)
    const hasTime = d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0
    const time = hasTime ? format.dateTime(d, TIME_24H) : ''
    const date = format.dateTime(d, DATE_SHORT)
    const label = (match as any).schedule_label ?? ''
    const approximate = /not before|followed by/i.test(label)
    return { time, date, approximate }
  })()

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
        <FollowButton
          type="match"
          targetId={match.id}
          variant="star"
          size={14}
          style={{
            width: 30, height: 30,
            background: 'rgba(255,255,255,0.04)',
            border: `1px solid ${BORDER}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            clipPath: CHUNKY.badge,
          }}
        />
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleNotify() }}
          aria-label={t('notifyOnMatchStart')}
          aria-pressed={isNotifying}
          style={{
            width: 30, height: 30,
            background: isNotifying ? 'rgba(126,211,33,0.14)' : 'rgba(255,255,255,0.04)',
            border: isNotifying ? '1px solid transparent' : `1px solid ${BORDER}`,
            color: isNotifying ? GREEN : 'rgba(156,163,175,0.9)',
            cursor: 'pointer', padding: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            clipPath: CHUNKY.badge,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </button>
      </div>
      {(scheduleDisplay.date || scheduleDisplay.time) && (
        <div style={{ textAlign: 'right', minWidth: 48 }}>
          <div style={{ fontSize: 10, color: MUTED, fontWeight: 600, letterSpacing: 0.3 }}>
            {scheduleDisplay.date}
          </div>
          {scheduleDisplay.time && (
            <div style={{ fontSize: 16, color: GREEN, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
              {scheduleDisplay.time}{scheduleDisplay.approximate ? '*' : ''}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default MatchRow

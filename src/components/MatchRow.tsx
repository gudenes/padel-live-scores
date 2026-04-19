'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { useFormatter } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { TIME_24H, DATE_SHORT } from '@/lib/format-patterns'
import { Match, pairName, parseSetScore, parseSetFromGames } from '@/types/match'
import FollowButton from '@/components/FollowButton'
import { FlagImage } from '@/components/FlagImage'

// Brand colours — local duplication for now; future extraction candidate
const GREEN = '#7ED321'
const ORANGE = '#F5A623'
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
  const sets = (match.sets ?? []).sort((a, b) => a.set_number - b.set_number)
  const currentSet = sets.find(s => s.is_current)
  const currentGame = currentSet?.games?.find(g => g.is_current)
  // Live point score comes from the last entry in the points[] array
  // (game_score is the running game count like "1-1", NOT the point score)
  // Points format: "30:40", "A:40", "15:15", etc.
  const currentPoints = currentGame?.points?.length
    ? currentGame.points[currentGame.points.length - 1]
    : ''
  const pointsParts = (currentPoints ?? '').split(/[:\-]/)
  const p1GamePts = pointsParts[0] ?? ''
  const p2GamePts = pointsParts[1] ?? ''
  const isLive = match.status === 'live'
  const isFinished = ['finished', 'retired', 'walkover'].includes(match.status)
  const isLingering = isFinished && _finishedAt.has(match.id)
  const category = (match as any).category as string | null
  const genderColor = category === 'women' ? WOMEN_PURPLE : category === 'men' ? MEN_BLUE : MUTED

  const pair1Name = pairName(match.pair1_player1, match.pair1_player2)
  const pair2Name = pairName(match.pair2_player1, match.pair2_player2)

  const roundLabel = match.round ?? ''
  const courtLabel = match.court ?? ''

  const scheduleDisplay = (() => {
    if (!match.scheduled_at) return { time: '', date: '', approximate: false }
    const d = new Date(match.scheduled_at)
    const hasTime = d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0
    const time = hasTime
      ? format.dateTime(d, TIME_24H)
      : ''
    const date = format.dateTime(d, DATE_SHORT)
    // Check if schedule_label indicates approximate time ("Not before", "Followed by")
    const label = (match as any).schedule_label ?? ''
    const approximate = /not before|followed by/i.test(label)
    return { time, date, approximate }
  })()
  const timeStr = scheduleDisplay.time

  // ── Prediction check (hydration-safe) ─────────────────────
  const [hasPrediction, setHasPrediction] = useState(false)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('pn_match_predictions')
      if (raw) setHasPrediction(!!JSON.parse(raw)[match.id])
    } catch {}
  }, [match.id])

  // ─── Score-change flash animation ──────────────────────────
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

      // Check if games changed first (most reliable signal)
      if (cur.p1Games > prev.p1Games) scorer = 1
      else if (cur.p2Games > prev.p2Games) scorer = 2
      else {
        // Games same — check point change direction
        const curP1 = PT_ORD[cur.p1Pts] ?? 0
        const curP2 = PT_ORD[cur.p2Pts] ?? 0
        const prevP1 = PT_ORD[prev.p1Pts] ?? 0
        const prevP2 = PT_ORD[prev.p2Pts] ?? 0

        if (curP1 > prevP1) scorer = 1
        else if (curP2 > prevP2) scorer = 2
        // Advantage lost → other pair scored (deuce scenarios)
        else if (prevP1 > prevP2 && curP1 <= curP2) scorer = 2
        else if (prevP2 > prevP1 && curP2 <= curP1) scorer = 1
      }

      // Always update before any early return
      _prevScores.set(match.id, cur)

      if (scorer) {
        flashKeyRef.current += 1
        setFlashPair(scorer)
        const t = setTimeout(() => setFlashPair(null), 2800)
        return () => clearTimeout(t)
      }
    } else {
      _prevScores.set(match.id, cur)
    }
  }, [isLive, match.id, p1TotalGames, p2TotalGames, p1GamePts, p2GamePts])

  return (
    <Link href={`/match/${match.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
      <div style={{
        position: 'relative',
        padding: '12px 14px 12px 17px',
        borderBottom: `1px solid ${BORDER}`,
        overflow: 'hidden',
      }}>
        {/* Gender accent bar (left) */}
        <div style={{
          position: 'absolute',
          top: 4, left: 0, bottom: 4,
          width: 3,
          background: genderColor,
        }} />
        {!isLive && <FollowButton type="match" targetId={match.id} variant="star" size={14} style={{ position: 'absolute', top: 8, right: 8 }} />}

        {/* Top row: round + court + status/time */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {roundLabel && (
              <span style={{
                fontSize: 9, fontWeight: 700, color: MUTED,
                padding: '2px 7px',
                background: 'rgba(255,255,255,0.04)',
                clipPath: CHUNKY.badge,
                textTransform: 'uppercase',
                letterSpacing: 0.3,
              }}>
                {roundLabel}
              </span>
            )}
            {courtLabel && (
              <span style={{
                fontSize: 9, fontWeight: 700, color: MUTED,
                padding: '2px 7px',
                background: 'rgba(255,255,255,0.04)',
                clipPath: CHUNKY.badge,
                textTransform: 'uppercase',
                letterSpacing: 0.3,
              }}>
                {courtLabel}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {isLive && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 4,
                background: LIVE_RED,
                padding: '2px 8px',
                clipPath: CHUNKY.badge,
              }}>
                <span style={{
                  width: 5, height: 5, borderRadius: '50%', background: '#fff',
                  animation: 'v3-scores-pulse 2s infinite',
                  flexShrink: 0,
                }} />
                <span style={{ fontSize: 8, fontWeight: 800, color: '#fff', letterSpacing: 0.5 }}>LIVE</span>
              </div>
            )}
            {isLingering && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 4,
                background: GREEN,
                padding: '2px 8px',
                clipPath: CHUNKY.badge,
              }}>
                <span style={{ fontSize: 8, fontWeight: 800, color: '#000', letterSpacing: 0.5 }}>FINAL</span>
              </div>
            )}
            {/* Date/time moved to player row area — see below */}
            {isFinished && !isLingering && (match as any).status === 'retired' && (
              <span style={{ fontSize: 9, fontWeight: 700, color: ORANGE }}>RET</span>
            )}
            {isFinished && !isLingering && (match as any).status === 'walkover' && (
              <span style={{ fontSize: 9, fontWeight: 700, color: ORANGE }}>W/O</span>
            )}
            {hasPrediction && !isLive && !isFinished && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 3,
                background: 'rgba(126,211,33,0.06)',
                padding: '2px 8px',
                clipPath: CHUNKY.badge,
                border: '0.5px solid rgba(126,211,33,0.15)',
              }}>
                <svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke="#7ED321" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="10" r="8"/><path d="M8 18h8"/><path d="M7 21h10"/>
                </svg>
                <span style={{ fontSize: 7, fontWeight: 700, color: '#7ED321', letterSpacing: 0.3 }}>PREDICTED</span>
              </div>
            )}
          </div>
        </div>

        {/* Pair rows with scores + schedule */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
        {[
          { pair: pair1Name, p1: match.pair1_player1, p2: match.pair1_player2, pairNum: 1 },
          { pair: pair2Name, p1: match.pair2_player1, p2: match.pair2_player2, pairNum: 2 },
        ].map(({ pair, p1, p2, pairNum }) => {
          const isWinner = match.winner_pair === pairNum
          const isLoser = match.winner_pair && match.winner_pair !== pairNum
          const isRolling = flashPair === pairNum
          const pts = pairNum === 1 ? p1GamePts : p2GamePts
          return (
            <div key={pairNum} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '4px 0',
              position: 'relative',
              overflow: 'hidden',
            }}>
              {/* Score-sweep banner — appears for ~2.5s when this pair scores.
                  Keyed on flashKeyRef so multiple consecutive points re-trigger
                  the animation cleanly. pointer-events:none keeps the row tappable.
                  Background is rgba with 60% alpha so the player names + scores
                  underneath stay readable while the banner is on top. */}
              {isRolling && (
                <div
                  key={`sweep-${flashKeyRef.current}`}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(255, 70, 85, 0.6)',
                    animation: 'v3-score-sweep 2.5s cubic-bezier(0.4, 0, 0.2, 1) forwards',
                    pointerEvents: 'none',
                    zIndex: 1,
                    willChange: 'transform, opacity',
                  }}
                />
              )}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0,
                position: 'relative', zIndex: 2,
                opacity: isLoser ? 0.65 : 1,
              }}>
                {/* Stacked overlapping dual flags — same pattern as latest results */}
                <div style={{ position: 'relative', width: 24, height: 18, flexShrink: 0 }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, zIndex: 2 }}>
                    <FlagImage country={p1?.country ?? null} size={14} />
                  </div>
                  <div style={{ position: 'absolute', top: 5, left: 7, zIndex: 1 }}>
                    <FlagImage country={p2?.country ?? null} size={14} />
                  </div>
                </div>
                <span style={{
                  fontSize: 13, fontWeight: 700, color: isWinner ? '#fff' : '#e0e0e0',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {pair}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, position: 'relative', zIndex: 2 }}>
                {sets.map(s => {
                  const parsed = parseSetScore(s.set_score) ?? parseSetFromGames(s.pair1_games, s.pair2_games)
                  const games = pairNum === 1 ? (parsed?.p1 ?? s.pair1_games) : (parsed?.p2 ?? s.pair2_games)
                  const oppGames = pairNum === 1 ? (parsed?.p2 ?? s.pair2_games) : (parsed?.p1 ?? s.pair1_games)
                  const isCurrent = s.is_current
                  const wonSet = games > oppGames
                  const showTb = parsed?.tb != null && !wonSet
                  return (
                    <span key={s.id} style={{
                      position: 'relative',
                      fontSize: 15, fontWeight: 700, fontFamily: 'monospace',
                      color: isCurrent && isLive ? GREEN : wonSet ? '#fff' : '#B0B5BE',
                      minWidth: 14, textAlign: 'center',
                    }}>
                      {games}
                      {showTb && (
                        <sup style={{ fontSize: 8, color: MUTED, position: 'absolute', top: -2, right: -4 }}>{parsed!.tb}</sup>
                      )}
                    </span>
                  )
                })}
                {isLive && (p1GamePts || p2GamePts) && (
                  <span
                    key={isRolling ? `${pts}-${flashKeyRef.current}` : pts}
                    style={{
                      display: 'inline-block',
                      fontSize: 16, fontWeight: 800, fontFamily: 'monospace',
                      color: LIVE_RED, minWidth: 18, textAlign: 'center',
                      marginLeft: 2,
                      overflow: 'hidden',
                      ...(isRolling ? { animation: 'v3-score-roll 0.9s cubic-bezier(0.34, 1.56, 0.64, 1) both' } : {}),
                    }}
                  >
                    {pts}
                  </span>
                )}
              </div>
            </div>
          )
        })}
        </div>
        {/* Schedule date/time — right side, aligned with player rows */}
        {!isLive && !isFinished && (scheduleDisplay.date || timeStr) && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
            justifyContent: 'center', flexShrink: 0, marginLeft: 8, marginRight: 16,
            minWidth: 42,
          }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', lineHeight: 1.2 }}>
              {scheduleDisplay.date}
            </span>
            {timeStr && (
              <span style={{ fontSize: 13, fontWeight: 800, color: GREEN, lineHeight: 1.2 }}>
                {timeStr}{scheduleDisplay.approximate ? '*' : ''}
              </span>
            )}
          </div>
        )}
        </div>
      </div>
    </Link>
  )
}

export default MatchRow

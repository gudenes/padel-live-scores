'use client'

// src/app/components/CompactMatchCard.tsx
// Compact match card — date column on left, spaced set scores on right.
// Used on the home page for finished/recent matches.
// Live variant: date column replaced by pulsing LIVE indicator.

import { useRouter } from '@/i18n/navigation'
import { useRef, useEffect, useState } from 'react'
import { Match, pairName, countryFlag, parseSetScore, getCurrentScore, isWarmingUp } from '@/types/match'

interface CompactMatchCardProps {
  match: Match
  embedded?: boolean
}

function PlayerName({ player, isWinner, isLoser }: { player: any; isWinner: boolean; isLoser: boolean }) {
  return (
    <div style={{
      fontSize: 12,
      fontWeight: isWinner ? 700 : 600,
      color: isLoser ? 'var(--text-muted)' : 'var(--text-primary)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }}>
      {player?.country && <span style={{ marginRight: 3 }}>{countryFlag(player.country)}</span>}
      {pairName(player, null)}
    </div>
  )
}

export default function CompactMatchCard({ match, embedded }: CompactMatchCardProps) {
  const router = useRouter()

  const { pair1Sets, pair2Sets, currentSet, currentGame } = getCurrentScore(match)
  const pointsWithoutServeMarker = (currentGame?.points ?? []).filter(p => p !== '0:0')
  const currentPoint = pointsWithoutServeMarker.slice(-1)[0] ?? null
  const [p1Point, p2Point] = currentPoint ? currentPoint.split(':') : [null, null]

  const status = match.status as string
  const isFinished = status === 'finished' || status === 'retired' || status === 'ended'
  const isLive = status === 'live'
  const isRetired = status === 'retired'
  const isUpcoming = status === 'scheduled'
  const isWalkover = status === 'walkover'
  const isWarming = isWarmingUp(match)
  const winnerPair = (match as any).winner_pair

  // Pop animation on point change for live matches
  const prevP1Point = useRef<string | null>(null)
  const prevP2Point = useRef<string | null>(null)
  const [p1Popping, setP1Popping] = useState(false)
  const [p2Popping, setP2Popping] = useState(false)

  useEffect(() => {
    if (!isLive) return
    if (prevP1Point.current !== null && prevP1Point.current !== p1Point) {
      setP1Popping(true)
      setTimeout(() => setP1Popping(false), 450)
    }
    prevP1Point.current = p1Point ?? null
  }, [p1Point, isLive])

  useEffect(() => {
    if (!isLive) return
    if (prevP2Point.current !== null && prevP2Point.current !== p2Point) {
      setP2Popping(true)
      setTimeout(() => setP2Popping(false), 450)
    }
    prevP2Point.current = p2Point ?? null
  }, [p2Point, isLive])

  const p1Won = isFinished && winnerPair === 1
  const p2Won = isFinished && winnerPair === 2

  // Only display sets with a real score OR the current in-progress set
  const displaySets = (match.sets ?? []).filter(
    (s: any) => s.set_score !== null || s.is_current
  )

  const category = (match as any).category as string | null
  const genderAccent = category === 'men' ? 'var(--color-men)' : category === 'women' ? 'var(--color-women)' : 'transparent'

  // Round label — short form for the left column
  const roundShort = (() => {
    const r = match.round as string | null
    if (!r) return null
    const map: Record<string, string> = {
      'Finals': 'F', 'Final': 'F', 'F': 'F',
      'Semifinals': 'SF', 'Semi': 'SF', 'SF': 'SF',
      'Quarterfinals': 'QF', 'Quarter': 'QF', 'Quarters': 'QF', 'QF': 'QF',
      'Round of 16': 'R16', 'R16': 'R16',
      'Round of 32': 'R32', 'R32': 'R32',
      'Round of 64': 'R64', 'R64': 'R64',
    }
    return map[r] ?? r
  })()

  // Status label for the left column
  const statusLabel = (() => {
    if (isLive) return null // live has its own indicator
    if (isWalkover) return 'W/O'
    if (isRetired) return 'RET'
    if (isFinished) return 'FIN'
    if (isUpcoming) return null
    return null
  })()

  // Date from match
  const matchDate = (() => {
    const src = (match as any).finished_at ?? match.scheduled_at ?? match.started_at
    if (!src) return null
    try {
      const d = new Date(src)
      return {
        day: d.toLocaleDateString(undefined, { day: 'numeric' }),
        month: d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
      }
    } catch { return null }
  })()

  // Divider line for the left column
  const ColDivider = () => (
    <div style={{ width: 28, height: 1, background: 'rgba(255,255,255,0.15)', margin: '4px 0' }} />
  )

  // Shared left column with date + round + status
  const DateColumn = () => (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '8px 10px', background: 'rgba(255,255,255,0.025)', minWidth: 56,
    }}>
      {roundShort && (
        <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{roundShort}</span>
      )}
      {roundShort && matchDate && <ColDivider />}
      {matchDate && (
        <>
          <span style={{ fontSize: 18, fontWeight: 900, color: 'var(--text-primary)', lineHeight: 1, fontFamily: 'var(--font-mono)' }}>{matchDate.day}</span>
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 2 }}>{matchDate.month}</span>
        </>
      )}
      {statusLabel && matchDate && <ColDivider />}
      {statusLabel && (
        <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{statusLabel}</span>
      )}
    </div>
  )

  const cardStyle: React.CSSProperties = embedded ? {
    background: 'transparent',
    borderLeft: `3px solid ${genderAccent}`,
    borderRadius: 6,
    marginBottom: 3,
    overflow: 'hidden',
    cursor: 'pointer',
    display: 'flex',
  } : {
    background: 'var(--bg-card)',
    border: '0.5px solid var(--border-card)',
    borderLeft: `3px solid ${genderAccent}`,
    borderRadius: 8,
    marginBottom: 5,
    overflow: 'hidden',
    cursor: 'pointer',
    display: 'flex',
  }

  // ── Walkover card ─────────────────────────────────────────────
  if (isWalkover) {
    const woWinner = winnerPair === 1
      ? pairName(match.pair1_player1, match.pair1_player2)
      : winnerPair === 2
      ? pairName(match.pair2_player1, match.pair2_player2)
      : 'TBD'

    return (
      <div onClick={() => router.push(`/match/${match.id}`)} style={cardStyle}>
        <DateColumn />
        <div style={{ flex: 1, padding: '7px 10px', minWidth: 0 }}>
          <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 600 }}>
            {woWinner} <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>wins by walkover</span>
          </div>
        </div>
      </div>
    )
  }

  // ── Warming up card ───────────────────────────────────────────
  if (isWarming) {
    return (
      <div onClick={() => router.push(`/match/${match.id}`)} style={cardStyle}>
        {/* Live indicator with round */}
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: '8px 10px', background: 'rgba(239,68,68,0.05)', minWidth: 56,
        }}>
          {roundShort && <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{roundShort}</span>}
          {roundShort && <ColDivider />}
          <div style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--color-live)', animation: 'compactCardPulse 2s infinite', marginTop: 3 }} />
          <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--color-live)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 3 }}>WARM</span>
        </div>
        <div style={{ flex: 1, padding: '7px 10px', minWidth: 0 }}>
          <div style={{ borderBottom: '0.5px solid var(--border-inner)', paddingBottom: 3, marginBottom: 3 }}>
            <PlayerName player={match.pair1_player1} isWinner={false} isLoser={false} />
            <div style={{ marginTop: 1 }}><PlayerName player={match.pair1_player2} isWinner={false} isLoser={false} /></div>
          </div>
          <div>
            <PlayerName player={match.pair2_player1} isWinner={false} isLoser={false} />
            <div style={{ marginTop: 1 }}><PlayerName player={match.pair2_player2} isWinner={false} isLoser={false} /></div>
          </div>
        </div>
      </div>
    )
  }

  // ── Scheduled card ────────────────────────────────────────────
  if (isUpcoming) {
    // Parse schedule time
    const scheduleLabel = (match as any).schedule_label as string | null
    const scheduledTime = (() => {
      const src = match.scheduled_at ?? match.started_at
      if (!src) return scheduleLabel ?? null
      try {
        const d = new Date(src)
        if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) return scheduleLabel ?? null
        return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
      } catch { return scheduleLabel ?? null }
    })()

    return (
      <div onClick={() => router.push(`/match/${match.id}`)} style={cardStyle}>
        {/* Left column: round + date/time */}
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: '8px 10px', background: 'rgba(255,255,255,0.025)', minWidth: 56,
        }}>
          {roundShort && <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{roundShort}</span>}
          {roundShort && matchDate && <ColDivider />}
          {matchDate && (
            <>
              <span style={{ fontSize: 18, fontWeight: 900, color: 'var(--text-primary)', lineHeight: 1, fontFamily: 'var(--font-mono)' }}>{matchDate.day}</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 2 }}>{matchDate.month}</span>
            </>
          )}
          {scheduledTime && (matchDate || roundShort) && <ColDivider />}
          {scheduledTime && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{scheduledTime}</span>}
        </div>
        <div style={{ flex: 1, padding: '7px 10px', minWidth: 0 }}>
          <div style={{ borderBottom: '0.5px solid var(--border-inner)', paddingBottom: 3, marginBottom: 3 }}>
            <PlayerName player={match.pair1_player1} isWinner={false} isLoser={false} />
            <div style={{ marginTop: 1 }}><PlayerName player={match.pair1_player2} isWinner={false} isLoser={false} /></div>
          </div>
          <div>
            <PlayerName player={match.pair2_player1} isWinner={false} isLoser={false} />
            <div style={{ marginTop: 1 }}><PlayerName player={match.pair2_player2} isWinner={false} isLoser={false} /></div>
          </div>
        </div>
      </div>
    )
  }

  // ── Main card (live + finished) ───────────────────────────────
  return (
    <div onClick={() => router.push(`/match/${match.id}`)} style={cardStyle}>
      {/* Left column: date or live indicator */}
      {isLive ? (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: '8px 10px', background: 'rgba(239,68,68,0.05)', minWidth: 56,
        }}>
          {roundShort && <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{roundShort}</span>}
          {roundShort && <ColDivider />}
          <div style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--color-live)', animation: 'compactCardPulse 2s infinite', marginTop: 3 }} />
          <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--color-live)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 3 }}>LIVE</span>
        </div>
      ) : (
        <DateColumn />
      )}

      {/* Right: match content */}
      <div style={{ flex: 1, padding: '7px 10px', minWidth: 0 }}>
        {/* Pair 1 */}
        <div style={{ display: 'flex', alignItems: 'center', borderBottom: '0.5px solid var(--border-inner)', paddingBottom: 3, marginBottom: 3 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <PlayerName player={match.pair1_player1} isWinner={p1Won} isLoser={p2Won} />
              {isRetired && p2Won && <span style={{ fontSize: 8, color: '#f87171', background: 'rgba(248,113,113,0.1)', border: '0.5px solid rgba(248,113,113,0.3)', borderRadius: 4, padding: '1px 5px', fontWeight: 600, flexShrink: 0 }}>RET</span>}
            </div>
            <div style={{ marginTop: 1 }}>
              <PlayerName player={match.pair1_player2} isWinner={p1Won} isLoser={p2Won} />
            </div>
          </div>
          {/* Set scores */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, marginRight: 2 }}>
            {displaySets.map((set) => {
              const parsed = parseSetScore(set.set_score)
              const p1WonSet = parsed ? parsed.p1 > parsed.p2 : false
              return (
                <span key={set.set_number} style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 16,
                  fontWeight: 900,
                  width: 16,
                  textAlign: 'center' as const,
                  lineHeight: 1,
                  color: set.is_current
                    ? 'var(--text-muted)'
                    : parsed
                      ? (p1WonSet ? 'var(--text-primary)' : 'var(--text-dim)')
                      : 'var(--text-muted)',
                  position: 'relative' as const,
                }}>
                  {parsed ? parsed.p1 : ((set as any).pair1_games ?? 0)}
                  {parsed?.tb != null && !p1WonSet && <sup style={{ fontSize: 8, color: 'var(--text-muted)', position: 'absolute' as const, top: -3, right: -5 }}>{parsed.tb}</sup>}
                </span>
              )
            })}
            {isLive && (
              <>
                <div style={{ width: 1, height: 26, background: 'var(--border-strong)' }} />
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 900,
                  color: 'var(--color-live)',
                  display: 'inline-block',
                  transform: p1Popping ? 'scale(1.5)' : 'scale(1)',
                  transition: p1Popping ? 'transform 0.15s cubic-bezier(0.34,1.56,0.64,1)' : 'transform 0.3s ease-out',
                }}>
                  {p1Point ?? (currentSet ? '0' : pair1Sets)}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Pair 2 */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <PlayerName player={match.pair2_player1} isWinner={p2Won} isLoser={p1Won} />
              {isRetired && p1Won && <span style={{ fontSize: 8, color: '#f87171', background: 'rgba(248,113,113,0.1)', border: '0.5px solid rgba(248,113,113,0.3)', borderRadius: 4, padding: '1px 5px', fontWeight: 600, flexShrink: 0 }}>RET</span>}
            </div>
            <div style={{ marginTop: 1 }}>
              <PlayerName player={match.pair2_player2} isWinner={p2Won} isLoser={p1Won} />
            </div>
          </div>
          {/* Set scores */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, marginRight: 2 }}>
            {displaySets.map((set) => {
              const parsed = parseSetScore(set.set_score)
              const p2WonSet = parsed ? parsed.p2 > parsed.p1 : false
              return (
                <span key={set.set_number} style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 16,
                  fontWeight: 900,
                  width: 16,
                  textAlign: 'center' as const,
                  lineHeight: 1,
                  color: set.is_current
                    ? 'var(--text-muted)'
                    : parsed
                      ? (p2WonSet ? 'var(--text-primary)' : 'var(--text-dim)')
                      : 'var(--text-muted)',
                  position: 'relative' as const,
                }}>
                  {parsed ? parsed.p2 : ((set as any).pair2_games ?? 0)}
                  {parsed?.tb != null && !p2WonSet && <sup style={{ fontSize: 8, color: 'var(--text-muted)', position: 'absolute' as const, top: -3, right: -5 }}>{parsed.tb}</sup>}
                </span>
              )
            })}
            {isLive && (
              <>
                <div style={{ width: 1, height: 26, background: 'var(--border-strong)' }} />
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 900,
                  color: 'var(--color-live)', opacity: 0.3,
                  display: 'inline-block',
                  transform: p2Popping ? 'scale(1.5)' : 'scale(1)',
                  transition: p2Popping ? 'transform 0.15s cubic-bezier(0.34,1.56,0.64,1)' : 'transform 0.3s ease-out',
                }}>
                  {p2Point ?? (currentSet ? '0' : pair2Sets)}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Pulse animation for live indicator */}
      <style>{`
        @keyframes compactCardPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}

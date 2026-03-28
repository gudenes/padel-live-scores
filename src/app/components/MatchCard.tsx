'use client'

function getTimezoneOffset(tz: string, date: Date): number {
  try {
    const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false })
    const tzStr = date.toLocaleString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false })
    const [utcH, utcM] = utcStr.split(':').map(Number)
    const [tzH, tzM] = tzStr.split(':').map(Number)
    return (tzH * 60 + tzM) - (utcH * 60 + utcM)
  } catch {
    return 0
  }
}

// src/app/components/MatchCard.tsx

import { useRouter } from 'next/navigation'
import { useRef, useEffect, useState } from 'react'
import { Match, pairName, countryFlag, parseSetScore, getCurrentScore, isWarmingUp } from '@/types/match'

interface MatchCardProps {
  match: Match
  viewerCount: number
  expanded: boolean
  onToggle: () => void
  // Bookmark — only shown on scheduled matches
  bookmarked?: boolean
  onBookmark?: () => void
}

export default function MatchCard({ match, bookmarked, onBookmark }: MatchCardProps) {
  const router = useRouter()

  const { pair1Sets, pair2Sets, currentSet, currentGame } = getCurrentScore(match)
  // Get last point — exclude '0:0' serve marker (it is not a scored point)
  const pointsWithoutServeMarker = (currentGame?.points ?? []).filter(p => p !== '0:0')
  const currentPoint = pointsWithoutServeMarker.slice(-1)[0] ?? null
  const [p1Point, p2Point] = currentPoint ? currentPoint.split(':') : [null, null]

  // Serving pair — shown as ball icon next to player name in live matches
  const status = match.status as string  // cast to string to avoid TS union narrowing
  const isFinished = status === 'finished' || status === 'retired' || status === 'ended'
  const isUpcoming = status === 'scheduled'
  const isLive = status === 'live'
  const isEnded = status === 'ended'  // transitional — score being confirmed
  const isRetired = status === 'retired'
  const isWalkover = status === 'walkover'
  const isBye = status === 'bye'
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
  }, [p1Point])

  useEffect(() => {
    if (!isLive) return
    if (prevP2Point.current !== null && prevP2Point.current !== p2Point) {
      setP2Popping(true)
      setTimeout(() => setP2Popping(false), 450)
    }
    prevP2Point.current = p2Point ?? null
  }, [p2Point])

  const p1Won = isFinished && winnerPair === 1
  const p2Won = isFinished && winnerPair === 2

  // Only count sets with a real score (filter orphan null sets)
  const completedSets = (match.sets ?? []).filter((s: any) => s.set_score !== null)
  const p1SetsWon = completedSets.filter((s: any) => {
    const parsed = parseSetScore(s.set_score)
    return parsed ? parsed.p1 > parsed.p2 : false
  }).length
  const p2SetsWon = completedSets.filter((s: any) => {
    const parsed = parseSetScore(s.set_score)
    return parsed ? parsed.p2 > parsed.p1 : false
  }).length

  // Only display sets with a real score OR the current in-progress set
  const displaySets = (match.sets ?? []).filter(
    (s: any) => s.set_score !== null || s.is_current
  )

  const category = (match as any).category as string | null
  const genderAccent = category === 'men' ? 'var(--color-men)' : category === 'women' ? 'var(--color-women)' : 'transparent'
  const court = (match as any).court as string | null

  // Normalize abbreviated stage names from API to full standard names
  const normalizeRound = (r: string | null): string | null => {
    if (!r) return null
    const map: Record<string, string> = {
      'Quarter': 'Quarterfinals',
      'Quarters': 'Quarterfinals',
      'QF': 'Quarterfinals',
      'SF': 'Semifinals',
      'Semi': 'Semifinals',
      'Final': 'Finals',
      'F': 'Finals',
      'R16': 'Round of 16',
      'R32': 'Round of 32',
      'R64': 'Round of 64',
    }
    return map[r] ?? r
  }
  const roundLabel = normalizeRound(match.round as string | null)
  const scheduleLabel = (match as any).schedule_label as string | null

  const scheduledTime = (() => {
    if (scheduleLabel) {
      const timeMatch = scheduleLabel.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
      if (timeMatch) {
        try {
          const tournamentTz = (match as any).tournament?.timezone
          // If tournament timezone is unknown, show the raw schedule_label rather than converting incorrectly
          if (!tournamentTz) return scheduleLabel
          const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone
          let hours = parseInt(timeMatch[1])
          const minutes = parseInt(timeMatch[2])
          const ampm = timeMatch[3].toUpperCase()
          if (ampm === 'PM' && hours < 12) hours += 12
          if (ampm === 'AM' && hours === 12) hours = 0
          const today = new Date().toLocaleDateString('en-CA', { timeZone: tournamentTz })
          const naiveUTC = new Date(`${today}T${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:00Z`)
          const tournamentOffset = getTimezoneOffset(tournamentTz, naiveUTC)
          const realUTC = new Date(naiveUTC.getTime() - tournamentOffset * 60000)
          return realUTC.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: userTz })
        } catch {
          return scheduleLabel
        }
      }
      return scheduleLabel
    }
    const src = match.scheduled_at ?? match.started_at
    if (!src) return null
    try {
      const d = new Date(src)
      if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) return null
      const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone
      return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: userTz }).format(d)
    } catch { return null }
  })()

  // ── Walkover card ─────────────────────────────────────────────
  if (isWalkover) {
    const woWinner = winnerPair === 1
      ? pairName(match.pair1_player1, match.pair1_player2)
      : winnerPair === 2
      ? pairName(match.pair2_player1, match.pair2_player2)
      : 'TBD'

    return (
      <div
        onClick={() => router.push(`/match/${match.id}`)}
        style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-card)', borderLeft: `3px solid ${genderAccent}`, borderRadius: 10, marginBottom: 5, overflow: 'hidden', cursor: 'pointer', width: '100%', boxSizing: 'border-box' }}
      >
        <div style={{ padding: '5px 10px 6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            <span style={{ fontSize: 9, color: '#888', fontWeight: 600, letterSpacing: '0.3px' }}>W/O</span>
            {roundLabel && <span style={{ fontSize: 9, color: 'var(--text-secondary)', background: 'var(--bg-card-alt)', borderRadius: 4, padding: '1px 6px', fontWeight: 500, border: '0.5px solid var(--border-strong)' }}>{roundLabel}</span>}
            {court && <span style={{ fontSize: 9, color: 'var(--text-secondary)', background: 'var(--bg-card-alt)', borderRadius: 4, padding: '1px 6px', fontWeight: 500, border: '0.5px solid var(--border-strong)', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{court}</span>}
          </div>
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
      <div
        onClick={() => router.push(`/match/${match.id}`)}
        style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-card)', borderLeft: `3px solid ${genderAccent}`, borderRadius: 10, marginBottom: 5, overflow: 'hidden', cursor: 'pointer', width: '100%', boxSizing: 'border-box' }}
      >
        <div style={{ padding: '5px 10px 6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            <span style={{ fontSize: 9, color: 'var(--color-live)', fontWeight: 600, letterSpacing: '0.3px' }}>⚬ WARMING UP</span>
            {roundLabel && <span style={{ fontSize: 9, color: 'var(--text-secondary)', background: 'var(--bg-card-alt)', borderRadius: 4, padding: '1px 6px', fontWeight: 500, border: '0.5px solid var(--border-strong)' }}>{roundLabel}</span>}
            {court && <span style={{ fontSize: 9, color: 'var(--text-secondary)', background: 'var(--bg-card-alt)', borderRadius: 4, padding: '1px 6px', fontWeight: 500, border: '0.5px solid var(--border-strong)', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{court}</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ borderBottom: '0.5px solid var(--border-inner)', paddingBottom: 3, marginBottom: 3 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {match.pair1_player1?.country && <span style={{ marginRight: 3 }}>{countryFlag(match.pair1_player1.country)}</span>}
                  {pairName(match.pair1_player1, null)}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
                  {match.pair1_player2?.country && <span style={{ marginRight: 3 }}>{countryFlag(match.pair1_player2.country)}</span>}
                  {pairName(match.pair1_player2, null)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {match.pair2_player1?.country && <span style={{ marginRight: 3 }}>{countryFlag(match.pair2_player1.country)}</span>}
                  {pairName(match.pair2_player1, null)}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
                  {match.pair2_player2?.country && <span style={{ marginRight: 3 }}>{countryFlag(match.pair2_player2.country)}</span>}
                  {pairName(match.pair2_player2, null)}
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      onClick={() => router.push(`/match/${match.id}`)}
      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-card)', borderLeft: `3px solid ${genderAccent}`, borderRadius: 10, marginBottom: 5, overflow: 'hidden', cursor: 'pointer', width: '100%', boxSizing: 'border-box' }}
    >
      <div style={{ padding: '5px 10px 6px' }}>
        {isUpcoming ? (
          <>
            {(roundLabel || court) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                {roundLabel && <span style={{ fontSize: 9, color: 'var(--text-secondary)', background: 'var(--bg-card-alt)', borderRadius: 4, padding: '1px 6px', fontWeight: 500, border: '0.5px solid var(--border-strong)' }}>{roundLabel}</span>}
                {court && <span style={{ fontSize: 9, color: 'var(--text-secondary)', background: 'var(--bg-card-alt)', borderRadius: 4, padding: '1px 6px', fontWeight: 500, border: '0.5px solid var(--border-strong)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{court}</span>}
              </div>
            )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Players column + bookmark bell */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ borderBottom: '0.5px solid var(--border-inner)', paddingBottom: 3, marginBottom: 3 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
                    {match.pair1_player1?.country && <span style={{ marginRight: 3 }}>{countryFlag(match.pair1_player1.country)}</span>}
                    {pairName(match.pair1_player1, null)}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)', marginTop: 1 }}>
                    {match.pair1_player2?.country && <span style={{ marginRight: 3 }}>{countryFlag(match.pair1_player2.country)}</span>}
                    {pairName(match.pair1_player2, null)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
                    {match.pair2_player1?.country && <span style={{ marginRight: 3 }}>{countryFlag(match.pair2_player1.country)}</span>}
                    {pairName(match.pair2_player1, null)}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)', marginTop: 1 }}>
                    {match.pair2_player2?.country && <span style={{ marginRight: 3 }}>{countryFlag(match.pair2_player2.country)}</span>}
                    {pairName(match.pair2_player2, null)}
                  </div>
                </div>
              </div>
              {/* Bell bookmark — vertically centred alongside the player names */}
              {onBookmark && (
                <button
                  onClick={e => { e.stopPropagation(); onBookmark() }}
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    padding: 4, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    position: 'relative',
                  }}
                  aria-label={bookmarked ? 'Remove notification' : 'Notify me when this starts'}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24"
                    fill={bookmarked ? 'var(--color-bookmark)' : 'none'}
                    stroke={bookmarked ? 'var(--color-bookmark)' : 'var(--text-ghost)'}
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  >
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                  </svg>
                  {bookmarked && (
                    <span style={{
                      position: 'absolute', top: 2, right: 2,
                      width: 6, height: 6, borderRadius: '50%',
                      background: 'var(--color-live)',
                      border: '1px solid var(--bg-card)',
                    }} />
                  )}
                </button>
              )}
            </div>
            <div style={{ flexShrink: 0, width: 110, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              {scheduledTime ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#f5a623', lineHeight: 1.3 }}>{scheduledTime}</span>
                  <span style={{ fontSize: 9, fontWeight: 500, color: '#f5a623', background: 'rgba(245,166,35,0.1)', borderRadius: 4, padding: '1px 6px', border: '0.5px solid rgba(245,166,35,0.3)' }}>
                    {(() => {
                      try {
                        const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone
                        const tournamentTz = (match as any).tournament?.timezone
          // If tournament timezone is unknown, show the raw schedule_label rather than converting incorrectly
          if (!tournamentTz) return scheduleLabel
                        const label = (match as any).schedule_label ?? ''
                        const timeMatch = label.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
                        if (timeMatch) {
                          let hours = parseInt(timeMatch[1])
                          const minutes = parseInt(timeMatch[2])
                          const ampm = timeMatch[3].toUpperCase()
                          if (ampm === 'PM' && hours < 12) hours += 12
                          if (ampm === 'AM' && hours === 12) hours = 0
                          const today = new Date().toLocaleDateString('en-CA', { timeZone: tournamentTz })
                          const naiveUTC = new Date(`${today}T${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:00Z`)
                          const tournamentOffset = getTimezoneOffset(tournamentTz, naiveUTC)
                          const realUTC = new Date(naiveUTC.getTime() - tournamentOffset * 60000)
                          return realUTC.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: userTz })
                        }
                        const src = match.scheduled_at ?? match.started_at
                        if (!src) return null
                        return new Date(src).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: userTz })
                      } catch { return null }
                    })()}
                  </span>
                </div>
              ) : (
                <span style={{ fontSize: 10, fontWeight: 500, color: '#555' }}>After previous</span>
              )}
            </div>
          </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {isFinished && !isRetired && !isBye && <span style={{ fontSize: 9, color: 'var(--text-secondary)', fontWeight: 600, letterSpacing: '0.3px' }}>FINISHED</span>}
                {isRetired && <span style={{ fontSize: 9, color: '#f87171', fontWeight: 600, letterSpacing: '0.3px' }}>RETIRED</span>}
                {isBye && <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.3px' }}>BYE</span>}
                {isFinished && roundLabel && <span style={{ fontSize: 9, color: 'var(--text-secondary)', background: 'var(--bg-card-alt)', borderRadius: 4, padding: '1px 6px', fontWeight: 500, border: '0.5px solid var(--border-strong)' }}>{roundLabel}</span>}
                {isFinished && court && <span style={{ fontSize: 9, color: 'var(--text-secondary)', background: 'var(--bg-card-alt)', borderRadius: 4, padding: '1px 6px', fontWeight: 500, border: '0.5px solid var(--border-strong)', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{court}</span>}
                {isLive && <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.3px' }}>LIVE</span>}
                {isLive && roundLabel && <span style={{ fontSize: 9, color: 'var(--text-secondary)', background: 'var(--bg-card-alt)', borderRadius: 4, padding: '1px 6px', fontWeight: 500, border: '0.5px solid var(--border-strong)' }}>{roundLabel}</span>}
                {isLive && court && <span style={{ fontSize: 9, color: 'var(--text-secondary)', background: 'var(--bg-card-alt)', borderRadius: 4, padding: '1px 6px', fontWeight: 500, border: '0.5px solid var(--border-strong)', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{court}</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                <div style={{ display: 'flex', gap: 2, opacity: 0.7 }}>
                  {displaySets.map((set) => (
                    <span key={set.set_number} style={{ fontSize: 8, width: isLive ? 24 : 16, textAlign: 'center', color: set.is_current ? 'var(--color-success)' : 'var(--text-muted)', fontWeight: 600 }}>S{set.set_number}</span>
                  ))}
                  {isLive && <><span style={{ width: 4 }} /><span style={{ fontSize: 8, width: 32, textAlign: 'center', color: 'var(--text-muted)', fontWeight: 600, marginLeft: 8 }}>Pts</span></>}
                </div>
                {isFinished && <span style={{ fontSize: 8, width: 28, textAlign: 'center', color: 'var(--text-muted)', fontWeight: 600, marginLeft: 6 }}>Sets</span>}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'stretch', gap: 4 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Pair 1 */}
                <div style={{ display: 'flex', alignItems: 'stretch', gap: 6, borderBottom: '0.5px solid var(--border-inner)', paddingBottom: 3, marginBottom: 3 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ fontSize: 12, fontWeight: p1Won ? 700 : 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: p2Won ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
                        {match.pair1_player1?.country && <span style={{ marginRight: 3 }}>{countryFlag(match.pair1_player1.country)}</span>}
                        {pairName(match.pair1_player1, null)}
                      </span>
                      {isRetired && p2Won && <span style={{ fontSize: 8, color: '#f87171', background: 'rgba(248,113,113,0.1)', border: '0.5px solid rgba(248,113,113,0.3)', borderRadius: 4, padding: '1px 5px', fontWeight: 600, flexShrink: 0 }}>RET</span>}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: p1Won ? 700 : 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: p2Won ? 'var(--text-secondary)' : 'var(--text-primary)', marginTop: 1 }}>
                      {match.pair1_player2?.country && <span style={{ marginRight: 3 }}>{countryFlag(match.pair1_player2.country)}</span>}
                      {pairName(match.pair1_player2, null)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, flexShrink: 0 }}>
                    <div style={{ display: 'flex', gap: 2, alignItems: 'center', opacity: isFinished ? (p2Won ? 0.6 : 0.85) : 1 }}>
                      {displaySets.map((set) => {
                        const parsed = parseSetScore(set.set_score)
                        const p1WonSet = parsed ? parsed.p1 > parsed.p2 : false
                        return (
                          <span key={set.set_number} style={{ fontSize: isLive ? 20 : 13, fontWeight: 900, width: isLive ? 24 : 16, height: isLive ? 28 : 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', lineHeight: 1, position: 'relative', color: set.is_current ? 'var(--text-muted)' : parsed ? (p1WonSet ? 'var(--text-primary)' : 'var(--text-muted)') : 'var(--text-muted)' }}>
                            {parsed ? parsed.p1 : (set.pair1_games ?? 0)}
                            {parsed?.tb != null && !p1WonSet && <sup style={{ fontSize: 7, color: 'var(--text-muted)', position: 'absolute', top: 0, right: -1 }}>{parsed.tb}</sup>}
                          </span>
                        )
                      })}
                      {isLive && <><div style={{ width: '0.5px', height: 28, background: 'var(--border-strong)', marginLeft: 4 }} /><span style={{ fontSize: 24, fontWeight: 900, width: 32, textAlign: 'center', fontFamily: 'var(--font-mono)', lineHeight: 1, color: 'var(--color-success)', marginLeft: 4, display: 'inline-block', transform: p1Popping ? 'scale(1.5)' : 'scale(1)', transition: p1Popping ? 'transform 0.15s cubic-bezier(0.34,1.56,0.64,1)' : 'transform 0.3s ease-out' }}>{p1Point ?? (currentSet ? '0' : pair1Sets)}</span></>}
                    </div>
                    {isFinished && (
                      <span style={{ fontSize: 18, fontWeight: 900, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', lineHeight: 'normal', color: p1Won ? '#10b981' : 'var(--text-muted)', border: p1Won ? '1.5px solid rgba(16,185,129,0.5)' : '0.5px solid var(--border-strong)', borderRadius: 6, marginLeft: 6 }}>
                        {p1SetsWon}
                      </span>
                    )}
                  </div>
                </div>
                {/* Pair 2 */}
                <div style={{ display: 'flex', alignItems: 'stretch', gap: 6 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ fontSize: 12, fontWeight: p2Won ? 700 : 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: p1Won ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
                        {match.pair2_player1?.country && <span style={{ marginRight: 3 }}>{countryFlag(match.pair2_player1.country)}</span>}
                        {pairName(match.pair2_player1, null)}
                      </span>
                      {isRetired && p1Won && <span style={{ fontSize: 8, color: '#f87171', background: 'rgba(248,113,113,0.1)', border: '0.5px solid rgba(248,113,113,0.3)', borderRadius: 4, padding: '1px 5px', fontWeight: 600, flexShrink: 0 }}>RET</span>}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: p2Won ? 700 : 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: p1Won ? 'var(--text-secondary)' : 'var(--text-primary)', marginTop: 1 }}>
                      {match.pair2_player2?.country && <span style={{ marginRight: 3 }}>{countryFlag(match.pair2_player2.country)}</span>}
                      {pairName(match.pair2_player2, null)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, flexShrink: 0 }}>
                    <div style={{ display: 'flex', gap: 2, alignItems: 'center', opacity: isFinished ? (p1Won ? 0.6 : 0.85) : 1 }}>
                      {displaySets.map((set) => {
                        const parsed = parseSetScore(set.set_score)
                        const p2WonSet = parsed ? parsed.p2 > parsed.p1 : false
                        return (
                          <span key={set.set_number} style={{ fontSize: isLive ? 20 : 13, fontWeight: 900, width: isLive ? 24 : 16, height: isLive ? 28 : 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', lineHeight: 1, position: 'relative', color: set.is_current ? 'var(--text-muted)' : parsed ? (p2WonSet ? 'var(--text-primary)' : 'var(--text-muted)') : 'var(--text-muted)' }}>
                            {parsed ? parsed.p2 : (set.pair2_games ?? 0)}
                            {parsed?.tb != null && !p2WonSet && <sup style={{ fontSize: 7, color: 'var(--text-muted)', position: 'absolute', top: 0, right: -1 }}>{parsed.tb}</sup>}
                          </span>
                        )
                      })}
                      {isLive && <><div style={{ width: '0.5px', height: 28, background: 'var(--border-strong)', marginLeft: 4 }} /><span style={{ fontSize: 24, fontWeight: 900, width: 32, textAlign: 'center', fontFamily: 'var(--font-mono)', lineHeight: 1, color: 'var(--color-success)', opacity: 0.3, marginLeft: 4, display: 'inline-block', transform: p2Popping ? 'scale(1.5)' : 'scale(1)', transition: p2Popping ? 'transform 0.15s cubic-bezier(0.34,1.56,0.64,1)' : 'transform 0.3s ease-out' }}>{p2Point ?? (currentSet ? '0' : pair2Sets)}</span></>}
                    </div>
                    {isFinished && (
                      <span style={{ fontSize: 18, fontWeight: 900, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', lineHeight: 'normal', color: p2Won ? '#10b981' : 'var(--text-muted)', border: p2Won ? '1.5px solid rgba(16,185,129,0.5)' : '0.5px solid var(--border-strong)', borderRadius: 6, marginLeft: 6 }}>
                        {p2SetsWon}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

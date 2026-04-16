'use client'

import React, { useState, useEffect, useRef } from 'react'
import { Link } from '@/i18n/navigation'
import { Match, pairName, parseSetScore, parseSetFromGames } from '@/types/match'
import {
  GREEN, LIVE_RED, BG_CARD, MUTED, CHUNKY, FlagImg,
} from './shared'

// ── Live score-change detection ─────────────────────────────────
// Tracks the previous game/point counts per match so we can detect WHO
// scored on each refresh and trigger the red banner animation. Module-level
// so the state survives component remounts.
const PT_ORD: Record<string, number> = { '0': 0, '15': 1, '30': 2, '40': 3, 'AD': 4 }
const _liveScoresPrev = new Map<string, { p1Games: number; p2Games: number; p1Pts: string; p2Pts: string }>()

function LiveMatchCardInner({ match }: { match: Match }) {
  const sets = (match.sets ?? []).sort((a, b) => a.set_number - b.set_number)
  const currentSet = sets.find(s => s.is_current)
  // Pick the LAST current game (not first) — when a game finishes and a
  // new one starts, both can briefly carry is_current=true while the
  // realtime relay catches up. We want the most recent (highest game_number).
  const currentGames = (currentSet?.games ?? []).filter(g => g.is_current)
  const currentGame = currentGames.length > 0
    ? currentGames.reduce((latest, g) =>
        (g.game_number ?? 0) > (latest.game_number ?? 0) ? g : latest)
    : null
  // Live point score comes from the last entry in the points[] array
  // (game_score is the running game count like "1-1", NOT the point score)
  // Points format: "30:40", "A:40", "15:15", etc.
  const currentPoints = currentGame?.points?.length
    ? currentGame.points[currentGame.points.length - 1]
    : ''
  const pointsParts = (currentPoints ?? '').split(/[:\-]/)
  const p1GamePts = pointsParts[0] ?? ''
  const p2GamePts = pointsParts[1] ?? ''
  const hasLivePts = !!(p1GamePts || p2GamePts)

  const pair1 = pairName(match.pair1_player1, match.pair1_player2)
  const pair2 = pairName(match.pair2_player1, match.pair2_player2)

  // ── Score-change banner detection ───────────────────────────
  const [flashPair, setFlashPair] = useState<1 | 2 | null>(null)
  const flashKeyRef = useRef(0)
  const isLive = match.status === 'live'
  const p1Games = sets.reduce((s, st) => s + (st.pair1_games ?? 0), 0)
  const p2Games = sets.reduce((s, st) => s + (st.pair2_games ?? 0), 0)
  const p1Pts = p1GamePts
  const p2Pts = p2GamePts

  useEffect(() => {
    if (!isLive) { _liveScoresPrev.delete(match.id); return }
    const cur = { p1Games, p2Games, p1Pts: p1Pts ?? '', p2Pts: p2Pts ?? '' }
    const prev = _liveScoresPrev.get(match.id)
    if (prev && (prev.p1Games !== cur.p1Games || prev.p2Games !== cur.p2Games || prev.p1Pts !== cur.p1Pts || prev.p2Pts !== cur.p2Pts)) {
      let scorer: 1 | 2 | null = null
      if (cur.p1Games > prev.p1Games) scorer = 1
      else if (cur.p2Games > prev.p2Games) scorer = 2
      else {
        const cP1 = PT_ORD[cur.p1Pts] ?? 0
        const cP2 = PT_ORD[cur.p2Pts] ?? 0
        const pP1 = PT_ORD[prev.p1Pts] ?? 0
        const pP2 = PT_ORD[prev.p2Pts] ?? 0
        if (cP1 > pP1) scorer = 1
        else if (cP2 > pP2) scorer = 2
        else if (pP1 > pP2 && cP1 <= cP2) scorer = 2
        else if (pP2 > pP1 && cP2 <= cP1) scorer = 1
      }
      _liveScoresPrev.set(match.id, cur)
      if (scorer) {
        flashKeyRef.current += 1
        setFlashPair(scorer)
        const t = setTimeout(() => setFlashPair(null), 2800)
        return () => clearTimeout(t)
      }
    } else {
      _liveScoresPrev.set(match.id, cur)
    }
  }, [isLive, match.id, p1Games, p2Games, p1Pts, p2Pts])

  return (
    <Link href={`/match/${match.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block', position: 'relative' }}>
      <div style={{
        background: BG_CARD,
        border: `1px solid rgba(255,70,85,0.2)`,
        clipPath: CHUNKY.card,
        padding: '16px 18px',
        position: 'relative',
        overflow: 'hidden',
        minWidth: 300,
        flexShrink: 0,
      }}>
        {/* Red glow */}
        <div style={{
          position: 'absolute', top: -40, right: -40, width: 120, height: 120,
          background: 'radial-gradient(circle, rgba(255,70,85,0.12) 0%, transparent 70%)',
        }} />

        {/* LIVE badge + round */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: LIVE_RED,
            padding: '3px 10px',
            clipPath: CHUNKY.badge,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%', background: '#fff',
              animation: 'v3-pulse 2s infinite',
            }} />
            <span style={{ fontSize: 10, fontWeight: 800, color: '#fff', letterSpacing: 0.5 }}>LIVE</span>
          </div>
          {match.round && (
            <span style={{ fontSize: 10, fontWeight: 600, color: MUTED }}>
              {match.round}{match.court ? ` \u00B7 ${match.court}` : ''}
            </span>
          )}
        </div>

        {/* Scores */}
        {[
          { pair: pair1, p1: match.pair1_player1, p2: match.pair1_player2, pairNum: 1 },
          { pair: pair2, p1: match.pair2_player1, p2: match.pair2_player2, pairNum: 2 },
        ].map(({ pair, p1, p2, pairNum }) => (
          <div key={pairNum} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '6px 0',
            position: 'relative',
            overflow: 'hidden',
          }}>
            {/* Score-sweep banner */}
            {flashPair === pairNum && (
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
              opacity: match.winner_pair && match.winner_pair !== pairNum ? 0.65 : 1,
            }}>
              {/* Stacked overlapping dual flags */}
              <div style={{ position: 'relative', width: 26, height: 20, flexShrink: 0 }}>
                <div style={{ position: 'absolute', top: 0, left: 0, zIndex: 2 }}>
                  <FlagImg country={p1?.country ?? null} size={16} />
                </div>
                <div style={{ position: 'absolute', top: 6, left: 8, zIndex: 1 }}>
                  <FlagImg country={p2?.country ?? null} size={16} />
                </div>
              </div>
              <span style={{
                fontSize: 14,
                fontWeight: match.winner_pair && match.winner_pair !== pairNum ? 600 : 700,
                color: match.winner_pair && match.winner_pair !== pairNum ? '#B0B5BE' : '#fff',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {pair}
              </span>
            </div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              position: 'relative',
              zIndex: 2,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {sets.map(s => {
                const parsed = parseSetScore(s.set_score) ?? parseSetFromGames(s.pair1_games, s.pair2_games)
                const p1g = parsed?.p1 ?? s.pair1_games ?? 0
                const p2g = parsed?.p2 ?? s.pair2_games ?? 0
                const games = pairNum === 1 ? p1g : p2g
                const tb = parsed?.tb ?? null
                const wonThisSet = pairNum === 1 ? p1g > p2g : p2g > p1g
                const isCurrent = s.is_current
                return (
                  <span key={s.id} style={{
                    display: 'inline-block',
                    fontSize: 16,
                    fontWeight: 700,
                    fontFamily: 'monospace',
                    fontVariantNumeric: 'tabular-nums',
                    color: isCurrent ? GREEN : wonThisSet ? '#fff' : '#B0B5BE',
                    width: 18,
                    textAlign: 'center',
                    lineHeight: 1,
                    position: 'relative',
                  }}>
                    {games}
                    {tb != null && !wonThisSet && <sup style={{ fontSize: 8, color: '#B0B5BE', position: 'absolute', top: -3, right: -5 }}>{tb}</sup>}
                  </span>
                )
              })}
              {/* Game points column */}
              <span style={{
                display: 'inline-block',
                fontSize: 18,
                fontWeight: 800,
                fontFamily: 'monospace',
                fontVariantNumeric: 'tabular-nums',
                color: LIVE_RED,
                width: 24,
                textAlign: 'center',
                marginLeft: 2,
                lineHeight: 1,
              }}>
                {hasLivePts ? (pairNum === 1 ? p1GamePts : p2GamePts) : ''}
              </span>
            </div>
          </div>
        ))}

        {/* Tournament name */}
        <div style={{ marginTop: 10, fontSize: 11, color: MUTED, fontWeight: 600 }}>
          {(match as any).tournament?.name ?? ''}
        </div>
      </div>
    </Link>
  )
}

const LiveMatchCard = React.memo(LiveMatchCardInner)
export default LiveMatchCard

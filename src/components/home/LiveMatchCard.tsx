'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Match, pairName, getMatchDisplay } from '@/types/match'
import { useLiveMatch } from '@/hooks/useLiveMatch'
import { isPresenceOnlyLive } from '@/lib/tournament-tier'
import PresenceOnlyHint from '@/components/PresenceOnlyHint'
import {
  GREEN, LIVE_RED, ORANGE, BG_CARD, MUTED, CHUNKY, FlagImg,
} from './shared'

// ── Live score-change detection ─────────────────────────────────
// Tracks the previous game/point counts per match so we can detect WHO
// scored on each refresh and trigger the red banner animation. Module-level
// so the state survives component remounts.
const PT_ORD: Record<string, number> = { '0': 0, '15': 1, '30': 2, '40': 3, 'AD': 4 }
const _liveScoresPrev = new Map<string, { p1Games: number; p2Games: number; p1Pts: string; p2Pts: string }>()

function LiveMatchCardInner({ match: matchProp }: { match: Match }) {
  // Badge label lives in the `common` namespace so the same translation
  // key is reused across /matches, /home and /matches/[date].
  const tCommon = useTranslations('common')

  // Per-card realtime subscription — same primitive the matches page,
  // tournament detail, and match detail all use. Keeps the home live
  // carousel in lock-step with the gold-standard match-detail page.
  const isLiveOrOnCourt =
    matchProp.status === 'live' || (matchProp.status as string) === 'on_court'
  const match = useLiveMatch(matchProp.id, isLiveOrOnCourt, matchProp)

  // Unified display calculation — identical to MatchCard + match detail.
  const display = getMatchDisplay(match)
  const {
    sets,
    isLive: isLiveDisplay,
    livePointParts,
    pair1Serving: pair1IsServing,
    pair2Serving: pair2IsServing,
    pair1TotalGames: p1Games,
    pair2TotalGames: p2Games,
  } = display
  const p1GamePts = livePointParts[0]
  const p2GamePts = livePointParts[1]
  const liveStatusForPts = isLiveDisplay
  const hasLivePts = liveStatusForPts || !!(p1GamePts || p2GamePts)

  const pair1 = pairName(match.pair1_player1, match.pair1_player2)
  const pair2 = pairName(match.pair2_player1, match.pair2_player2)

  // ── Score-change banner detection ───────────────────────────
  const [flashPair, setFlashPair] = useState<1 | 2 | null>(null)
  const flashKeyRef = useRef(0)
  const isLive = match.status === 'live'
  // on_court = Crionet widget showed "On court" / "Warming up" — players are
  // on the court but no first point yet. Rendered with an orange "ON COURT"
  // pill (same shape as LIVE) so fans can tell it apart from an active match.
  const isOnCourt = (match.status as string) === 'on_court'
  const p1Pts = p1GamePts
  const p2Pts = p2GamePts

  // FIP-tier carve-out: treat live FIP-tier matches as presence-only
  // (no point-by-point lands). Defensive — home spotlight prefers Premier,
  // so this rarely renders.
  const presenceOnly = isPresenceOnlyLive(
    { status: match.status as string, sets: (match as any).sets ?? null },
    { level: (match as any).tournament?.level ?? null },
  )

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
        // Orange border/glow when warming up, red when live. Keeps the "something
        // is happening" visual cue while distinguishing the two phases.
        border: `1px solid ${isOnCourt ? 'rgba(245,166,35,0.22)' : 'rgba(255,70,85,0.2)'}`,
        clipPath: CHUNKY.card,
        padding: '16px 18px',
        position: 'relative',
        overflow: 'hidden',
        minWidth: 300,
        flexShrink: 0,
      }}>
        {/* Corner glow — matches the border color */}
        <div style={{
          position: 'absolute', top: -40, right: -40, width: 120, height: 120,
          background: isOnCourt
            ? 'radial-gradient(circle, rgba(245,166,35,0.14) 0%, transparent 70%)'
            : 'radial-gradient(circle, rgba(255,70,85,0.12) 0%, transparent 70%)',
        }} />

        {/* LIVE / ON COURT badge + round */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          {presenceOnly ? (
            <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                fontSize: 11,
                fontWeight: 800,
                color: '#F5A623',
                letterSpacing: '0.5px',
              }}>{tCommon('onCourt')}</span>
              <PresenceOnlyHint matchId={match.id} variant="row" />
            </span>
          ) : (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: isOnCourt ? ORANGE : LIVE_RED,
              padding: '3px 10px',
              clipPath: CHUNKY.badge,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%', background: '#fff',
                animation: 'v3-pulse 2s infinite',
              }} />
              <span style={{
                fontSize: 10, fontWeight: 800,
                color: isOnCourt ? '#000' : '#fff',
                letterSpacing: 0.5,
              }}>
                {isOnCourt ? tCommon('onCourt') : tCommon('live')}
              </span>
            </div>
          )}
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
              {((pairNum === 1 && pair1IsServing) || (pairNum === 2 && pair2IsServing)) && (
                <span
                  title="Serving"
                  aria-label="Serving"
                  style={{
                    flexShrink: 0,
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#F5C518',
                    boxShadow: '0 0 6px rgba(245,197,24,0.55)',
                  }}
                />
              )}
            </div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              position: 'relative',
              zIndex: 2,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {sets.map(ps => {
                const games = pairNum === 1 ? ps.p1Games : ps.p2Games
                const tb = ps.tb
                const wonThisSet = pairNum === 1 ? ps.pair1Won : ps.pair2Won
                const isCurrent = ps.raw.is_current
                return (
                  <span key={ps.raw.id} style={{
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

'use client'
// src/components/V3MatchCard.tsx
//
// Shared match card used by tournament detail pages and the matches Results tab.
// Renders a finished or live match with a left gender accent bar, a Final/Live/W/O
// status pill, round + court header, and two-row scoresheet with stacked dual flags.
//
// Extracted from src/app/(app)/tournaments/[id]/page.tsx — preserved verbatim
// so existing call sites render identically.

import Link from 'next/link'
import { Match, pairName, parseSetScore } from '@/types/match'

// ── Brand colors ───────────────────────────────────────────────
const GREEN = '#7ED321'
const LIVE_RED = '#FF4655'
const BG_CARD = '#141414'
const MUTED = '#6B7280'
const BORDER = 'rgba(255,255,255,0.06)'

// ── Chunky clip-path presets ───────────────────────────────────
const CHUNKY = {
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
  card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
}

// ── FlagImg (local copy — same implementation as the page files) ──
function FlagImg({ country, size = 16 }: { country: string | null; size?: number }) {
  if (!country) return <span style={{ width: size, height: size * 0.75, display: 'inline-block' }} />
  const code = country.toLowerCase()
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://flagcdn.com/w40/${code}.png`}
      alt={country}
      width={size}
      height={size * 0.75}
      style={{ objectFit: 'cover', display: 'block', flexShrink: 0 }}
    />
  )
}

// ── V3MatchCard ────────────────────────────────────────────────

export function V3MatchCard({ match, genderColor }: { match: Match; genderColor: string }) {
  const sets = (match.sets ?? []).sort((a, b) => a.set_number - b.set_number)
  const currentSet = sets.find(s => s.is_current)
  const currentGame = currentSet?.games?.find(g => g.is_current)
  const gamePoints = currentGame?.game_score ?? ''
  const isLive = match.status === 'live'
  const isFinished = ['finished', 'retired', 'walkover', 'ended'].includes(match.status as string)

  const getWinner = (): 0 | 1 | 2 => {
    if (match.winner_pair === 1) return 1
    if (match.winner_pair === 2) return 2
    let p1Sets = 0, p2Sets = 0
    for (const s of sets) {
      let p1 = s.pair1_games ?? 0
      let p2 = s.pair2_games ?? 0
      if (p1 === 0 && p2 === 0 && s.set_score) {
        const parsed = parseSetScore(s.set_score)
        if (parsed) { p1 = parsed.p1; p2 = parsed.p2 }
      }
      if (p1 > p2) p1Sets++
      else if (p2 > p1) p2Sets++
    }
    if (p1Sets === p2Sets) return 0
    return p1Sets > p2Sets ? 1 : 2
  }
  const winner = isFinished ? getWinner() : 0

  const borderColor = isLive ? 'rgba(255,70,85,0.2)' : BORDER

  return (
    <Link href={`/match/${match.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block', marginBottom: 6 }}>
      <div style={{
        background: BG_CARD,
        border: `1px solid ${borderColor}`,
        clipPath: CHUNKY.card,
        padding: '14px 16px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Left gender accent bar */}
        <div style={{
          position: 'absolute', top: 0, left: 0, bottom: 0,
          width: 3, background: genderColor,
        }} />

        {/* Live glow */}
        {isLive && (
          <div style={{
            position: 'absolute', top: -40, right: -40, width: 120, height: 120,
            background: 'radial-gradient(circle, rgba(255,70,85,0.10) 0%, transparent 70%)',
          }} />
        )}

        {/* Header row: status + round/court */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          {isLive ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: LIVE_RED,
              padding: '2px 8px',
              clipPath: CHUNKY.badge,
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff', animation: 'v3-pulse 2s infinite' }} />
              <span style={{ fontSize: 9, fontWeight: 800, color: '#fff', letterSpacing: 0.5 }}>LIVE</span>
            </div>
          ) : isFinished ? (
            <span style={{ fontSize: 9, fontWeight: 700, color: MUTED, letterSpacing: 0.5, textTransform: 'uppercase' }}>
              {match.status === 'retired' ? 'Retired' : match.status === 'walkover' ? 'W/O' : 'Final'}
            </span>
          ) : null}
          <span style={{ fontSize: 10, fontWeight: 600, color: MUTED }}>
            {match.round ?? ''}{match.court ? ` \u00B7 ${match.court}` : ''}
          </span>
        </div>

        {/* Score rows */}
        {[1, 2].map(pairNum => {
          const p1 = pairNum === 1 ? match.pair1_player1 : match.pair2_player1
          const p2 = pairNum === 1 ? match.pair1_player2 : match.pair2_player2
          const pair = pairName(p1, p2)
          const isWinner = winner === pairNum
          const isLoser = winner !== 0 && winner !== pairNum

          return (
            <div key={pairNum} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '5px 0',
              opacity: isLoser ? 0.65 : 1,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                {/* Stacked overlapping flags — second slightly lower */}
                <div style={{ position: 'relative', width: 26, height: 20, flexShrink: 0 }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, zIndex: 2 }}>
                    <FlagImg country={p1?.country ?? null} size={16} />
                  </div>
                  <div style={{ position: 'absolute', top: 6, left: 8, zIndex: 1 }}>
                    <FlagImg country={p2?.country ?? null} size={16} />
                  </div>
                </div>
                <span style={{
                  fontSize: 13, fontWeight: isWinner ? 800 : 600, color: isLoser ? '#B0B5BE' : '#fff',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {pair}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {sets.map(s => {
                  const parsed = parseSetScore(s.set_score)
                  const p1g = parsed?.p1 ?? s.pair1_games ?? 0
                  const p2g = parsed?.p2 ?? s.pair2_games ?? 0
                  const games = pairNum === 1 ? p1g : p2g
                  const wonThisSet = pairNum === 1 ? p1g > p2g : p2g > p1g
                  const isCurrent = s.is_current && isLive
                  return (
                    <span key={s.id} style={{
                      fontSize: 15, fontWeight: 700, fontFamily: 'monospace',
                      color: isCurrent ? GREEN : wonThisSet ? '#fff' : MUTED,
                      minWidth: 16, textAlign: 'center',
                    }}>
                      {games}
                    </span>
                  )
                })}
                {isLive && gamePoints && (
                  <span style={{
                    fontSize: 17, fontWeight: 800, fontFamily: 'monospace',
                    color: LIVE_RED, minWidth: 20, textAlign: 'center',
                    marginLeft: 4,
                  }}>
                    {gamePoints.split(':')[pairNum === 1 ? 0 : 1] ?? ''}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </Link>
  )
}

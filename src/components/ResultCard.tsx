'use client'
// src/components/ResultCard.tsx
//
// Shared match-result card used by the home page's "Latest Results"
// section and the matches page's Results tab. Denser than V3MatchCard:
// tighter padding, multi-pill header (round / court / status / date),
// a bright W badge next to the winning pair, and loser rows dimmed
// to ~45% opacity with muted text.
//
// Extracted from src/app/(app)/home/page.tsx — preserved verbatim so
// the home page renders identically after the extraction.

import { useFormatter } from 'next-intl'
import { DATE_SHORT } from '@/lib/format-patterns'
import { Link } from '@/i18n/navigation'
import { Match, pairName, parseSetScore } from '@/types/match'

// ── Brand colors ───────────────────────────────────────────────
const GREEN = '#7ED321'
const MUTED = '#6B7280'
const MEN_BLUE = '#4A9EFF'
const WOMEN_PURPLE = '#D966FF'

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

// ── ResultCard ─────────────────────────────────────────────────

export function ResultCard({ match }: { match: Match }) {
  const format = useFormatter()
  const sets = (match.sets ?? []).sort((a, b) => a.set_number - b.set_number)
  const pair1 = pairName(match.pair1_player1, match.pair1_player2)
  const pair2 = pairName(match.pair2_player1, match.pair2_player2)
  const isWinner1 = match.winner_pair === 1
  const isWinner2 = match.winner_pair === 2
  const category = (match as any).category as string | null
  const genderColor = category === 'women' ? WOMEN_PURPLE : category === 'men' ? MEN_BLUE : null
  const hasWinner = isWinner1 || isWinner2

  return (
    <Link href={`/match/${match.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
      <div style={{
        background: 'rgba(255,255,255,0.03)',
        clipPath: CHUNKY.card,
        padding: '10px 12px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Left accent bar */}
        <div style={{
          position: 'absolute',
          top: 0, left: 0, bottom: 0,
          width: 3,
          background: hasWinner
            ? (genderColor ?? GREEN)
            : MUTED,
        }} />
        {/* Pills row: round, court, status, date */}
        <div style={{ display: 'flex', gap: 5, marginBottom: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {match.round && (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '2px 6px',
              clipPath: CHUNKY.badge, textTransform: 'uppercase',
              background: 'rgba(255,255,255,0.06)', color: MUTED,
            }}>
              {match.round}
            </span>
          )}
          {match.court && (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '2px 6px',
              clipPath: CHUNKY.badge, textTransform: 'uppercase',
              background: 'rgba(255,255,255,0.06)', color: MUTED,
            }}>
              {match.court}
            </span>
          )}
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '2px 6px',
            clipPath: CHUNKY.badge, textTransform: 'uppercase',
            background: match.status === 'finished' ? 'rgba(126,211,33,0.1)' : 'rgba(255,255,255,0.06)',
            color: match.status === 'finished' ? GREEN : MUTED,
          }}>
            {match.status}
          </span>
          {match.finished_at && (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '2px 6px',
              clipPath: CHUNKY.badge,
              background: 'rgba(255,255,255,0.06)', color: MUTED,
            }}>
              {format.dateTime(new Date(match.finished_at), DATE_SHORT)}
            </span>
          )}
        </div>

        {[
          { pair: pair1, isWinner: isWinner1, pairNum: 1, p1: match.pair1_player1, p2: match.pair1_player2 },
          { pair: pair2, isWinner: isWinner2, pairNum: 2, p1: match.pair2_player1, p2: match.pair2_player2 },
        ].map(({ pair, isWinner, pairNum, p1, p2 }) => (
          <div key={pairNum} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '4px 0',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0,
              opacity: !isWinner && (isWinner1 || isWinner2) ? 0.65 : 1,
            }}>
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
                fontSize: 13, fontWeight: isWinner ? 700 : 600, color: isWinner ? '#fff' : '#B0B5BE',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {pair}
              </span>
              {isWinner && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 16, height: 16, background: GREEN,
                  clipPath: CHUNKY.badge,
                  fontSize: 9, color: '#000', fontWeight: 800,
                  flexShrink: 0,
                }}>
                  W
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {sets.map(s => {
                const parsed = parseSetScore(s.set_score)
                const p1g = parsed?.p1 ?? s.pair1_games ?? 0
                const p2g = parsed?.p2 ?? s.pair2_games ?? 0
                const games = pairNum === 1 ? p1g : p2g
                const wonThisSet = pairNum === 1 ? p1g > p2g : p2g > p1g
                return (
                  <span key={s.set_number} style={{
                    fontSize: 16, fontWeight: 700, fontFamily: 'monospace',
                    color: wonThisSet ? '#fff' : '#B0B5BE',
                    minWidth: 16, textAlign: 'center',
                  }}>
                    {games}
                  </span>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </Link>
  )
}

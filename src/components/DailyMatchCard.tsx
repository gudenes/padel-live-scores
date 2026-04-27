'use client'

// src/components/DailyMatchCard.tsx
//
// Match card for the /matches/[date] tournament-grouped layout. Lives
// alongside V3MatchCard rather than replacing it because the daily
// page wants extra metadata in a chip row (ROUND · COURT · STATUS ·
// DATE) and a green "W" badge next to the winning pair — the screenshot
// the user picked as the visual target.
//
// Differences vs V3MatchCard:
//   - Chip row above the score grid instead of an inline LIVE/FINAL pill
//   - "W" badge on the winning pair (helps when set scores are dense)
//   - Date chip (useful when one tournament spans several days)
//   - Slightly tighter padding so multiple cards stack densely
//
// Same brand language: chunky polygon clipPath, left gender accent bar,
// dual stacked country flags, monospace per-set scores, muted loser
// styling.

import { Link } from '@/i18n/navigation'
import { FlagImage } from '@/components/FlagImage'
import { pairName, parseSetScore, parseSetFromGames, type Match } from '@/types/match'

const GREEN = '#7ED321'
const LIVE_RED = '#FF4655'
const BG_CARD = '#141414'
const BG_ELEV = '#1A1A1A'
const MUTED = '#6B7280'
const BORDER = 'rgba(255,255,255,0.06)'

const CHUNKY = {
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
  card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
}

// ── Round normalisation ─────────────────────────────────────────────────
//
// Round labels coming out of the DB vary by source (padelapi: "Final",
// FIP scrapers: "F" / "SF" / "QF", widget: "Round of 16"). Normalise to
// uppercase short labels for the chip ("FINALS", "SEMIS", "QUARTERS",
// "R16"…). Keeps the visual grid tight without losing meaning.

function formatRound(round: string | null): string | null {
  if (!round) return null
  const r = round.trim().toLowerCase()
  if (!r) return null
  if (r === 'f' || r === 'final' || r === 'finals') return 'FINALS'
  if (r === 'sf' || r.startsWith('semi')) return 'SEMIFINALS'
  if (r === 'qf' || r.startsWith('quarter')) return 'QUARTERFINALS'
  if (r === 'r16' || r.includes('round of 16') || r.includes('1/8')) return 'R16'
  if (r === 'r32' || r.includes('round of 32') || r.includes('1/16')) return 'R32'
  if (r === 'r64') return 'R64'
  if (r === 'r128') return 'R128'
  if (/^q\d/.test(r) || r.startsWith('qual')) return round.toUpperCase()
  // Fallback: uppercase the source string. Keeps badges legible for
  // sources we haven't mapped explicitly.
  return round.toUpperCase()
}

// ── Status pill ─────────────────────────────────────────────────────────

function statusChip(match: Match): { label: string; bg: string; color: string } | null {
  const status = match.status as string
  if (status === 'live') return { label: 'LIVE', bg: 'rgba(255,70,85,0.18)', color: LIVE_RED }
  if (status === 'on_court') return { label: 'ON COURT', bg: 'rgba(245,166,35,0.18)', color: '#F5A623' }
  if (status === 'walkover') return { label: 'W/O', bg: 'rgba(255,255,255,0.06)', color: MUTED }
  if (status === 'retired') return { label: 'RETIRED', bg: 'rgba(255,255,255,0.06)', color: MUTED }
  if (['finished', 'ended'].includes(status)) {
    return { label: 'FINISHED', bg: 'rgba(126,211,33,0.16)', color: GREEN }
  }
  if (status === 'scheduled') {
    // For scheduled we show the time elsewhere — skip the status chip.
    return null
  }
  return null
}

// ── Date chip ───────────────────────────────────────────────────────────
//
// Short locale-aware date string ("26 abr"). Picks finished_at when the
// match has wrapped, otherwise scheduled_at. Returns null when neither
// is set.

function formatShortDate(
  match: Match,
  locale: string,
  tz: string,
): string | null {
  const iso = match.finished_at ?? match.scheduled_at
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: tz,
  }).format(d)
}

// ── Component ───────────────────────────────────────────────────────────

export interface DailyMatchCardProps {
  match: Match
  genderColor: string
  locale: string
  userTz: string
}

export function DailyMatchCard({
  match,
  genderColor,
  locale,
  userTz,
}: DailyMatchCardProps) {
  const sets = (match.sets ?? []).slice().sort((a, b) => a.set_number - b.set_number)
  const isLive = match.status === 'live'
  const isFinished = ['finished', 'retired', 'walkover', 'ended'].includes(match.status as string)

  // Resolve winner (mirrors V3MatchCard's logic for parity).
  const winner: 0 | 1 | 2 = (() => {
    if (match.winner_pair === 1) return 1
    if (match.winner_pair === 2) return 2
    if (!isFinished) return 0
    let p1Sets = 0
    let p2Sets = 0
    for (const s of sets) {
      const parsed = parseSetScore(s.set_score) ?? parseSetFromGames(s.pair1_games, s.pair2_games)
      const p1 = parsed?.p1 ?? s.pair1_games ?? 0
      const p2 = parsed?.p2 ?? s.pair2_games ?? 0
      if (p1 > p2) p1Sets++
      else if (p2 > p1) p2Sets++
    }
    if (p1Sets === p2Sets) return 0
    return p1Sets > p2Sets ? 1 : 2
  })()

  // Live point — last entry in the current game's points[] array.
  const currentSet = sets.find(s => s.is_current)
  const currentGame = currentSet?.games?.find(g => g.is_current)
  const lastPoint = currentGame?.points?.length
    ? currentGame.points[currentGame.points.length - 1]
    : ''
  const gamePoints = lastPoint ?? ''

  const round = formatRound(match.round)
  const courtRaw = match.court ? match.court.trim() : null
  const status = statusChip(match)
  const dateStr = formatShortDate(match, locale, userTz)

  const borderColor = isLive ? 'rgba(255,70,85,0.22)' : BORDER

  return (
    <Link
      href={`/match/${match.id}`}
      locale={locale as 'en' | 'es' | 'pt' | 'it' | 'fr'}
      style={{
        textDecoration: 'none',
        color: 'inherit',
        display: 'block',
        marginBottom: 8,
      }}
    >
      <div
        style={{
          background: BG_CARD,
          border: `1px solid ${borderColor}`,
          clipPath: CHUNKY.card,
          padding: '12px 14px 12px 16px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Left gender accent bar — runs the full height of the card */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            bottom: 0,
            width: 3,
            background: genderColor,
          }}
        />

        {/* Live glow halo */}
        {isLive && (
          <div
            style={{
              position: 'absolute',
              top: -40,
              right: -40,
              width: 120,
              height: 120,
              background: 'radial-gradient(circle, rgba(255,70,85,0.10) 0%, transparent 70%)',
              pointerEvents: 'none',
            }}
          />
        )}

        {/* Metadata chip row */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 6,
            marginBottom: 10,
          }}
        >
          {round && <Chip>{round}</Chip>}
          {courtRaw && <Chip>{courtRaw.toUpperCase()}</Chip>}
          {status && (
            <Chip bg={status.bg} color={status.color} bold>
              {status.label}
            </Chip>
          )}
          {dateStr && <Chip muted>{dateStr}</Chip>}
        </div>

        {/* Pair rows */}
        {[1, 2].map(pairNum => {
          const p1 = pairNum === 1 ? match.pair1_player1 : match.pair2_player1
          const p2 = pairNum === 1 ? match.pair1_player2 : match.pair2_player2
          const pair = pairName(p1, p2)
          const isWinner = winner === pairNum
          const isLoser = winner !== 0 && winner !== pairNum

          return (
            <div
              key={pairNum}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '5px 0',
                gap: 8,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flex: 1,
                  minWidth: 0,
                  opacity: isLoser ? 0.65 : 1,
                }}
              >
                {/* Stacked dual flags — same pattern as V3MatchCard */}
                <div style={{ position: 'relative', width: 26, height: 20, flexShrink: 0 }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, zIndex: 2 }}>
                    <FlagImage country={p1?.country ?? null} size={16} />
                  </div>
                  <div style={{ position: 'absolute', top: 6, left: 8, zIndex: 1 }}>
                    <FlagImage country={p2?.country ?? null} size={16} />
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: isWinner ? 800 : 600,
                    color: isLoser ? '#B0B5BE' : '#fff',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {pair}
                </span>
                {isWinner && isFinished && (
                  <span
                    style={{
                      flexShrink: 0,
                      fontSize: 9,
                      fontWeight: 800,
                      letterSpacing: 0.5,
                      color: '#0A0A0A',
                      background: GREEN,
                      padding: '2px 6px',
                      clipPath: CHUNKY.badge,
                      lineHeight: 1.1,
                    }}
                  >
                    W
                  </span>
                )}
              </div>

              {/* Per-set scores */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {sets.map(s => {
                  const parsed = parseSetScore(s.set_score) ?? parseSetFromGames(s.pair1_games, s.pair2_games)
                  const p1g = parsed?.p1 ?? s.pair1_games ?? 0
                  const p2g = parsed?.p2 ?? s.pair2_games ?? 0
                  const games = pairNum === 1 ? p1g : p2g
                  const tb = parsed?.tb ?? null
                  const wonThisSet = pairNum === 1 ? p1g > p2g : p2g > p1g
                  const isCurrent = s.is_current && isLive
                  return (
                    <span
                      key={s.id}
                      style={{
                        fontSize: 15,
                        fontWeight: 700,
                        fontFamily: 'monospace',
                        color: isCurrent
                          ? GREEN
                          : wonThisSet
                          ? '#fff'
                          : '#B0B5BE',
                        minWidth: 16,
                        textAlign: 'center',
                        position: 'relative',
                      }}
                    >
                      {games}
                      {tb != null && !wonThisSet && (
                        <sup
                          style={{
                            fontSize: 8,
                            color: '#B0B5BE',
                            position: 'absolute',
                            top: -3,
                            right: -5,
                          }}
                        >
                          {tb}
                        </sup>
                      )}
                    </span>
                  )
                })}
                {isLive && gamePoints && (
                  <span
                    style={{
                      fontSize: 17,
                      fontWeight: 800,
                      fontFamily: 'monospace',
                      color: LIVE_RED,
                      minWidth: 20,
                      textAlign: 'center',
                      marginLeft: 4,
                    }}
                  >
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

// ── Chip helper ─────────────────────────────────────────────────────────

function Chip({
  children,
  bg = BG_ELEV,
  color = MUTED,
  bold = false,
  muted = false,
}: {
  children: React.ReactNode
  bg?: string
  color?: string
  bold?: boolean
  muted?: boolean
}) {
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: bold ? 800 : 700,
        letterSpacing: '0.4px',
        textTransform: 'uppercase',
        color: muted ? MUTED : color,
        background: muted ? 'rgba(255,255,255,0.04)' : bg,
        padding: '3px 7px',
        clipPath: CHUNKY.badge,
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}

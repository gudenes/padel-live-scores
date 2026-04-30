'use client'

// src/components/MatchCard.tsx
//
// Single shared match card. Renders one of three states based on
// `match.status`:
//
//   • scheduled  → chip row + pair rows + right-aligned date/time stack
//                  (TBD or `estimatedLabel` when no real time set)
//   • live       → chip row + pair rows + per-set scores + live point
//   • finished   → chip row (with W/O · RETIRED · FINISHED) + pair rows
//                  + per-set scores + green "W" badge on winning pair
//
// Used everywhere we render a match list row: matches-by-date page,
// tournament-detail page (live + scheduled + finished + upsets). Replaces
// the old per-context cards (DailyMatchCard, V3MatchCard, V3ScheduledCard)
// — see git history if you need the original variants.
//
// Brand language: chunky polygon clipPath, left gender accent bar,
// stacked dual country flags, monospace per-set scores, muted loser
// styling.

import { useEffect, useState, useRef, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import type { Prediction } from '@/lib/predictions/types'
import { classifyResult } from '@/lib/predictions/scoring'
import { Link } from '@/i18n/navigation'
import { FlagImage } from '@/components/FlagImage'
import { pairName, parseSetScore, parseSetFromGames, type Match } from '@/types/match'

const GREEN = '#7ED321'
const LIVE_RED = '#FF4655'
const ORANGE = '#F5A623'
const BG_CARD = '#141414'
const BG_ELEV = '#1A1A1A'
const MUTED = '#6B7280'
const BORDER = 'rgba(255,255,255,0.06)'

const CHUNKY = {
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
  card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
}

const PULSE_KEYFRAMES = `
@keyframes fipStreamPulse {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.18); }
}
`

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

// Time chip for scheduled matches. Skips date-only padelapi values
// (those land on midnight UTC and don't carry a real start time).
function formatScheduledTime(
  match: Match,
  locale: string,
  tz: string,
): string | null {
  if (match.status !== 'scheduled') return null
  const iso = match.scheduled_at
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) return null
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: tz,
  }).format(d)
}

// ── Component ───────────────────────────────────────────────────────────

export interface MatchCardProps {
  match: Match
  genderColor: string
  locale: string
  userTz: string
  /** Optional. Tournament-detail scheduled tab supplies a "~10:30" estimate
   *  built from the OOP "Followed by" chain. Shown in orange when no real
   *  scheduled time is available. */
  estimatedLabel?: string
}

export function MatchCard({
  match,
  genderColor,
  locale,
  userTz,
  estimatedLabel,
}: MatchCardProps) {
  const tTournament = useTranslations('tournament')
  const tPred = useTranslations('prediction')

  // ── Hydration-safe prediction read (unified for all card states) ─────
  const [prediction, setPredictionLocal] = useState<Prediction | null>(null)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('pn_match_predictions')
      if (raw) {
        const all = JSON.parse(raw)
        const p = all[match.id]
        if (p && 'multiplier' in p && 'probability' in p) setPredictionLocal(p as Prediction)
        else if (p) setPredictionLocal({
          matchId: match.id, pair: p.pair, margin: p.margin,
          probability: 0.5, multiplier: 2.0, isFallback: true,
          createdAt: new Date(0).toISOString(),
        })
      }
    } catch {}
  }, [match.id])

  // Card-open state for the inline prediction panel.
  const [isOpen, setIsOpen] = useState(false)
  const closeTimer = useRef<NodeJS.Timeout | null>(null)

  const toggleOpen = useCallback((e?: React.MouseEvent) => {
    e?.preventDefault()
    setIsOpen(o => !o)
  }, [])

  const handleLocked = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setIsOpen(false), 1400)
  }, [])

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])

  const sets = (match.sets ?? []).slice().sort((a, b) => a.set_number - b.set_number)
  const isLive = match.status === 'live'
  const isScheduled = match.status === 'scheduled'
  const isFinished = ['finished', 'retired', 'walkover', 'ended'].includes(match.status as string)
  const scheduleLabel = (match as any).schedule_label as string | null
  const isApproximateTime = isScheduled && /not before|followed by/i.test(scheduleLabel ?? '')

  // Resolve winner from sets when winner_pair isn't stamped on the row.
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
  const timeStr = formatScheduledTime(match, locale, userTz)

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
      <style>{PULSE_KEYFRAMES}</style>
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
        </div>

        {/* Corner CTA / pill / badge — state machine */}
        <CornerElement
          match={match}
          prediction={prediction}
          isLive={isLive}
          isFinished={isFinished}
          isOpen={isOpen}
          onToggle={toggleOpen}
          tPred={tPred}
        />

        {/* Pair rows: [names col | optional stream button (Task 11) | scores col] + right-aligned date/time */}
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 10, flex: 1, minWidth: 0 }}>

            {/* Names column — both pair-lefts stacked */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              {[1, 2].map(pairNum => {
                const p1 = pairNum === 1 ? match.pair1_player1 : match.pair2_player1
                const p2 = pairNum === 1 ? match.pair1_player2 : match.pair2_player2
                const pair = pairName(p1, p2)
                const isWinner = winner === pairNum
                const isLoser = winner !== 0 && winner !== pairNum
                return (
                  <div key={pairNum} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0',
                    opacity: isLoser ? 0.65 : 1,
                  }}>
                    {/* Stacked dual flags */}
                    <div style={{ position: 'relative', width: 26, height: 20, flexShrink: 0 }}>
                      <div style={{ position: 'absolute', top: 0, left: 0, zIndex: 2 }}>
                        <FlagImage country={p1?.country ?? null} size={16} />
                      </div>
                      <div style={{ position: 'absolute', top: 6, left: 8, zIndex: 1 }}>
                        <FlagImage country={p2?.country ?? null} size={16} />
                      </div>
                    </div>
                    <span style={{
                      fontSize: 12, fontWeight: isWinner ? 800 : 600,
                      color: isLoser ? '#B0B5BE' : '#fff',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{pair}</span>
                    {isWinner && isFinished && (
                      <span style={{
                        flexShrink: 0, fontSize: 9, fontWeight: 800, letterSpacing: 0.5,
                        color: '#0A0A0A', background: GREEN, padding: '2px 6px',
                        clipPath: CHUNKY.badge, lineHeight: 1.1,
                      }}>W</span>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Stream button — circular YouTube affordance (Task 11) */}
            {process.env.NEXT_PUBLIC_FIP_STREAMS_ENABLED === 'true' && match.streamTier && (
              <a
                href={match.streamTier.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                aria-label={
                  match.streamTier.state === 'live' ? 'Watch live on YouTube'
                  : match.streamTier.state === 'upcoming' ? 'Tune in on YouTube'
                  : match.streamTier.state === 'archived' ? 'Watch replay on YouTube'
                  : 'Open FIP YouTube channel'
                }
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, width: 36, height: 36, alignSelf: 'center',
                  borderRadius: '50%', textDecoration: 'none',
                  background:
                    match.streamTier.state === 'live' ? '#FF4655'
                    : match.streamTier.state === 'archived' ? 'rgba(126,211,33,0.16)'
                    : 'rgba(255,255,255,0.08)',
                  border:
                    match.streamTier.state === 'archived' ? '1px solid rgba(126,211,33,0.4)'
                    : 'none',
                  color:
                    match.streamTier.state === 'live' ? '#fff'
                    : match.streamTier.state === 'archived' ? '#7ED321'
                    : '#B0B5BE',
                  animation: match.streamTier.state === 'live' ? 'fipStreamPulse 1.6s ease-in-out infinite' : undefined,
                }}
              >
                {match.streamTier.state === 'archived' ? (
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
                  </svg>
                ) : (
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                )}
              </a>
            )}

            {/* Scores column — both score rows stacked */}
            <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
              {[1, 2].map(pairNum => {
                const isLoser = winner !== 0 && winner !== pairNum
                return (
                  <div key={pairNum} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                    gap: 8, padding: '5px 0', opacity: isLoser ? 0.65 : 1,
                  }}>
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
                )
              })}
            </div>

          </div>

          {/* Right-aligned schedule stack — scheduled matches only (live/finished
              show per-set scores in each pair row instead). Mirrors V3ScheduledCard. */}
          {isScheduled && (
            <div style={{
              display: 'flex', flexDirection: 'column',
              alignItems: 'flex-end', justifyContent: 'center',
              flexShrink: 0, minWidth: 42, marginLeft: 4,
            }}>
              {dateStr && (
                <span style={{ fontSize: 10, fontWeight: 600, color: MUTED, lineHeight: 1.2 }}>
                  {dateStr}
                </span>
              )}
              {timeStr ? (
                <span style={{ fontSize: 13, fontWeight: 800, color: GREEN, lineHeight: 1.2 }}>
                  {timeStr}{isApproximateTime ? '*' : ''}
                </span>
              ) : estimatedLabel ? (
                <span style={{ fontSize: 9, fontWeight: 600, color: ORANGE, lineHeight: 1.2, textTransform: 'uppercase' }}>
                  {estimatedLabel}
                </span>
              ) : (
                <span style={{ fontSize: 10, fontWeight: 600, color: MUTED, lineHeight: 1.2, opacity: 0.5 }}>
                  TBD
                </span>
              )}
            </div>
          )}
        </div>
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

// ── CornerElement — prediction state machine ────────────────────────────

function CornerElement({
  match, prediction, isLive, isFinished, isOpen, onToggle, tPred,
}: {
  match: Match
  prediction: Prediction | null
  isLive: boolean
  isFinished: boolean
  isOpen: boolean
  onToggle: (e?: React.MouseEvent) => void
  tPred: ReturnType<typeof useTranslations>
}) {
  const isScheduled = match.status === 'scheduled'

  // Finished + predicted → result badge
  if (isFinished && prediction) {
    // ⚠ NEW API: classifyResult returns { result, marginCorrect } | null
    const classified = classifyResult(prediction, match)
    if (!classified || classified.result === 'invalidated') return null
    const result = classified.result
    const isUpset = result === 'upset'
    const isPositive = result === 'perfect' || result === 'right' || result === 'upset'
    const bg = isUpset
      ? 'linear-gradient(135deg, #7ED321, #FFD166)'
      : isPositive ? GREEN : 'rgba(255,70,85,0.14)'
    const color = isPositive ? '#0a0a0a' : '#FF4655'
    const labelKey =
      result === 'perfect' ? 'result.perfectBadge'
      : result === 'right' ? 'result.rightBadge'
      : result === 'upset' ? 'result.upsetBadge'
      : 'result.wrongBadge'
    return (
      <button
        type="button"
        onClick={onToggle}
        style={{
          position: 'absolute', top: 10, right: 12, zIndex: 3,
          background: bg, color, padding: '6px 10px', cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
          clipPath: CHUNKY.badge, border: 0,
        }}
        aria-label={tPred(labelKey as any)}
      >
        <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', lineHeight: 1 }}>
          {tPred(labelKey as any)}
        </span>
      </button>
    )
  }

  // Live + predicted → "YOUR PICK" pill (read-only state)
  if (isLive && prediction) {
    return (
      <button type="button" onClick={onToggle} style={cornerPillStyle('rgba(126,211,33,0.10)', GREEN)}>
        <span style={cornerTopStyle}>{tPred('cta.yourPick')}</span>
      </button>
    )
  }

  // Live + no prediction → muted LOCKED chip
  if (isLive && !prediction) {
    return (
      <button type="button" onClick={onToggle} style={cornerPillStyle('rgba(255,255,255,0.04)', MUTED, 'dashed')}>
        <span style={cornerTopStyle}>{tPred('cta.locked')}</span>
      </button>
    )
  }

  // Scheduled + predicted → quieter "YOUR PICK" pill
  if (isScheduled && prediction) {
    return (
      <button type="button" onClick={onToggle} style={cornerPillStyle('rgba(126,211,33,0.10)', GREEN)}>
        <span style={cornerTopStyle}>{tPred('cta.yourPick')}</span>
      </button>
    )
  }

  // Scheduled + no prediction → green PICK CTA
  if (isScheduled) {
    return (
      <button
        type="button"
        onClick={onToggle}
        style={{
          position: 'absolute', top: 10, right: 12, zIndex: 3,
          background: GREEN, color: '#0a0a0a',
          padding: '7px 14px', cursor: 'pointer', border: 0,
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 12, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase',
          clipPath: CHUNKY.badge,
          boxShadow: '0 2px 6px rgba(126,211,33,0.18)',
          transform: isOpen ? 'scale(0.9)' : 'scale(1)',
          opacity: isOpen ? 0 : 1,
          pointerEvents: isOpen ? 'none' : 'auto',
          transition: 'transform 200ms ease, opacity 200ms ease',
        }}
        aria-label={tPred('cta.pick')}
      >
        <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="10" r="8" /><path d="M8 18h8" /><path d="M7 21h10" />
        </svg>
        <span>{tPred('cta.pick')}</span>
      </button>
    )
  }

  return null
}

const cornerTopStyle: React.CSSProperties = {
  fontSize: 8, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', lineHeight: 1,
}

function cornerPillStyle(bg: string, color: string, borderStyle: 'solid' | 'dashed' = 'solid'): React.CSSProperties {
  return {
    position: 'absolute', top: 10, right: 12, zIndex: 3,
    background: bg, color, padding: '5px 10px', cursor: 'pointer',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
    clipPath: CHUNKY.badge,
    border: `0.5px ${borderStyle} ${color}40`,
  }
}

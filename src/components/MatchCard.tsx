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

import { useEffect, useState, useRef } from 'react'
import { useTranslations } from 'next-intl'
import posthog from 'posthog-js'
import { Link } from '@/i18n/navigation'
import { FlagImage } from '@/components/FlagImage'
import { pairName, getMatchDisplay, type Match } from '@/types/match'
import { useLiveMatch } from '@/hooks/useLiveMatch'
import { shouldShowDayIndicator, formatDayChipLabel } from '@/lib/tournament-day-indicator'
import { countryToTimezone } from '@/lib/country-timezone'
import FollowButton from '@/components/FollowButton'

const GREEN = '#7ED321'
const LIVE_RED = '#FF4655'
const ORANGE = '#F5A623'
const BG_CARD = 'rgba(255,255,255,0.03)'
const BG_ELEV = '#1A1A1A'
const MUTED = '#6B7280'
const BORDER = 'rgba(255,255,255,0.06)'

const LATE_HINTS_ENABLED = process.env.NEXT_PUBLIC_LATE_HINTS_ENABLED !== 'false'

const CHUNKY = {
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
  card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
}

const PULSE_KEYFRAMES = `
@keyframes fipStreamPulse {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.18); }
}
@keyframes mc-score-sweep {
  0%   { transform: translateX(-110%); opacity: 0; }
  18%  { transform: translateX(0);     opacity: 1; }
  60%  { transform: translateX(0);     opacity: 1; }
  100% { transform: translateX(110%);  opacity: 0; }
}
@keyframes mc-locked-pop {
  0%   { opacity: 0; transform: translateY(-4px) scale(0.95); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes mc-day-tip-pop {
  0%   { opacity: 0; transform: translateX(-50%) translateY(-4px) scale(0.95); }
  100% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
}
`

// Module-level prev-score map keyed by match.id — survives card remounts
// (e.g. when MatchesDayShell refetches and React reconciles a new array of
// children) so the flash only fires on the actual transition tick, not on
// every mount. Same trick used by the home LiveMatchCard.
const PT_ORD: Record<string, number> = { '0': 0, '15': 1, '30': 2, '40': 3, 'A': 4, 'AD': 4 }
const _matchCardPrev = new Map<string, { p1Games: number; p2Games: number; p1Pts: string; p2Pts: string }>()

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

function tournamentLocationLabel(match: Match, locale: string): string {
  const t = (match as { tournament?: { name?: string | null; country?: string | null } }).tournament
  // Prefer the localised country name (PY → "Paraguai" in pt, "Paraguay" in
  // en). Falls back to the raw 2-letter code if Intl.DisplayNames can't
  // resolve, and to a name-strip if no country is set at all.
  if (t?.country) {
    try {
      const display = new Intl.DisplayNames([locale], { type: 'region' })
      const resolved = display.of(t.country.toUpperCase())
      if (resolved && resolved.toUpperCase() !== t.country.toUpperCase()) {
        return resolved
      }
    } catch {}
    return t.country
  }
  const name = t?.name ?? ''
  // Last-resort name-based fallback. Strip a trailing level/suffix
  // token only when it terminates the string — anchored end avoids
  // the false-positives a greedy mid-string match would create.
  return name.replace(/\s+(P[12]|Major|Mens|Womens|Premier(?:\s+Padel)?)\s*$/i, '').trim()
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
  /** Tournament level (e.g. 'p1', 'major', 'fip_silver'). Currently
   *  unused on MatchCard itself — kept so callers
   *  (MatchesTournamentGroup) can keep their existing prop signature
   *  unchanged. Safe to remove in a follow-up cleanup once nothing
   *  in MatchCard reads it. */
  tournamentLevel?: string | null
  /** Optional. ISO date (YYYY-MM-DD) of the matches-list day-tab the
   *  user has selected. When provided AND the match's tournament-local
   *  date differs, the card renders a small chip surfacing that date.
   *  Undefined on tournament-detail / match-detail — chip never fires. */
  dayBucketIso?: string
}

export function MatchCard({
  match: matchProp,
  genderColor,
  locale,
  userTz,
  estimatedLabel,
  dayBucketIso,
}: MatchCardProps) {
  const tTournament = useTranslations('tournament')
  const tMatch = useTranslations('match')

  // Per-match realtime subscription. Only opens the channel when the
  // match is live or warming up; for scheduled / finished cards we
  // happily render the parent's prop (the parent's status-only sub
  // will rewrite the prop when status flips).
  const isLiveStatus =
    matchProp.status === 'live' || (matchProp.status as string) === 'on_court'
  const match = useLiveMatch(matchProp.id, isLiveStatus, matchProp)

  // ── Unified display calculation ──────────────────────────────────
  // Single helper used by every card surface (home, matches, tournament,
  // match detail) — guarantees identical math everywhere.
  const display = getMatchDisplay(match)
  const { sets, winner, isLive, isFinished, isScheduled,
          livePointParts,
          pair1Serving: pair1IsServing, pair2Serving: pair2IsServing,
          pair1TotalGames: p1TotalGames, pair2TotalGames: p2TotalGames } = display
  const gamePoints = display.livePoint
  const scheduleLabel = (match as any).schedule_label as string | null
  const isApproximateTime = isScheduled && /not before|followed by/i.test(scheduleLabel ?? '')

  // ── Score-flash banner detection ─────────────────────────────────
  // Track prev (games, pts) per match.id in a module-level Map; on
  // transition fire the sweep banner on the scoring side. ~2.5s total.
  const [flashPair, setFlashPair] = useState<1 | 2 | null>(null)
  const flashKeyRef = useRef(0)
  const _p1Pts = livePointParts[0]
  const _p2Pts = livePointParts[1]
  useEffect(() => {
    if (!isLive) { _matchCardPrev.delete(match.id); return }
    const cur = { p1Games: p1TotalGames, p2Games: p2TotalGames, p1Pts: _p1Pts, p2Pts: _p2Pts }
    const prev = _matchCardPrev.get(match.id)
    if (prev && (
      prev.p1Games !== cur.p1Games ||
      prev.p2Games !== cur.p2Games ||
      prev.p1Pts !== cur.p1Pts ||
      prev.p2Pts !== cur.p2Pts
    )) {
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
      _matchCardPrev.set(match.id, cur)
      if (scorer) {
        flashKeyRef.current += 1
        setFlashPair(scorer)
        const t = setTimeout(() => setFlashPair(null), 2800)
        return () => clearTimeout(t)
      }
    } else {
      _matchCardPrev.set(match.id, cur)
    }
  }, [isLive, match.id, p1TotalGames, p2TotalGames, _p1Pts, _p2Pts])

  const round = formatRound(match.round)
  const courtRaw = match.court ? match.court.trim() : null
  const status = statusChip(match)
  const dateStr = formatShortDate(match, locale, userTz)
  const timeStr = formatScheduledTime(match, locale, userTz)

  // Tournament-day indicator (matches-list page only — gated on
  // dayBucketIso prop). When the match's tournament-local date
  // differs from the user-selected day-tab, surface a small chip
  // with a tap-to-explain tooltip.
  // tournament.timezone is null on most padelapi-imported (Premier
  // tour) rows and on FIP rows that haven't been hit by the hourly
  // enricher yet. Fall back to a country-code lookup so the chip
  // works for the entire calendar, not just the FIP-enriched subset.
  const tournamentMeta = (match as {
    tournament?: { timezone?: string | null; country?: string | null }
  }).tournament
  const tournamentTz =
    tournamentMeta?.timezone ?? countryToTimezone(tournamentMeta?.country)
  const showDayChip = shouldShowDayIndicator({
    status: match.status as string,
    finishedAt: match.finished_at,
    scheduledAt: match.scheduled_at,
    tournamentTimezone: tournamentTz,
    dayBucketIso,
  })
  const dayChipLabel = showDayChip
    ? formatDayChipLabel({
        timestamp: match.finished_at ?? match.scheduled_at,
        tournamentTimezone: tournamentTz,
        locale,
      })
    : null
  const [dayTipOpen, setDayTipOpen] = useState(false)
  const dayChipRef = useRef<HTMLButtonElement | null>(null)
  // Lift tooltip data alongside dayChipLabel so it's computed once per
  // render (only when the chip is actually shown) rather than inside an
  // IIFE in the JSX.
  const dayChipTooltip = showDayChip && dayChipLabel
    ? (() => {
        const ts = match.finished_at ?? match.scheduled_at
        if (!ts || !tournamentTz) return null
        return {
          tournamentWeekday: new Intl.DateTimeFormat(locale, {
            weekday: 'long',
            timeZone: tournamentTz,
          }).format(new Date(ts)),
          userWeekday: new Intl.DateTimeFormat(locale, {
            weekday: 'long',
            timeZone: userTz,
          }).format(new Date(ts)),
          location: tournamentLocationLabel(match, locale),
        }
      })()
    : null
  // Close on outside tap, Escape, or after a 4.5s auto-dismiss.
  useEffect(() => {
    if (!dayTipOpen) return
    const onPointerDown = (e: Event) => {
      const target = e.target as Node | null
      if (dayChipRef.current && target && !dayChipRef.current.contains(target)) {
        setDayTipOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDayTipOpen(false)
    }
    const dismissTimer = setTimeout(() => setDayTipOpen(false), 4500)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
      clearTimeout(dismissTimer)
    }
  }, [dayTipOpen])

  const borderColor = isLive ? 'rgba(255,70,85,0.22)' : BORDER

  // The whole card is always a <Link> to match detail. Interactive
  // children (the bookmark star at top-right, the day-indicator chip,
  // the late-hint pill on scheduled cards) all call preventDefault +
  // stopPropagation in their own onClick handlers so taps on those
  // don't navigate. Anywhere else in the card body navigates as
  // expected.
  const wrapperStyle = { textDecoration: 'none', color: 'inherit', display: 'block', marginBottom: 8 } as const
  const cardInner = (
    <>
      <style>{PULSE_KEYFRAMES}</style>
      <div
        style={{
          background: BG_CARD,
          border: `1px solid ${borderColor}`,
          clipPath: CHUNKY.card,
          // Asymmetric vertical padding: top has the 6px chip-row marginBottom
          // adding to the gap between chips and pair 1 text, so bottom can be
          // tighter to feel balanced. Without this, live cards look bottom-heavy
          // because there's nothing below the last pair row but card chrome.
          padding: '12px 14px 6px 16px',
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

        {/* Bookmark star — universal corner action. FollowButton handles
            preventDefault + stopPropagation internally so taps don't
            navigate the wrapping <Link> to match detail. */}
        <FollowButton
          type="match"
          targetId={match.id}
          variant="star"
          size={20}
          style={{ position: 'absolute', top: 10, right: 12, zIndex: 3 }}
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
            marginBottom: 6,
            position: 'relative',
            zIndex: 2,
          }}
        >
          {round && <Chip>{round}</Chip>}
          {courtRaw && <Chip>{courtRaw.toUpperCase()}</Chip>}
          {showDayChip && dayChipLabel && (
            <button
              ref={dayChipRef}
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setDayTipOpen(o => !o)
              }}
              aria-expanded={dayTipOpen}
              aria-label={dayChipLabel}
              style={{
                fontFamily: 'inherit',
                fontSize: 8,
                fontWeight: 800,
                letterSpacing: '0.4px',
                textTransform: 'uppercase',
                color: ORANGE,
                background: 'rgba(245,166,35,0.10)',
                border: '1px solid rgba(245,166,35,0.30)',
                padding: '2px 5px',
                clipPath: CHUNKY.badge,
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
                cursor: 'pointer',
              }}
            >
              {dayChipLabel}
            </button>
          )}
          {status && (
            <Chip bg={status.bg} color={status.color} bold>
              {status.label}
            </Chip>
          )}
          {LATE_HINTS_ENABLED && (
            <span
              title={tMatch('lateHint.estChipAria')}
              aria-label={tMatch('lateHint.estChipAria')}
              style={{
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: 0.4,
                textTransform: 'uppercase',
                color: GREEN,
                background: 'rgba(126,211,33,0.10)',
                border: '1px solid rgba(126,211,33,0.25)',
                padding: '2px 6px',
                clipPath: CHUNKY.badge,
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
              }}
            >
              {tMatch('lateHint.estChip')}
            </span>
          )}
        </div>

        {/* Pair rows: [names col | optional stream button (Task 11) | scores col] + right-aligned date/time */}
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 8, position: 'relative', zIndex: 2 }}>
          {/* Score-flash sweep banner — anchored to the pair row that scored.
              Pair rows have natural heights (no forced minHeight) so we use
              50% top split: top 0-50% for pair 1, 50-100% for pair 2.
              Since both pair rows have identical content structure (flag +
              text), they end up the same height naturally and the 50% split
              is exact. */}
          {flashPair && (
            <div
              key={`mc-sweep-${match.id}-${flashKeyRef.current}`}
              aria-hidden
              style={{
                position: 'absolute',
                left: -16,    // extend to the card's left edge (past the 16px padding)
                right: -14,   // extend to the card's right edge (past the 14px padding)
                top: flashPair === 1 ? '0%' : '50%',
                height: '50%',
                background: 'rgba(255, 70, 85, 0.55)',
                animation: 'mc-score-sweep 2.5s cubic-bezier(0.4, 0, 0.2, 1) forwards',
                pointerEvents: 'none',
                zIndex: 0,
                willChange: 'transform, opacity',
              }}
            />
          )}
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 10, flex: 1, minWidth: 0, position: 'relative', zIndex: 1 }}>

            {/* Names column — both pair-lefts stacked */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              {[1, 2].map(pairNum => {
                const p1 = pairNum === 1 ? match.pair1_player1 : match.pair2_player1
                const p2 = pairNum === 1 ? match.pair1_player2 : match.pair2_player2
                const pair = pairName(p1, p2)
                const isWinner = winner === pairNum
                const isLoser = winner !== 0 && winner !== pairNum
                const seed = pairNum === 1 ? match.pair1_seed : match.pair2_seed
                return (
                  <div key={pairNum} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0',
                    opacity: isLoser ? 0.65 : 1,
                    // Each pair row gets an equal share of the names column
                    // height. Without this, rows pack to natural heights and
                    // drift apart from the (taller) score column rows on the
                    // second row — pair 2 names sat ~6px above pair 2 scores.
                    flex: 1,
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
                      fontSize: 13, fontWeight: isWinner ? 700 : 600,
                      color: isLoser ? '#B0B5BE' : '#fff',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{pair}</span>
                    {seed != null && (
                      <span
                        title={`Seed ${seed}`}
                        style={{
                          flexShrink: 0,
                          fontSize: 9,
                          fontWeight: 800,
                          letterSpacing: 0.3,
                          color: isLoser ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.7)',
                          background: 'rgba(255,255,255,0.08)',
                          padding: '1px 5px',
                          minWidth: 14,
                          textAlign: 'center',
                          clipPath: CHUNKY.badge,
                          lineHeight: 1.2,
                        }}
                      >
                        {seed}
                      </span>
                    )}
                    {((pairNum === 1 && pair1IsServing) || (pairNum === 2 && pair2IsServing)) && (
                      <span
                        title="Serving"
                        aria-label="Serving"
                        style={{
                          flexShrink: 0,
                          width: 7,
                          height: 7,
                          borderRadius: '50%',
                          background: '#F5C518',
                          boxShadow: '0 0 6px rgba(245,197,24,0.55)',
                        }}
                      />
                    )}
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

            {/* Scores column — both score rows stacked */}
            <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
              {[1, 2].map(pairNum => {
                const isLoser = winner !== 0 && winner !== pairNum
                return (
                  <div key={pairNum} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                    gap: 8, padding: '5px 0', opacity: isLoser ? 0.65 : 1,
                    // Equal-share row height — paired with the names column's
                    // flex:1 so both columns' pair 1 / pair 2 boundaries align.
                    flex: 1,
                  }}>
                    {sets.map(ps => {
                      const games = pairNum === 1 ? ps.p1Games : ps.p2Games
                      const tb = ps.tb
                      const wonThisSet = pairNum === 1 ? ps.pair1Won : ps.pair2Won
                      const isCurrent = ps.raw.is_current && isLive
                      return (
                        <span
                          key={ps.raw.id}
                          style={{
                            fontSize: 16,
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
                        {livePointParts[pairNum === 1 ? 0 : 1]}
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
              {LATE_HINTS_ENABLED && timeStr && (match.late_hint === 'may_be_late' || match.late_hint === 'starting_soon') && (
                <LateHintPill
                  hint={match.late_hint}
                  courtName={match.court ?? ''}
                  matchId={match.id}
                  tMatch={tMatch}
                />
              )}
            </div>
          )}
        </div>

        {/* Day-indicator tooltip — anchored to the bottom-center of the
            card body so the chunky popover frames the match without
            overlapping the title row. Click anywhere on the popover (or
            outside the card, or after 4.5s) to dismiss. Mirrors the
            LateHintPill visual treatment. */}
        {dayTipOpen && dayChipTooltip && (
          <div
            role="tooltip"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDayTipOpen(false) }}
            style={{
              position: 'absolute',
              left: '50%',
              bottom: 8,
              transform: 'translateX(-50%)',
              zIndex: 4,
              maxWidth: 260,
              width: 'calc(100% - 24px)',
              padding: '10px 12px 10px 14px',
              background: 'linear-gradient(135deg, #1A1A1D 0%, #131316 100%)',
              clipPath: CHUNKY.badge,
              boxShadow: `0 8px 24px rgba(0,0,0,0.5), 0 0 0 0.5px rgba(255,255,255,0.08), inset 0 0 24px ${ORANGE}10`,
              cursor: 'pointer',
              animation: 'mc-day-tip-pop 220ms cubic-bezier(0.34, 1.56, 0.64, 1) both',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
            }}
          >
            <span style={{ flexShrink: 0, marginTop: 1, display: 'inline-flex' }}>
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={ORANGE} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="3" y="5" width="18" height="16" rx="2" />
                <path d="M3 10h18" />
                <path d="M8 3v4" />
                <path d="M16 3v4" />
              </svg>
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontSize: 9,
                fontWeight: 800,
                color: ORANGE,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
                marginBottom: 3,
                lineHeight: 1.2,
              }}>
                {dayChipLabel}
              </div>
              <div style={{
                color: '#D8D8DD',
                fontSize: 11,
                fontWeight: 500,
                lineHeight: 1.4,
              }}>
                {tMatch('dayIndicator.tooltip', {
                  weekday: dayChipTooltip.tournamentWeekday,
                  location: dayChipTooltip.location,
                  userWeekday: dayChipTooltip.userWeekday,
                })}
              </div>
            </div>
          </div>
        )}

      </div>
    </>
  )

  return (
    <Link
      href={`/match/${match.id}`}
      locale={locale as 'en' | 'es' | 'pt' | 'it' | 'fr'}
      style={wrapperStyle}
    >
      {cardInner}
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

// ── LateHintPill — small dotted-underline tap target under the time ────────
//
// Renders only on scheduled matches with a real timeStr and a non-null
// late_hint. Tapping pops a tiny info sheet (3.5s auto-dismiss, or
// tap the sheet again to close earlier):
//
// Two variants:
//   may_be_late   → orange (#F5A623), "may be late"   → "...running long..."
//   starting_soon → green  (#7ED321), "starting soon" → "...should be called shortly..."

interface LateHintPillProps {
  hint: 'may_be_late' | 'starting_soon'
  courtName: string
  matchId: string
  tMatch: ReturnType<typeof useTranslations>
}

function LateHintPill({ hint, courtName, matchId, tMatch }: LateHintPillProps) {
  const [open, setOpen] = useState(false)
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fire 'shown' once per mount
  useEffect(() => {
    posthog.capture('schedule_late_hint_shown', { matchId, hint })
  }, [matchId, hint])

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setOpen((prev) => !prev)
    // Fire 'tapped' only on OPEN (not on close)
    if (!open) {
      posthog.capture('schedule_late_hint_tapped', { matchId, hint })
    }
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
    if (!open) {
      dismissTimerRef.current = setTimeout(() => setOpen(false), 4500)
    }
  }

  useEffect(() => () => { if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current) }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const isLate = hint === 'may_be_late'
  const accent = isLate ? ORANGE : GREEN
  const labelKey = isLate ? 'lateHint.mayBeLate' : 'lateHint.startingSoon'
  const ariaKey  = isLate ? 'lateHint.mayBeLateAria' : 'lateHint.startingSoonAria'
  const sheetKey = isLate ? 'lateHint.mayBeLateSheet' : 'lateHint.startingSoonSheet'

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        aria-label={tMatch(ariaKey)}
        aria-expanded={open}
        style={{
          marginTop: 2,
          padding: '4px 0',
          border: 0,
          background: 'transparent',
          color: accent,
          opacity: isLate ? 0.85 : 0.95,
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: 0.2,
          cursor: 'pointer',
          borderBottom: `1px dotted ${accent}66`,
          lineHeight: 1.2,
          alignSelf: 'flex-end',
        }}
      >
        {tMatch(labelKey)}
      </button>
      {open && (
        <div
          role="tooltip"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false) }}
          style={{
            position: 'absolute',
            right: 12,
            bottom: 6,
            zIndex: 4,
            maxWidth: 260,
            padding: '10px 12px 10px 14px',
            background: 'linear-gradient(135deg, #1A1A1D 0%, #131316 100%)',
            clipPath: CHUNKY.badge,
            boxShadow: `0 8px 24px rgba(0,0,0,0.5), 0 0 0 0.5px rgba(255,255,255,0.08), inset 0 0 24px ${accent}10`,
            cursor: 'pointer',
            animation: 'mc-locked-pop 220ms cubic-bezier(0.34, 1.56, 0.64, 1) both',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
          }}
        >
          <span style={{ flexShrink: 0, marginTop: 1, display: 'inline-flex' }}>
            {isLate ? (
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
            ) : (
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M5 12h14" />
                <path d="M13 6l6 6-6 6" />
              </svg>
            )}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: 9,
              fontWeight: 800,
              color: accent,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              marginBottom: 3,
              lineHeight: 1.2,
            }}>
              {tMatch(labelKey)}
            </div>
            <div style={{
              color: '#D8D8DD',
              fontSize: 11,
              fontWeight: 500,
              lineHeight: 1.4,
            }}>
              {tMatch(sheetKey, { court: courtName })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

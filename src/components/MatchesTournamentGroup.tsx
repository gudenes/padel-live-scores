'use client'

// src/components/MatchesTournamentGroup.tsx
//
// Tournament-grouped match card for /matches/[date]. Each group renders
// a rich header (flag, name, level pill, date range, match count, expand
// chevron) and a body that reads as one chronological list:
//
//   - Active section: live + upcoming, sorted by scheduled_at ascending.
//     Live matches stay in their natural time slot — the red LIVE chip on
//     the MatchCard provides the visual emphasis.
//   - Finished section: separated by a green "FINISHED · N" divider, sorted
//     by finished_at descending (most-recent finish first).
//
// Sort + partition is delegated to bucketDayMatches in
// src/lib/match-day-bucket.ts (covered by 12 unit tests).
//
// Filter integration: the wrapper carries `data-tour-group` + `data-league`
// + `data-tier` so MatchesFilterClient can hide the whole tournament when
// it doesn't match the league/tier filter. Each match wrapper inside
// carries `data-match` + `data-category` + `data-qualifier` + `data-status`
// for per-match filtering.

import { useState } from 'react'
import { Link } from '@/i18n/navigation'
import { FlagImage } from '@/components/FlagImage'
import { MatchCard } from '@/components/MatchCard'
import {
  levelLabel,
  mostAdvancedRoundEntry,
  stageChipKey,
} from '@/lib/tournament-labels'
import { useTranslations } from 'next-intl'
import type { Match } from '@/types/match'
import { bucketDayMatches, bucketStatus } from '@/lib/match-day-bucket'

const GREEN = '#7ED321'
const LIVE_RED = '#FF4655'
const BG_CARD = '#141414'
const MUTED = '#6B7280'
const MEN_BLUE = '#4A9EFF'
const WOMEN_PURPLE = '#D966FF'

const CHUNKY = {
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
}

// ── Types ────────────────────────────────────────────────────────────────

/** Narrow shape used by the daily-page query — much smaller than the full
 *  Match type. MatchCard reads selectively and null-checks every
 *  nullable field, so the cast through `unknown as Match` inside is safe. */
export interface GroupMatch {
  id: string
  status: string
  category: string | null
  scheduled_at: string | null
  finished_at: string | null
  duration: string | null
  round: string | null
  court: string | null
  court_order: number | null
  schedule_label: string | null
  winner_pair: number | null
  pair1_seed: number | null
  pair2_seed: number | null
  pair1_player1: unknown
  pair1_player2: unknown
  pair2_player1: unknown
  pair2_player2: unknown
  sets: unknown[] | null
}

export interface TournamentGroupData {
  tournamentId: string
  tournamentName: string
  tournamentLevel: string | null
  tournamentCountry: string | null
  tournamentStartsAt: string | null
  tournamentEndsAt: string | null
  tournamentStatus: string | null
  matches: GroupMatch[]
  /** Whether this tournament's level is Premier (drives data-league). */
  isPremier: boolean
  /** Locale, threaded for the tournament-detail link. */
  locale: string
  /** User timezone for date-range formatting. */
  userTz: string
  /** Optional. ISO YYYY-MM-DD of the matches-list day-tab. When passed,
   *  finished matches whose tournament-local date differs render the
   *  day chip. */
  dayBucketIso?: string
}

// ── Helpers ──────────────────────────────────────────────────────────────

function isQualifierRound(round: string | null): boolean {
  if (!round) return false
  return /^(?:q\d|qual)/i.test(round.trim())
}

function formatDateRange(
  startsAt: string | null,
  endsAt: string | null,
  locale: string,
  tz: string,
): string {
  if (!startsAt) return ''
  const fmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: tz })
  const start = fmt.format(new Date(startsAt))
  if (!endsAt) return start
  const end = fmt.format(new Date(endsAt))
  if (start === end) return start
  return `${start} \u2013 ${end}`
}

// Orange — used for "tournament is in its calendar window but no match is
// being played right now". Same hue as the home page's "Ongoing" state so
// the two surfaces stay in sync. Imported lazily to avoid a top-level
// constants reshuffle.
const ONGOING_ORANGE = '#F5A623'

function tournamentStatusBadge(
  groupBucketCounts: { live: number; upcoming: number; finished: number },
  tournamentStatus: string | null,
): { label: string; bg: string; color: string } | null {
  // The red LIVE pill is reserved for actual live matches. `tournaments.
  // status` from padelapi is too coarse — it reports 'live' for any
  // event in its calendar window, regardless of whether play is ongoing
  // right this second. Pre-fix that fallback fired all night for any
  // currently-running tournament, so the pill was a noisy alarm.
  //
  // Trust order:
  //   1. matches.status='live' on at least one of today's matches → LIVE
  //   2. tournament.status='finished'/'completed'/'ended' → FINAL
  //   3. mixed bucket today (upcoming + finished, no live) → ONGOING
  //      — play has demonstrably started today, that's a stronger signal
  //      than tournament.status which can be stale ('pending' for FIP
  //      Silver Leiria/Mendoza even after Q1 wraps, null when padelapi
  //      never reported a status for FIP-only tiers)
  //   4. tournament.status='live'/'ongoing' → ONGOING
  //      — fallback for tournaments with no matches today (rest day) but
  //      still in window (Cyprus I waiting on Day 2)
  //   5. only upcoming today → UPCOMING
  //   6. only finished today → FINAL
  //   7. otherwise → no pill
  if (groupBucketCounts.live > 0) {
    return { label: 'LIVE', bg: 'rgba(255,70,85,0.18)', color: LIVE_RED }
  }
  const ts = (tournamentStatus ?? '').toLowerCase()
  if (ts === 'finished' || ts === 'completed' || ts === 'ended') {
    return { label: 'FINAL', bg: 'rgba(255,255,255,0.06)', color: MUTED }
  }
  // Mixed bucket — at least one finished AND at least one upcoming, no live.
  // This is the strongest "ongoing" signal in the data.
  if (groupBucketCounts.finished > 0 && groupBucketCounts.upcoming > 0) {
    return { label: 'ONGOING', bg: 'rgba(245,166,35,0.15)', color: ONGOING_ORANGE }
  }
  if (ts === 'live' || ts === 'ongoing') {
    return { label: 'ONGOING', bg: 'rgba(245,166,35,0.15)', color: ONGOING_ORANGE }
  }
  if (groupBucketCounts.upcoming > 0 && groupBucketCounts.finished === 0) {
    return { label: 'UPCOMING', bg: 'rgba(126,211,33,0.12)', color: GREEN }
  }
  if (groupBucketCounts.upcoming === 0 && groupBucketCounts.finished > 0) {
    return { label: 'FINAL', bg: 'rgba(255,255,255,0.06)', color: MUTED }
  }
  return null
}

// ── Component ───────────────────────────────────────────────────────────

export default function MatchesTournamentGroup({ group }: { group: TournamentGroupData }) {
  const tStage = useTranslations('match.stageChip')
  const tDaily = useTranslations('daily')

  // Aggregate counts for the tournament-level status pill (LIVE / ONGOING
  // / UPCOMING / FINAL). Same buckets the old layout exposed as sub-
  // sections — we just don't render them as sections anymore.
  let liveCount = 0
  let upcomingCount = 0
  let finishedCount = 0
  for (const m of group.matches) {
    const b = bucketStatus(m.status)
    if (b === 'live') liveCount++
    else if (b === 'upcoming') upcomingCount++
    else if (b === 'finished') finishedCount++
  }
  const total = group.matches.length
  const counts = { live: liveCount, upcoming: upcomingCount, finished: finishedCount }

  // Chronological buckets: live + upcoming first (sorted by scheduled_at),
  // then finished at the bottom (sorted by finished_at desc). See
  // `src/lib/match-day-bucket.ts` for the sort rules + tests.
  const { active, finished } = bucketDayMatches(group.matches)

  const [expanded, setExpanded] = useState(true)
  const tournamentStatusPill = tournamentStatusBadge(counts, group.tournamentStatus)

  // Stage chip — surfaces today's most-advanced round (Final / Semifinals /
  // Quarterfinals / R16 / R32 / R64 / R128 / Qualifying). Drives the
  // group sort already (in fetch-matches-day.ts) and the chip here is the
  // visual surface of the same signal: climactic content reads as
  // climactic. Skipped when no round is recognised.
  const stageEntry = mostAdvancedRoundEntry(group.matches)
  const stageKey = stageChipKey(stageEntry.round)
  const stageChip = stageKey
    ? (() => {
        // Color-code by stage intensity. Final → red, Semifinals → orange,
        // earlier main draw → green, Qualifying → muted. Matches the
        // visual hierarchy users expect from the matches list.
        const isFinal = stageKey === 'final'
        const isSemi = stageKey === 'semifinals'
        const isQual = stageKey === 'qualifying'
        if (isFinal) return { label: tStage('final'), color: LIVE_RED, bg: 'rgba(255,70,85,0.18)' }
        if (isSemi) return { label: tStage('semifinals'), color: ONGOING_ORANGE, bg: 'rgba(245,166,35,0.15)' }
        if (isQual) return { label: tStage('qualifying'), color: MUTED, bg: 'rgba(255,255,255,0.06)' }
        return { label: tStage(stageKey as 'quarterfinals'|'r16'|'r32'|'r64'|'r128'), color: GREEN, bg: 'rgba(126,211,33,0.12)' }
      })()
    : null
  const dataLeague = group.isPremier ? 'premier' : 'fip'
  const levelText = group.tournamentLevel ? levelLabel(group.tournamentLevel) : null
  const dateText = formatDateRange(
    group.tournamentStartsAt,
    group.tournamentEndsAt,
    group.locale,
    group.userTz,
  )

  return (
    <div
      data-tour-group
      data-league={dataLeague}
      data-tier={group.tournamentLevel ?? ''}
      style={{ marginBottom: 14, overflow: 'hidden' }}
    >
      {/* ── Header — clickable, toggles expanded state ─────────────────── */}
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          padding: '12px 14px',
          background: '#1e1e1e',
          border: 0,
          cursor: 'pointer',
          position: 'relative',
          color: 'inherit',
          fontFamily: 'inherit',
          textAlign: 'left',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        {/* Top accent — green when expanded, hidden when collapsed. Live
            tournaments override to red so the user spots them at a glance. */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: counts.live > 0 ? LIVE_RED : GREEN,
            transform: expanded ? 'scaleX(1)' : 'scaleX(0)',
            transformOrigin: 'left',
            transition: 'transform 0.3s ease',
          }}
        />

        {group.tournamentCountry && (
          <FlagImage country={group.tournamentCountry} size={20} />
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Link
              href={`/tournaments/${group.tournamentId}`}
              locale={group.locale as 'en' | 'es' | 'pt' | 'it' | 'fr'}
              onClick={(e) => e.stopPropagation()}
              style={{
                fontSize: 13,
                fontWeight: 800,
                color: '#fff',
                textDecoration: 'none',
                letterSpacing: -0.1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: '100%',
              }}
            >
              {group.tournamentName}
            </Link>
            {tournamentStatusPill && (
              <span
                style={{
                  fontSize: 8,
                  fontWeight: 800,
                  letterSpacing: 0.5,
                  padding: '2px 6px',
                  clipPath: CHUNKY.badge,
                  color: tournamentStatusPill.color,
                  background: tournamentStatusPill.bg,
                  flexShrink: 0,
                  lineHeight: '12px',
                  textTransform: 'uppercase',
                }}
              >
                {tournamentStatusPill.label}
              </span>
            )}
            {stageChip && (
              <span
                style={{
                  fontSize: 8,
                  fontWeight: 800,
                  letterSpacing: 0.5,
                  padding: '2px 6px',
                  clipPath: CHUNKY.badge,
                  color: stageChip.color,
                  background: stageChip.bg,
                  flexShrink: 0,
                  lineHeight: '12px',
                  textTransform: 'uppercase',
                }}
              >
                {stageChip.label}
              </span>
            )}
          </div>
          {(levelText || dateText) && (
            <div
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: MUTED,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
                marginTop: 3,
              }}
            >
              {levelText}
              {levelText && dateText ? ' \u00B7 ' : ''}
              {dateText}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: MUTED,
              background: 'rgba(255,255,255,0.05)',
              padding: '2px 8px',
              clipPath: CHUNKY.badge,
            }}
          >
            {total}
          </span>
          <span
            style={{
              fontSize: 10,
              color: MUTED,
              display: 'inline-block',
              transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition: 'transform 0.3s ease',
            }}
          >
            {'\u25BC'}
          </span>
        </div>
      </button>

      {/* ── Body — chronological list, finished section at the bottom ──── */}
      <div
        style={{
          overflow: 'hidden',
          // Approximate ceiling: ~130px per match row + ~50px for the
          // finished-section divider (when present) + 100px slack.
          // Doesn't need to be exact since overflow:hidden clips the rest
          // when collapsed.
          maxHeight: expanded ? total * 130 + (finished.length > 0 ? 50 : 0) + 100 : 0,
          transition: 'max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
          background: BG_CARD,
        }}
      >
        {/* Active: live + upcoming, sorted chronologically */}
        {active.map(m => {
          const s = bucketStatus(m.status)
          const status: 'live' | 'upcoming' | 'finished' = s ?? 'upcoming'
          return (
            <MatchEntry
              key={m.id}
              match={m}
              status={status}
              locale={group.locale}
              userTz={group.userTz}
              tournamentLevel={group.tournamentLevel}
              dayBucketIso={group.dayBucketIso}
            />
          )
        })}

        {/* Finished section divider — only when there are finished matches */}
        {finished.length > 0 && (
          <div
            data-finished-section
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '16px 6px 8px',
            }}
          >
            <span
              style={{
                fontFamily: 'inherit',
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: 2,
                color: GREEN,
                textTransform: 'uppercase',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {tDaily('finishedSection')}
              <span
                style={{
                  color: GREEN,
                  fontFamily: 'monospace',
                  fontSize: 10,
                  fontWeight: 700,
                  background: 'rgba(126, 211, 33, 0.12)',
                  padding: '1px 6px',
                  borderRadius: 3,
                  lineHeight: 1.4,
                }}
              >
                {finished.length}
              </span>
            </span>
            <div
              style={{
                flex: 1,
                height: 1,
                background: 'linear-gradient(90deg, rgba(126,211,33,0.28), transparent)',
              }}
            />
          </div>
        )}

        {/* Finished: most-recent finish first */}
        {finished.map(m => (
          <MatchEntry
            key={m.id}
            match={m}
            status="finished"
            locale={group.locale}
            userTz={group.userTz}
            tournamentLevel={group.tournamentLevel}
            dayBucketIso={group.dayBucketIso}
          />
        ))}
      </div>
    </div>
  )
}

function MatchEntry({
  match,
  status,
  locale,
  userTz,
  tournamentLevel,
  dayBucketIso,
}: {
  match: GroupMatch
  status: 'live' | 'upcoming' | 'finished'
  locale: string
  userTz: string
  tournamentLevel: string | null
  dayBucketIso: string | undefined
}) {
  const matchAsFull = match as unknown as Match
  const genderColor = match.category === 'women' ? WOMEN_PURPLE : MEN_BLUE
  const isQualifier = isQualifierRound(match.round)
  return (
    <div
      data-match
      data-category={match.category ?? ''}
      data-qualifier={isQualifier ? '1' : '0'}
      data-status={status}
      style={{ padding: '0 8px' }}
    >
      <MatchCard
        match={matchAsFull}
        genderColor={genderColor}
        locale={locale}
        userTz={userTz}
        tournamentLevel={tournamentLevel}
        dayBucketIso={dayBucketIso}
      />
    </div>
  )
}

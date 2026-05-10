'use client'

// src/components/MatchesTournamentGroup.tsx
//
// Tournament-grouped match card for /matches/[date]. Each group renders
// a rich header (flag, name, level pill, date range, match count, expand
// chevron) and a body that breaks the matches down by COURT — same
// layout organizers use on the official OOP page (Brussels: CBC →
// Nextensa → Lotto). Court order: tournament_courts.display_order if
// present, alphabetical fallback. Within each court, matches sort by
// matches.court_order ascending so the day's running order is preserved.
//
// Why courts instead of live/upcoming/finished sub-sections: with status
// sub-sections the layout reshuffled every time a match flipped state,
// and the natural reading order on-site IS by court. The status signal
// is preserved via a chip on each match row.
//
// Filter integration: the wrapper carries `data-tour-group` + `data-league`
// + `data-tier` so MatchesFilterClient can hide the whole tournament when
// it doesn't match the league/tier filter. Each match wrapper inside
// carries `data-match` + `data-category` + `data-qualifier` + `data-status`
// for per-match filtering. Court-section wrappers carry `data-court-section`
// so the cascade can hide an emptied court header.

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from '@/i18n/navigation'
import { FlagImage } from '@/components/FlagImage'
import { MatchCard } from '@/components/MatchCard'
import { levelLabel } from '@/lib/tournament-labels'
import type { Match } from '@/types/match'

const GREEN = '#7ED321'
const LIVE_RED = '#FF4655'
const BG_CARD = '#141414'
const MUTED = '#6B7280'
const BORDER = 'rgba(255,255,255,0.06)'
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
  /** Per-court display order from `tournament_courts.display_order`,
   *  keyed by lowercased court name. Empty record = no OOP-derived
   *  order; consumers sort courts alphabetically. */
  courtOrder: Record<string, number>
  /** "Court" label for sub-section headers, translated server-side. */
  courtLabel: string
  /** "Unknown court" fallback for matches with no court value. */
  unknownCourtLabel: string
  /** Plain "LIVE"/"EN VIVO"/etc suffix for the per-court live pill. The
   *  count is composed in the component (`{n} {suffix}`) — keeping the
   *  message free of ICU placeholders avoids next-intl validation errors
   *  when consumers don't pass a count argument. */
  liveCountLabel: string
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

const LIVE_STATUSES = new Set(['live', 'on_court'])
const UPCOMING_STATUSES = new Set(['scheduled'])
const FINISHED_STATUSES = new Set(['finished', 'retired', 'walkover', 'ended'])

function bucketStatus(s: string): 'live' | 'upcoming' | 'finished' | null {
  if (LIVE_STATUSES.has(s)) return 'live'
  if (UPCOMING_STATUSES.has(s)) return 'upcoming'
  if (FINISHED_STATUSES.has(s)) return 'finished'
  return null
}

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

  // Bucket matches by court name. `null` court goes into a synthetic
  // "—" bucket that sorts last. Within each court, sort by court_order
  // ascending (1-based per-court sequence from OOP), then by
  // scheduled_at as tiebreaker.
  const courtBuckets = new Map<string, GroupMatch[]>()
  for (const m of group.matches) {
    const key = m.court ?? ''
    if (!courtBuckets.has(key)) courtBuckets.set(key, [])
    courtBuckets.get(key)!.push(m)
  }
  for (const [, list] of courtBuckets) {
    list.sort((a, b) => {
      const oa = a.court_order ?? 9999
      const ob = b.court_order ?? 9999
      if (oa !== ob) return oa - ob
      const sa = a.scheduled_at ?? ''
      const sb = b.scheduled_at ?? ''
      return sa.localeCompare(sb)
    })
  }
  // Court order: tournament_courts.display_order first (case-insensitive
  // lookup), alphabetical fallback. Null/empty court bucket sorts last.
  const sortedCourtKeys = Array.from(courtBuckets.keys()).sort((a, b) => {
    if (!a && !b) return 0
    if (!a) return 1
    if (!b) return -1
    const oa = group.courtOrder[a.toLowerCase()]
    const ob = group.courtOrder[b.toLowerCase()]
    const hasA = oa !== undefined
    const hasB = ob !== undefined
    if (hasA && hasB) return oa - ob
    if (hasA) return -1
    if (hasB) return 1
    return a.localeCompare(b)
  })
  const courtCount = sortedCourtKeys.length

  const [expanded, setExpanded] = useState(true)
  const tournamentStatusPill = tournamentStatusBadge(counts, group.tournamentStatus)
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

      {/* ── Body — collapsible court sub-sections ──────────────────────── */}
      <div
        style={{
          overflow: 'hidden',
          // Approximate ceiling: ~130px per match row + ~36px per court
          // header + 100px slack. Doesn't need to be exact since
          // overflow:hidden clips the rest when collapsed.
          maxHeight: expanded ? total * 130 + courtCount * 36 + 100 : 0,
          transition: 'max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
          background: BG_CARD,
        }}
      >
        {sortedCourtKeys.map(courtKey => {
          const matches = courtBuckets.get(courtKey)!
          const liveInCourt = matches.filter(m => bucketStatus(m.status) === 'live').length
          const courtName = courtKey || group.unknownCourtLabel
          return (
            <CourtSection
              key={courtKey || '__none__'}
              name={courtName}
              count={matches.length}
              liveCount={liveInCourt}
              liveCountLabel={group.liveCountLabel}
              showHeader={courtCount > 1}
            >
              {matches.map(m => {
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
            </CourtSection>
          )
        })}
      </div>
    </div>
  )
}

function CourtSection({
  name,
  count,
  liveCount,
  liveCountLabel,
  showHeader,
  children,
}: {
  name: string
  count: number
  liveCount: number
  liveCountLabel: string
  showHeader: boolean
  children: ReactNode
}) {
  // The accent stays muted by default — courts aren't statuses, the
  // chip on each MatchCard already conveys live/upcoming/finished. The
  // accent goes red ONLY when at least one match in the court is live,
  // which mirrors the LIVE pill at the tournament-group level.
  const accent = liveCount > 0 ? LIVE_RED : MUTED
  return (
    <div data-court-section style={{ padding: '6px 0' }}>
      {showHeader && (
        <div
          data-court-header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 14px 6px',
          }}
        >
          <span
            style={{
              width: 3,
              height: 12,
              background: accent,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: 9,
              fontWeight: 800,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.85)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
              flex: '0 1 auto',
            }}
          >
            {name}
          </span>
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: MUTED,
              background: 'rgba(255,255,255,0.04)',
              padding: '1px 6px',
              clipPath: CHUNKY.badge,
              flexShrink: 0,
            }}
          >
            {count}
          </span>
          {liveCount > 0 && (
            <span
              style={{
                fontSize: 8,
                fontWeight: 800,
                letterSpacing: 0.5,
                padding: '2px 6px',
                clipPath: CHUNKY.badge,
                color: LIVE_RED,
                background: 'rgba(255,70,85,0.18)',
                lineHeight: '12px',
                textTransform: 'uppercase',
                flexShrink: 0,
              }}
            >
              {`${liveCount} ${liveCountLabel}`}
            </span>
          )}
        </div>
      )}
      {children}
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

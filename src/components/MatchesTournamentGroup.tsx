'use client'

// src/components/MatchesTournamentGroup.tsx
//
// Tournament-grouped match card for /matches/[date]. Each group renders
// a rich header (flag, name, level pill, date range, match count, expand
// chevron) and a body that breaks the matches down into Live Now /
// Upcoming / Results sub-sections — only sub-sections with matches show
// up.
//
// Mirrors the pattern the old client-tabs /matches page used (the design
// the user is happy with), adapted to take server-rendered match data so
// the daily page stays SEO-crawlable. Collapse state is local to each
// group; defaults to expanded.
//
// Filter integration: the wrapper carries `data-tour-group` + `data-league`
// + `data-tier` so MatchesFilterClient can hide the whole tournament when
// it doesn't match the league/tier filter. Each match wrapper inside
// carries `data-match` + `data-category` + `data-qualifier` + `data-status`
// for per-match filtering. Sub-section wrappers carry `data-substatus`
// so the cascade can hide an emptied sub-section header.

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from '@/i18n/navigation'
import { FlagImage } from '@/components/FlagImage'
import { DailyMatchCard } from '@/components/DailyMatchCard'
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
 *  Match type. V3MatchCard reads selectively and null-checks every
 *  nullable field, so the cast through `unknown as Match` inside is safe. */
export interface GroupMatch {
  id: string
  status: string
  category: string | null
  scheduled_at: string | null
  finished_at: string | null
  round: string | null
  court: string | null
  schedule_label: string | null
  winner_pair: number | null
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
  /** Sub-section labels translated server-side and passed in so the client
   *  component doesn't need its own translator round-trip. */
  labels: {
    liveNow: string
    upcoming: string
    results: string
  }
  /** Whether this tournament's level is Premier (drives data-league). */
  isPremier: boolean
  /** Locale, threaded for the tournament-detail link. */
  locale: string
  /** User timezone for date-range formatting. */
  userTz: string
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

function tournamentStatusBadge(
  groupBucketCounts: { live: number; upcoming: number; finished: number },
  tournamentStatus: string | null,
): { label: string; bg: string; color: string } | null {
  // Live trumps everything — if the tournament has live matches today,
  // that's the headline. Otherwise fall back to the tournament's stored
  // status, then to the bucket-derived state.
  if (groupBucketCounts.live > 0) {
    return { label: 'LIVE', bg: 'rgba(255,70,85,0.18)', color: LIVE_RED }
  }
  const ts = (tournamentStatus ?? '').toLowerCase()
  if (ts === 'live' || ts === 'ongoing') {
    return { label: 'LIVE', bg: 'rgba(255,70,85,0.18)', color: LIVE_RED }
  }
  if (ts === 'finished' || ts === 'completed' || ts === 'ended') {
    return { label: 'FINAL', bg: 'rgba(255,255,255,0.06)', color: MUTED }
  }
  if (groupBucketCounts.live === 0 && groupBucketCounts.upcoming > 0 && groupBucketCounts.finished === 0) {
    return { label: 'UPCOMING', bg: 'rgba(126,211,33,0.12)', color: GREEN }
  }
  if (groupBucketCounts.live === 0 && groupBucketCounts.upcoming === 0 && groupBucketCounts.finished > 0) {
    return { label: 'FINAL', bg: 'rgba(255,255,255,0.06)', color: MUTED }
  }
  return null
}

// ── Component ───────────────────────────────────────────────────────────

export default function MatchesTournamentGroup({ group }: { group: TournamentGroupData }) {
  // Bucket matches by status in render order (live → upcoming → finished).
  const live: GroupMatch[] = []
  const upcoming: GroupMatch[] = []
  const finished: GroupMatch[] = []
  for (const m of group.matches) {
    const b = bucketStatus(m.status)
    if (b === 'live') live.push(m)
    else if (b === 'upcoming') upcoming.push(m)
    else if (b === 'finished') finished.push(m)
  }
  const total = group.matches.length
  const counts = { live: live.length, upcoming: upcoming.length, finished: finished.length }

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

      {/* ── Body — collapsible per-status sub-sections ─────────────────── */}
      <div
        style={{
          overflow: 'hidden',
          maxHeight: expanded ? total * 130 + 200 : 0,
          transition: 'max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
          background: BG_CARD,
        }}
      >
        {live.length > 0 && (
          <SubSection
            label={group.labels.liveNow}
            accent={LIVE_RED}
            substatus="live"
            count={live.length}
            showSubLabel={hasMultipleBuckets(counts)}
          >
            {live.map(m => (
              <MatchEntry key={m.id} match={m} status="live" locale={group.locale} userTz={group.userTz} />
            ))}
          </SubSection>
        )}
        {upcoming.length > 0 && (
          <SubSection
            label={group.labels.upcoming}
            accent={GREEN}
            substatus="upcoming"
            count={upcoming.length}
            showSubLabel={hasMultipleBuckets(counts)}
          >
            {upcoming.map(m => (
              <MatchEntry key={m.id} match={m} status="upcoming" locale={group.locale} userTz={group.userTz} />
            ))}
          </SubSection>
        )}
        {finished.length > 0 && (
          <SubSection
            label={group.labels.results}
            accent={MUTED}
            substatus="finished"
            count={finished.length}
            showSubLabel={hasMultipleBuckets(counts)}
          >
            {finished.map(m => (
              <MatchEntry key={m.id} match={m} status="finished" locale={group.locale} userTz={group.userTz} />
            ))}
          </SubSection>
        )}
      </div>
    </div>
  )
}

function hasMultipleBuckets(counts: { live: number; upcoming: number; finished: number }): boolean {
  let n = 0
  if (counts.live > 0) n++
  if (counts.upcoming > 0) n++
  if (counts.finished > 0) n++
  return n > 1
}

function SubSection({
  label,
  accent,
  substatus,
  count,
  showSubLabel,
  children,
}: {
  label: string
  accent: string
  substatus: 'live' | 'upcoming' | 'finished'
  count: number
  showSubLabel: boolean
  children: ReactNode
}) {
  return (
    <div data-substatus={substatus} style={{ padding: '6px 0' }}>
      {showSubLabel && (
        <div
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
              color: accent === MUTED ? MUTED : 'rgba(255,255,255,0.85)',
            }}
          >
            {label}
          </span>
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: MUTED,
              background: 'rgba(255,255,255,0.04)',
              padding: '1px 6px',
              clipPath: CHUNKY.badge,
            }}
          >
            {count}
          </span>
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
}: {
  match: GroupMatch
  status: 'live' | 'upcoming' | 'finished'
  locale: string
  userTz: string
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
      <DailyMatchCard
        match={matchAsFull}
        genderColor={genderColor}
        locale={locale}
        userTz={userTz}
      />
    </div>
  )
}

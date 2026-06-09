'use client'

import React, { useState, useEffect, useMemo, useRef } from 'react'
import Avatar from '@/components/Avatar'
import TournamentCoverImage from '@/components/TournamentCoverImage'
import { Link } from '@/i18n/navigation'
import { useFormatter, useTranslations } from 'next-intl'
import { DATE_SHORT } from '@/lib/format-patterns'
import { supabase } from '@/lib/supabase'
import {
  GREEN, GREEN_DIM, ORANGE, LIVE_RED, BG_BASE, BG_CARD, MUTED, BORDER, CHUNKY,
  MEN_BLUE, WOMEN_PURPLE,
  Tournament, FlagImg, titleCase, countryName, daysUntil, formatDateRange, levelLabel,
  SectionTitle, isHiddenLevel,
} from './shared'
import TournamentsFilterSheet, {
  DEFAULT_FILTERS, activeFilterCount,
  type TournamentFilters,
} from './TournamentsFilterSheet'

// ── Types ──────────────────────────────────────────────────────

type TournamentTab = 'premier' | 'fip'

const PREMIER_LEVELS = ['finals', 'major', 'p1', 'p2']
// Includes every FIP-tier code padelgod can stamp (see
// padelgod/src/lib/fip-categories.ts) plus the legacy 'fip_other' bucket
// for rows the backfill migration didn't touch.
const FIP_LEVELS = [
  'fip_platinum', 'fip_gold', 'fip_silver', 'fip_bronze',
  'fip_star', 'fip_rise', 'fip_promotion', 'fip_finals',
  'fip_promises', 'fip_beyond', 'fip_hexagon', 'fip_championship',
  'fip_other',
]

interface Winner {
  category: string
  player1_name: string | null
  player1_avatar: string | null
  player2_name: string | null
  player2_avatar: string | null
}

interface TournamentWithWinners extends Tournament {
  winners: Winner[]
}

function shortName(name: string | null): string {
  if (!name) return '\u2014'
  const parts = name.trim().split(/\s+/)
  if (parts.length <= 1) return name
  return parts[parts.length - 1]
}

// ── Collapsible Season ─────────────────────────────────────────

function CollapsibleSeasonV3({ year, tournaments }: { year: number; tournaments: TournamentWithWinners[] }) {
  const format = useFormatter()
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          width: '100%', padding: '14px 16px 10px',
          background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke={MUTED} strokeWidth="2.5" strokeLinecap="round"
          style={{ transition: 'transform 0.2s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          <polyline points="9 18 15 12 9 6"/>
        </svg>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED }}>
          {year} Season
        </span>
        <span style={{
          fontSize: 10, fontWeight: 600, color: MUTED,
          background: 'rgba(255,255,255,0.04)', clipPath: CHUNKY.badge, padding: '2px 8px',
        }}>
          {tournaments.length} events
        </span>
      </button>
      {open && (
        <div className="v3-scroll-hide" style={{
          display: 'flex', gap: 10, padding: '0 16px 12px', overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}>
          {tournaments.map(t => (
            <Link key={t.id} href={`/tournaments/${t.id}`} style={{ textDecoration: 'none', color: 'inherit', flexShrink: 0 }}>
              <div style={{
                minWidth: 200, clipPath: CHUNKY.card, padding: '12px 14px',
                background: BG_CARD, border: `1px solid ${BORDER}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <FlagImg country={t.country} size={18} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{titleCase(t.name)}</span>
                </div>
                <div style={{ fontSize: 10, color: MUTED }}>
                  {formatDateRange(format, t.starts_at, t.ends_at)}
                </div>
                {t.winners.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    {t.winners.map((w, i) => (
                      <div key={i} style={{ fontSize: 10, color: '#aaa', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <div style={{ width: 2, height: 10, background: w.category === 'men' ? MEN_BLUE : WOMEN_PURPLE, clipPath: CHUNKY.bar }} />
                        {shortName(w.player1_name)} / {shortName(w.player2_name)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

// Shared chunky-pill style used in BigTournamentCard for the level
// label. Pulled to module scope so it can be referenced from the
// extracted card component without re-declaring per render.
const pillStyle: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, padding: '3px 7px',
  clipPath: CHUNKY.badge, textTransform: 'uppercase',
  letterSpacing: 0.3,
}

// ── Tournaments View ──────────────────────────────────────────

interface TournamentsViewProps {
  /** Called when the user taps the back-arrow in the internal header.
   *  Ignored when `showInternalHeader` is false (no back-arrow rendered). */
  onBack: () => void
  /** When false, omit the internal back-arrow + "EVENTS" sub-header.
   *  Use this when the page wraps TournamentsView with the GlobalHeader
   *  to avoid stacking two headers. Defaults to true to preserve the
   *  legacy `/home?view=tournaments` callsite behaviour. */
  showInternalHeader?: boolean
}

export default function TournamentsView({
  onBack,
  showInternalHeader = true,
}: TournamentsViewProps) {
  const format = useFormatter()
  const tHome = useTranslations('home')
  const tTournament = useTranslations('tournament')
  const tList = useTranslations('home.tournamentList')
  const tTabs = useTranslations('home.tournamentTabs')
  const tTier = useTranslations('home.fipTier')
  const tWhenChip = useTranslations('home.filterSheet.whenChip')
  const tFilterSheet = useTranslations('home.filterSheet')
  const tCommon = useTranslations('common')
  const [tab, setTab] = useState<TournamentTab>('premier')
  const [tournaments, setTournaments] = useState<TournamentWithWinners[]>([])
  const [liveIds, setLiveIds] = useState<Set<string>>(new Set())
  const [ongoingIds, setOngoingIds] = useState<Set<string>>(new Set())
  // Explicit "tournament is done" set — populated when match data shows a
  // decided Final OR `ends_at` has passed with no live activity. Used by
  // the Completed filter so events transition out of Ongoing AND into
  // Completed in the same render, instead of falling through every bucket
  // until end-of-day midnight rolls past `ends_at`.
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  // ── FIP sub-tier (only meaningful when tab === 'fip')
  // Lets the user narrow the FIP Tour to a single tier (Platinum / Gold
  // / Silver / etc.) without leaving the main tab. Lives outside the
  // Filtros sheet because it's an axis of the tab — picking a sub-tier
  // changes WHICH levels we query, not what we filter the result set to.
  // 'all' = every FIP level (legacy behaviour, default).
  const [fipSubTier, setFipSubTier] = useState<'all' | string>('all')

  // ── Filter state ─────────────────────────────────────────────
  // Two layers:
  //   filters       — committed, drives the rendered sections.
  //   pendingInSheet — what the user is fiddling with inside the open
  //                    sheet, used to compute the live "Apply (N events)"
  //                    count without affecting the page yet.
  const [filters, setFilters] = useState<TournamentFilters>(DEFAULT_FILTERS)
  const [pendingInSheet, setPendingInSheet] = useState<TournamentFilters>(DEFAULT_FILTERS)
  const [sheetOpen, setSheetOpen] = useState(false)

  useEffect(() => {
    (async () => {
      setLoading(true)
      // Narrow the level set when the user picks a FIP sub-tier. 'all'
      // keeps the legacy "every FIP level" query.
      const levels =
        tab === 'premier'
          ? PREMIER_LEVELS
          : fipSubTier === 'all'
            ? FIP_LEVELS.filter((l) => !isHiddenLevel(l))
            : [fipSubTier]

      // Fetch all tournaments for this circuit
      const { data: tournamentsData } = await supabase
        .from('tournaments')
        .select('id, name, starts_at, ends_at, country, level, location, prize_money, logo_url, cover_image_url, status')
        .in('level', levels)
        .not('level', 'is', null)
        .order('starts_at', { ascending: false })
        .limit(500)

      if (!tournamentsData) { setLoading(false); return }

      const now = new Date()

      // Step 1: Determine truly live tournaments via match status.
      // Exclude tournaments already flagged finished/completed in the DB —
      // those have leftover `scheduled` qualifier rows from before the
      // event that the match-status sweep below would otherwise misread
      // as "ongoing." Brussels P2 2026 surfaced this bug: ends_at = Apr 26,
      // status = 'finished', but a handful of unplayed Q1 matches kept
      // the tournament in the "Ongoing" tile through Apr 27.
      const FINISHED_STATUSES = new Set(['finished', 'completed', 'ended'])
      const candidateLive = tournamentsData.filter(t => {
        if (t.status && FINISHED_STATUSES.has(t.status as string)) return false
        const start = new Date(t.starts_at)
        const end = new Date(t.ends_at); end.setDate(end.getDate() + 3)
        return start <= now && now <= end
      })

      const confirmedLiveIds = new Set<string>()
      const confirmedOngoingIds = new Set<string>()
      const confirmedDoneIds = new Set<string>()
      if (candidateLive.length > 0) {
        const { data: matchData } = await supabase
          .from('matches')
          .select('id, status, round, tournament:tournaments!inner(id)')
          .in('tournament.id', candidateLive.map(t => t.id))

        const byTournament: Record<string, any[]> = {}
        for (const m of (matchData ?? []) as any[]) {
          const tid = m.tournament?.id
          if (!tid) continue
          if (!byTournament[tid]) byTournament[tid] = []
          byTournament[tid].push(m)
        }

        const FINAL_LABELS = new Set(['final', 'finals', 'f'])
        const isFinalRound = (r: string | null | undefined) =>
          !!r && FINAL_LABELS.has(r.toLowerCase().trim())
        const TERMINAL_STATUSES = new Set(['finished', 'retired', 'walkover'])

        for (const t of candidateLive) {
          const matches = byTournament[t.id] ?? []
          const hasLive = matches.some((m: any) => m.status === 'live')
          if (hasLive) {
            confirmedLiveIds.add(t.id)
            continue
          }

          // If every Final-round match has a winner, the tournament is done —
          // even if there are leftover `scheduled` rows (orphan qualifiers,
          // bracket placeholders that were never played). Common because
          // upstream `tournaments.status` is often stale (`pending`, `live`,
          // or null) for hours/days after the actual Final wraps. Brussels P2
          // showed the same residue, but only on `t.status='finished'` rows;
          // FIP Bronze/Silver/Promises/Beyond rarely flip the flag at all.
          const finals = matches.filter((m: any) => isFinalRound(m.round))
          const allFinalsDecided =
            finals.length > 0 && finals.every((m: any) => TERMINAL_STATUSES.has(m.status))
          if (allFinalsDecided) {
            confirmedDoneIds.add(t.id)
            continue
          }

          // Past `ends_at` with no live match → done. The +3-day buffer in
          // `candidateLive` is for late results trickling in, not a license
          // to keep an event "ongoing" indefinitely. Smaller FIP tiers (Promises,
          // Beyond, Bronze) often ship 100% scheduled placeholders that we
          // never receive results for; without this guard they sit in Ongoing
          // forever.
          //
          // ends_at is UTC midnight of the final day, so compare to start-of-
          // today UTC rather than `now` — otherwise a tournament whose final
          // is being played at e.g. 19:00 UTC on its last day flips to "done"
          // 19 hours before the day actually ends.
          const startOfTodayUtc = new Date(now); startOfTodayUtc.setUTCHours(0, 0, 0, 0)
          const tournamentEnded = new Date(t.ends_at) < startOfTodayUtc
          if (tournamentEnded) {
            confirmedDoneIds.add(t.id)
            continue
          }

          // Still between sessions only when unplayed matches remain AND
          // we're inside the actual tournament window.
          const hasScheduled = matches.some((m: any) => m.status === 'scheduled')
          if (hasScheduled) confirmedOngoingIds.add(t.id)
        }
      }

      setLiveIds(confirmedLiveIds)
      setOngoingIds(confirmedOngoingIds)
      setDoneIds(confirmedDoneIds)

      // Step 2: Fetch winners for completed tournaments
      const completedIds = tournamentsData
        .filter(t => {
          if (confirmedLiveIds.has(t.id)) return false
          if (new Date(t.starts_at) > now) return false
          return true
        })
        .map(t => t.id)

      let winnersMap: Record<string, Winner[]> = {}
      if (completedIds.length > 0) {
        const { data: finals } = await supabase
          .from('matches')
          .select(`
            id, round, category, winner_pair, status,
            tournament:tournaments!inner(id),
            pair1_player1:players!matches_pair1_player1_id_fkey(name, display_name, avatar_url),
            pair1_player2:players!matches_pair1_player2_id_fkey(name, display_name, avatar_url),
            pair2_player1:players!matches_pair2_player1_id_fkey(name, display_name, avatar_url),
            pair2_player2:players!matches_pair2_player2_id_fkey(name, display_name, avatar_url)
          `)
          .in('tournament.id', completedIds)
          .in('round', ['Finals', 'Final', 'FINAL', 'finals', 'final', 'F'])
          .eq('status', 'finished')
          .not('winner_pair', 'is', null)

        for (const m of (finals ?? []) as any[]) {
          const tid = m.tournament?.id
          if (!tid) continue
          const isP1 = m.winner_pair === 1
          const w: Winner = {
            category: m.category ?? 'men',
            player1_name: isP1 ? (m.pair1_player1?.display_name ?? m.pair1_player1?.name) : (m.pair2_player1?.display_name ?? m.pair2_player1?.name),
            player1_avatar: isP1 ? m.pair1_player1?.avatar_url : m.pair2_player1?.avatar_url,
            player2_name: isP1 ? (m.pair1_player2?.display_name ?? m.pair1_player2?.name) : (m.pair2_player2?.display_name ?? m.pair2_player2?.name),
            player2_avatar: isP1 ? m.pair1_player2?.avatar_url : m.pair2_player2?.avatar_url,
          }
          if (!winnersMap[tid]) winnersMap[tid] = []
          winnersMap[tid].push(w)
        }
      }

      setTournaments(tournamentsData.map(t => ({ ...t, winners: winnersMap[t.id] ?? [] })))
      setLoading(false)
    })()
  }, [tab, fipSubTier])

  // ── Available countries (drives the sheet's país picker — only
  //    shows countries with at least one tournament in the loaded set).
  const availableCountries = useMemo(() => {
    const s = new Set<string>()
    for (const t of tournaments) {
      if (t.country) s.add(t.country.toUpperCase())
    }
    return s
  }, [tournaments])

  // ── Available years for the Temporada section. Always includes the
  //    current year so the radio set isn't empty in early-season state
  //    where the DB has no 2026 events yet. Sorted descending so the
  //    most recent year shows first.
  const availableYears = useMemo(() => {
    const ys = new Set<number>([new Date().getFullYear()])
    for (const t of tournaments) {
      const y = new Date(t.starts_at).getFullYear()
      if (Number.isFinite(y)) ys.add(y)
    }
    return [...ys].sort((a, b) => b - a)
  }, [tournaments])

  // ── Filter predicate: applies (year, countries, when) to a tournament.
  //    Status (live/ongoing/upcoming/completed) is decided elsewhere;
  //    here we just gate on the dimensions that survive year-narrowing.
  //    Estado is applied section-by-section below so empty sections
  //    render gracefully when the user toggles them off.
  const matchesNonStatus = (t: TournamentWithWinners, f: TournamentFilters): boolean => {
    // Year — always applied. Defaults to current year.
    const ty = new Date(t.starts_at).getFullYear()
    if (ty !== f.year) return false
    // Event-name type-ahead. Case-insensitive substring match on the
    // tournament's name. Trim avoids one-space false-zero results.
    const q = f.eventName.trim().toLowerCase()
    if (q.length > 0) {
      if (!t.name || !t.name.toLowerCase().includes(q)) return false
    }
    if (f.countries.size > 0) {
      if (!t.country || !f.countries.has(t.country.toUpperCase())) return false
    }
    if (f.when !== 'all') {
      const start = new Date(t.starts_at).getTime()
      const now = Date.now()
      if (f.when === 'this_month') {
        const d = new Date()
        const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
        const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() - 1
        if (start < monthStart || start > monthEnd) return false
      } else if (f.when === 'next_30') {
        const limit = now + 30 * 24 * 60 * 60 * 1000
        if (start < now || start > limit) return false
      } else if (f.when === 'next_90') {
        const limit = now + 90 * 24 * 60 * 60 * 1000
        if (start < now || start > limit) return false
      }
    }
    return true
  }

  const { live, ongoing, upcoming, currentSeasonCompleted, prevByYear, currentYear } = useMemo(() => {
    const now = new Date()
    // "currentYear" here means the year *displayed* to the user — driven
    // by the year filter rather than calendar `now`. The previous logic
    // hard-coded calendar year, which broke the "view past seasons"
    // workflow once the year filter shipped (the user would pick 2025
    // but the page kept the "Completed — 2026" header etc).
    const currentYear = filters.year

    // Apply year + country + when filters first; then bucket by status.
    const visible = tournaments.filter(t => matchesNonStatus(t, filters))

    const live = filters.estado.live
      ? visible.filter(t => liveIds.has(t.id))
      : []
    const ongoing = filters.estado.live
      ? visible.filter(t => ongoingIds.has(t.id))
      : []
    const upcoming = filters.estado.upcoming
      ? visible.filter(t => new Date(t.starts_at) > now && !liveIds.has(t.id) && !ongoingIds.has(t.id))
          .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
      : []
    const completed = filters.estado.completed
      ? visible.filter(t => {
          // Tournaments explicitly classified as done by the data fetch
          // (decided Final OR ends_at past with no live match) → completed
          // immediately, regardless of clock relative to ends_at midnight.
          if (doneIds.has(t.id)) return true
          // Fallback for tournaments outside the +3-day candidate window
          // that the live-detection loop never inspected — clock-based.
          const end = new Date(t.ends_at); end.setHours(23, 59, 59)
          return end < now && !liveIds.has(t.id) && !ongoingIds.has(t.id)
        })
      : []
    // With matchesNonStatus already gating by year, every completed item
    // belongs to the displayed year — currentSeasonCompleted is the full
    // set, and prevByYear is always empty. The collapsible-past-seasons
    // UI below renders nothing in this state, which is exactly what we
    // want: picking 2025 should show the 2025 season, not also collapse
    // 2024 underneath.
    const currentSeasonCompleted = completed
    const prevByYear: Record<number, TournamentWithWinners[]> = {}
    return { live, ongoing, upcoming, currentSeasonCompleted, prevByYear, currentYear }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournaments, liveIds, ongoingIds, doneIds, filters])

  // ── Pending-state count (for the "Aplicar (N eventos)" button).
  const pendingCount = useMemo(() => {
    const visible = tournaments.filter(t => matchesNonStatus(t, pendingInSheet))
    let n = 0
    if (pendingInSheet.estado.live) {
      n += visible.filter(t => liveIds.has(t.id)).length
      n += visible.filter(t => ongoingIds.has(t.id)).length
    }
    if (pendingInSheet.estado.upcoming) {
      const now = new Date()
      n += visible.filter(t => new Date(t.starts_at) > now && !liveIds.has(t.id) && !ongoingIds.has(t.id)).length
    }
    if (pendingInSheet.estado.completed) {
      const now = new Date()
      n += visible.filter(t => {
        if (doneIds.has(t.id)) return true
        const end = new Date(t.ends_at); end.setHours(23, 59, 59)
        return end < now && !liveIds.has(t.id) && !ongoingIds.has(t.id)
      }).length
    }
    return n
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournaments, liveIds, ongoingIds, doneIds, pendingInSheet])

  const filterCount = activeFilterCount(filters)

  // Hero picks the closest-by-date event in each bucket. Matches the
  // home page's spotlight logic (`tournaments[0]` after sort-by-starts_at).
  // Without this, an end-of-season "Finals" event 8 months away would
  // outrank every P1/P2 in the next few weeks just because its tier is
  // higher (Barcelona Finals 2026 surfaced this on 2026-04-27).
  const pickByDate = (list: TournamentWithWinners[]) =>
    [...list].sort(
      (a, b) =>
        new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
    )[0] ?? null
  const heroUpcoming = pickByDate(upcoming)
  // Upcoming gets a big hero only when nothing is live and nothing is
  // ongoing — otherwise live/ongoing already fill that visual slot and
  // every upcoming event belongs in the compact strip below.
  const showUpcomingHero = live.length === 0 && ongoing.length === 0 && !!heroUpcoming
  const restUpcoming = upcoming.filter(t => t.id !== (showUpcomingHero ? heroUpcoming?.id : undefined))

  return (
    <div>
      {/* Back header — only when not wrapped by GlobalHeader. */}
      {showInternalHeader && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '16px', position: 'sticky', top: 0, zIndex: 100,
          background: 'rgba(10,10,10,0.95)', backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}>
          <button onClick={() => { onBack(); window.scrollTo(0, 0) }} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 4,
            display: 'flex', alignItems: 'center',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span style={{ fontSize: 15, fontWeight: 800, color: '#fff', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {tTournament('events')}
          </span>
        </div>
      )}

      {/* Tab switcher — left-aligned. Top padding gives the row room to
          breathe under the GlobalHeader; the legacy back-arrow header
          (when showInternalHeader=true) supplies its own bottom padding,
          so no double-spacing in that mode. */}
      <div style={{ display: 'flex', gap: 8, padding: showInternalHeader ? '0 16px 10px' : '14px 16px 10px' }}>
        {(['premier', 'fip'] as TournamentTab[]).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: tab === t ? GREEN : 'rgba(255,255,255,0.06)',
            color: tab === t ? '#000' : MUTED,
            border: 'none', cursor: 'pointer',
            padding: '8px 24px', fontWeight: 800, fontSize: 12,
            clipPath: CHUNKY.badge, textTransform: 'uppercase',
            letterSpacing: 0.5,
            fontFamily: 'inherit',
          }}>
            {t === 'premier' ? tTabs('premier') : tTabs('fip')}
          </button>
        ))}
      </div>

      {/* FIP sub-tier chips — only when FIP Tour is active.
          Smaller than the main tabs; chunky for visual consistency.
          Default chip "Todas" returns to the all-FIP-levels query. */}
      {tab === 'fip' && (
        <div
          className="v3-scroll-hide"
          style={{
            display: 'flex', gap: 6, padding: '0 16px 10px',
            overflowX: 'auto', WebkitOverflowScrolling: 'touch',
          }}
        >
          {([
            { value: 'all', label: tTier('all') },
            { value: 'fip_platinum', label: tTier('platinum') },
            { value: 'fip_gold', label: tTier('gold') },
            { value: 'fip_silver', label: tTier('silver') },
            { value: 'fip_bronze', label: tTier('bronze') },
            { value: 'fip_beyond', label: tTier('beyond') },
            { value: 'fip_promises', label: tTier('promises') },
          ] as Array<{ value: 'all' | string; label: string }>)
            .filter(({ value }) => !isHiddenLevel(value))
            .map(({ value, label }) => {
            const active = fipSubTier === value
            return (
              <button
                key={value}
                type="button"
                onClick={() => setFipSubTier(value)}
                style={{
                  flexShrink: 0,
                  padding: '5px 12px',
                  background: active ? GREEN : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${active ? GREEN : BORDER}`,
                  color: active ? '#0A0A0A' : '#B5B5B5',
                  fontSize: 10, fontWeight: active ? 800 : 700,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  clipPath: CHUNKY.badge,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {label}
              </button>
            )
          })}
        </div>
      )}

      {/* Filtros button + active-filter strip ──────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px 6px', gap: 10,
      }}>
        <button
          type="button"
          onClick={() => { setPendingInSheet(filters); setSheetOpen(true) }}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: '7px 16px',
            background: filterCount > 0 ? 'rgba(126,211,33,0.08)' : BG_CARD,
            border: `1px solid ${filterCount > 0 ? GREEN : BORDER}`,
            color: filterCount > 0 ? GREEN : MUTED,
            fontSize: 11, fontWeight: 700,
            letterSpacing: '0.02em',
            clipPath: CHUNKY.button,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
          {tHome('filtersButton')}
          {filterCount > 0 && (
            <span style={{
              background: GREEN, color: '#0A0A0A',
              fontFamily: 'var(--font-mono, "SF Mono", monospace)',
              fontSize: 9, fontWeight: 800,
              padding: '1px 7px',
              clipPath: CHUNKY.badge,
              marginLeft: 2,
            }}>
              {filterCount}
            </span>
          )}
        </button>
        <span style={{
          fontFamily: 'var(--font-mono, "SF Mono", monospace)',
          fontSize: 10, color: MUTED, letterSpacing: '0.04em',
        }}>
          {(() => {
            const prevTotal = Object.values(prevByYear).reduce((s, arr) => s + arr.length, 0)
            const total = live.length + ongoing.length + upcoming.length + currentSeasonCompleted.length + prevTotal
            return tHome('eventsCount', { count: total })
          })()}
        </span>
      </div>

      {/* Active filter pills — only when something is applied */}
      {filterCount > 0 && (
        <div style={{
          display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center',
          padding: '4px 16px 12px',
        }}>
          {filters.year !== new Date().getFullYear() && (
            <ActiveFilterPill
              label={`📅 ${filters.year}`}
              onRemove={() => setFilters(prev => ({ ...prev, year: new Date().getFullYear() }))}
            />
          )}
          {filters.eventName.trim().length > 0 && (
            <ActiveFilterPill
              label={`🔎 "${filters.eventName.trim()}"`}
              onRemove={() => setFilters(prev => ({ ...prev, eventName: '' }))}
            />
          )}
          {[...filters.countries].map(code => (
            <ActiveFilterPill
              key={`c-${code}`}
              label={`🌍 ${code}`}
              onRemove={() => setFilters(prev => {
                const next = new Set(prev.countries); next.delete(code)
                return { ...prev, countries: next }
              })}
            />
          ))}
          {filters.when !== 'all' && (
            <ActiveFilterPill
              label={
                filters.when === 'this_month' ? `🗓 ${tWhenChip('thisMonth')}`
                  : filters.when === 'next_30' ? `🗓 ${tWhenChip('next30')}`
                  : `🗓 ${tWhenChip('next90')}`
              }
              onRemove={() => setFilters(prev => ({ ...prev, when: 'all' }))}
            />
          )}
          {(!filters.estado.live || !filters.estado.upcoming || !filters.estado.completed) && (
            <ActiveFilterPill
              label={`🏆 ${tFilterSheet('statusFilterLabel')}`}
              onRemove={() => setFilters(prev => ({
                ...prev, estado: { live: true, upcoming: true, completed: true },
              }))}
            />
          )}
          <button
            type="button"
            onClick={() => setFilters(DEFAULT_FILTERS)}
            style={{
              fontFamily: 'var(--font-mono, "SF Mono", monospace)',
              fontSize: 10, fontWeight: 700,
              letterSpacing: '0.06em',
              color: MUTED,
              textTransform: 'uppercase',
              background: 'none', border: 'none',
              cursor: 'pointer', padding: '4px 8px',
              marginLeft: 'auto',
            }}
          >
            {tCommon('clear')}
          </button>
        </div>
      )}

      {loading ? (
        <TournamentsViewSkeleton />
      ) : (
        <>
          {/* ── Live / Ongoing / Upcoming sections ────────────
              Each bucket renders independently so concurrently active
              tournaments (e.g. one in finals, another mid-week) both
              stay visible. One event in a bucket → big hero card.
              Two or more → full-width scroll-snap carousel that
              auto-advances every 5s. */}
          {live.length === 1 && (
            <>
              <SectionTitle>{tHome('liveNow')}</SectionTitle>
              <BigTournamentCard tournament={live[0]} state="live" />
            </>
          )}
          {live.length >= 2 && (
            <>
              <SectionTitle>{tHome('liveNow')}</SectionTitle>
              {/* Order by ends_at asc so the tournament closest to finishing
                  (often the one playing the final today) leads the carousel. */}
              <OngoingCarousel
                tournaments={[...live].sort((a, b) => new Date(a.ends_at).getTime() - new Date(b.ends_at).getTime())}
                state="live"
              />
            </>
          )}
          {ongoing.length === 1 && (
            <>
              <SectionTitle>{tHome('ongoing')}</SectionTitle>
              <BigTournamentCard tournament={ongoing[0]} state="ongoing" />
            </>
          )}
          {ongoing.length >= 2 && (
            <>
              <SectionTitle>{tHome('ongoing')}</SectionTitle>
              <OngoingCarousel tournaments={ongoing} />
            </>
          )}
          {showUpcomingHero && heroUpcoming && (
            <>
              <SectionTitle>{tHome('comingUp')}</SectionTitle>
              <BigTournamentCard tournament={heroUpcoming} state="upcoming" />
            </>
          )}

          {/* Remaining upcoming — compact horizontal strip. Rendered
              after the hero or carousel above. Hidden when nothing
              upcoming (or when the hero IS the only upcoming). */}
          {restUpcoming.length > 0 && (
            <div className="v3-scroll-hide" style={{
              display: 'flex', gap: 8, padding: '0 16px 8px', overflowX: 'auto',
              WebkitOverflowScrolling: 'touch',
            }}>
              {restUpcoming.map(t => {
                const d = daysUntil(t.starts_at)
                const dateLabel = format.dateTime(new Date(t.starts_at), DATE_SHORT).toUpperCase()
                return (
                  <Link key={t.id} href={`/tournaments/${t.id}`} style={{ textDecoration: 'none', color: 'inherit', flexShrink: 0 }}>
                    <div style={{
                      padding: '10px 14px', clipPath: CHUNKY.card,
                      background: BG_CARD, border: `1px solid ${BORDER}`,
                      minWidth: 160,
                    }}>
                      <div style={{ fontSize: 9, color: MUTED, fontWeight: 600, marginBottom: 4 }}>
                        {dateLabel}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <FlagImg country={t.country} size={16} />
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' }}>
                          {titleCase(t.name)}
                        </span>
                      </div>
                      <div style={{ fontSize: 10, color: ORANGE, marginTop: 4, fontWeight: 700 }}>
                        {tList('daysCount', { count: d })}
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}

          {/* ── Completed (current season) — vertical list grouped by
              month, each month collapsible. The most-recent month is
              expanded by default; older months collapse to a thin row
              showing the month name + event count + chevron. Now that
              there can be 30+ completed events per season, this lets
              users skim months without scrolling forever. */}
          {currentSeasonCompleted.length > 0 && (
            <>
              <SectionTitle>{tList('completedYear', { year: currentYear })}</SectionTitle>
              <CompletedMonthList tournaments={currentSeasonCompleted} format={format} />
            </>
          )}

          {/* ── Previous Seasons — collapsible ── */}
          {Object.entries(prevByYear)
            .sort(([a], [b]) => Number(b) - Number(a))
            .map(([year, items]) => (
              <CollapsibleSeasonV3 key={year} year={Number(year)} tournaments={items} />
            ))
          }
        </>
      )}

      {/* Bottom spacing */}
      <div style={{ height: 100 }} />

      {/* Filters sheet — rendered last so it overlays everything */}
      <TournamentsFilterSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        availableCountries={availableCountries}
        availableYears={availableYears}
        current={filters}
        pendingCount={pendingCount}
        onPendingChange={setPendingInSheet}
        onApply={(next) => {
          setFilters({ ...next, countries: new Set(next.countries) })
          setSheetOpen(false)
        }}
        onClear={() => {
          setPendingInSheet(DEFAULT_FILTERS)
        }}
      />
    </div>
  )
}

// ── Completed-tournaments list grouped by month with collapsible
//    sections. Most-recent month expanded by default; older months
//    collapse to a thin row showing month name + event count.
function CompletedMonthList({
  tournaments,
  format,
}: {
  tournaments: TournamentWithWinners[]
  format: ReturnType<typeof useFormatter>
}) {
  const tHome = useTranslations('home')
  // Group by ends_at month — a tournament running Mar 30 → Apr 5
  // belongs in April. Memo'd because tournaments + winners are stable
  // between filter changes; only the open-state needs to re-render.
  const { orderedKeys, byMonth } = useMemo(() => {
    const m = new Map<string, TournamentWithWinners[]>()
    for (const t of tournaments) {
      const d = new Date(t.ends_at)
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`
      const arr = m.get(key) ?? []
      arr.push(t)
      m.set(key, arr)
    }
    // Most-recent month first; within month, newest end first.
    const keys = [...m.keys()].sort((a, b) => (a < b ? 1 : -1))
    for (const k of keys) {
      m.get(k)!.sort(
        (a, b) => new Date(b.ends_at).getTime() - new Date(a.ends_at).getTime(),
      )
    }
    return { orderedKeys: keys, byMonth: m }
  }, [tournaments])

  // Default expanded state: only the most-recent month. Persists as the
  // user toggles. When the list shape changes (filter applied), reset
  // to the new "most recent" — the previous open key may no longer
  // exist (e.g., user switched from 2026 to 2025).
  const firstKey = orderedKeys[0]
  const [openKeys, setOpenKeys] = useState<Set<string>>(
    () => new Set(firstKey ? [firstKey] : []),
  )
  useEffect(() => {
    setOpenKeys(prev => {
      // Drop any open keys that no longer exist in the data, and ensure
      // the new most-recent month is open if no key is open.
      const stillValid = [...prev].filter(k => byMonth.has(k))
      if (stillValid.length === 0 && firstKey) return new Set([firstKey])
      return new Set(stillValid)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstKey, orderedKeys.join(',')])

  const toggle = (k: string) =>
    setOpenKeys(prev => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })

  return (
    <>
      {orderedKeys.map(key => {
        const items = byMonth.get(key)!
        const open = openKeys.has(key)
        const monthDate = new Date(items[0].ends_at)
        return (
          <div key={key} style={{ marginBottom: 8 }}>
            <button
              type="button"
              onClick={() => toggle(key)}
              style={{
                width: '100%',
                padding: '14px 16px 8px',
                display: 'flex', alignItems: 'center',
                justifyContent: 'space-between',
                background: 'none', border: 'none',
                cursor: 'pointer',
                fontFamily: 'inherit', textAlign: 'left',
              }}
              aria-expanded={open}
            >
              <span style={{
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{
                  fontSize: 11, fontWeight: 800,
                  letterSpacing: '0.14em', textTransform: 'uppercase',
                  color: '#fff',
                }}>
                  {format.dateTime(monthDate, { month: 'long' })}
                </span>
                <span style={{
                  fontFamily: 'var(--font-mono, "SF Mono", monospace)',
                  fontSize: 10, color: MUTED, letterSpacing: '0.06em',
                }}>
                  {tHome('eventsCount', { count: items.length })}
                </span>
              </span>
              <span style={{
                color: MUTED, fontSize: 14,
                transition: 'transform 0.2s',
                display: 'inline-flex',
                transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
              }}>
                ▸
              </span>
            </button>

            {open && items.map(t => {
              const menW = t.winners.find(w => w.category === 'men')
              const womenW = t.winners.find(w => w.category === 'women')
              const hasChampions = !!(menW || womenW)
              return (
                <Link
                  key={t.id}
                  href={`/tournaments/${t.id}`}
                  style={{
                    textDecoration: 'none', color: 'inherit',
                    display: 'block',
                    margin: '0 16px 8px',
                  }}
                >
                  <div style={{
                    clipPath: CHUNKY.card,
                    background: BG_CARD, border: `1px solid ${BORDER}`,
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      padding: '12px 14px',
                      display: 'flex', alignItems: 'center',
                      justifyContent: 'space-between',
                      borderBottom: hasChampions ? `1px solid ${BORDER}` : 'none',
                      gap: 10,
                    }}>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        minWidth: 0, flex: 1,
                      }}>
                        <FlagImg country={t.country} size={22} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{
                            fontSize: 13, fontWeight: 700, color: '#fff',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>
                            {titleCase(t.name)}
                          </div>
                          <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>
                            {formatDateRange(format, t.starts_at, t.ends_at)}
                          </div>
                        </div>
                      </div>
                      {t.level && (
                        <span style={{
                          fontSize: 9, fontWeight: 700,
                          padding: '3px 7px',
                          clipPath: CHUNKY.badge,
                          textTransform: 'uppercase',
                          letterSpacing: 0.3,
                          flexShrink: 0,
                          background: 'rgba(255,255,255,0.06)',
                          color: MUTED,
                        }}>
                          {levelLabel(t.level)}
                        </span>
                      )}
                    </div>

                    {hasChampions && (
                      <div style={{
                        padding: '10px 14px',
                        display: 'flex', flexDirection: 'column', gap: 6,
                      }}>
                        {menW && (
                          <ChampionLine
                            colorBar={MEN_BLUE}
                            avatar1={menW.player1_avatar}
                            avatar2={menW.player2_avatar}
                            name1={menW.player1_name}
                            name2={menW.player2_name}
                          />
                        )}
                        {womenW && (
                          <ChampionLine
                            colorBar={WOMEN_PURPLE}
                            avatar1={womenW.player1_avatar}
                            avatar2={womenW.player2_avatar}
                            name1={womenW.player1_name}
                            name2={womenW.player2_name}
                          />
                        )}
                      </div>
                    )}
                  </div>
                </Link>
              )
            })}
          </div>
        )
      })}
    </>
  )
}

// ── Champion line for the completed-month list. One row = one
//    gender's pair (men or women). Coloured side-bar + avatars +
//    short names. Kept tiny — used inside the full-width completed
//    cards, no border or background of its own.
function ChampionLine({
  colorBar, avatar1, avatar2, name1, name2,
}: {
  colorBar: string
  avatar1: string | null
  avatar2: string | null
  name1: string | null
  name2: string | null
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        width: 3, height: 22, background: colorBar,
        flexShrink: 0, clipPath: CHUNKY.bar,
      }} />
      <div style={{ display: 'flex', flexShrink: 0, marginRight: 2 }}>
        {avatar1 && (
          <Avatar src={avatar1} alt="" size={22} style={{
            border: `1.5px solid ${BG_BASE}`, background: BG_CARD,
          }} />
        )}
        {avatar2 && (
          <Avatar src={avatar2} alt="" size={22} style={{
            border: `1.5px solid ${BG_BASE}`, background: BG_CARD,
            marginLeft: -6,
          }} />
        )}
      </div>
      <span style={{ fontSize: 11, color: '#fff', fontWeight: 600 }}>
        {shortName(name1)} / {shortName(name2)}
      </span>
    </div>
  )
}

// ── Active-filter pill (small removable chip above the list) ───
function ActiveFilterPill({ label, onRemove }: { label: string; onRemove: () => void }) {
  const tList = useTranslations('home.tournamentList')
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 12px',
      background: 'rgba(126,211,33,0.08)',
      border: `1px solid ${GREEN}`,
      color: GREEN,
      fontSize: 11, fontWeight: 700,
      clipPath: CHUNKY.badge,
    }}>
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={tList('removeFilter', { label })}
        style={{
          background: 'none', border: 'none',
          color: GREEN, opacity: 0.7,
          fontWeight: 800, cursor: 'pointer',
          marginLeft: 2, padding: 0,
          fontFamily: 'inherit', fontSize: 11,
        }}
      >
        ✕
      </button>
    </span>
  )
}

// ── Big tournament hero card ───────────────────────────────────
//
// The full-width "marquee" card used at the top of the listing for
// whichever tournament is currently leading the section (live, ongoing,
// or upcoming). Lifted out of the inline JSX so the OngoingCarousel
// below can reuse it for each tournament when there are several
// concurrent ongoing events.
//
// Visual treatment cycles by `state`:
//   live     → red glow + pulsing dot, "VIEW MATCHES" CTA
//   ongoing  → orange glow, "VIEW" CTA
//   upcoming → green glow + days-until countdown, "VIEW" CTA
function BigTournamentCard({
  tournament,
  state,
}: {
  tournament: TournamentWithWinners
  state: 'live' | 'ongoing' | 'upcoming'
}) {
  const format = useFormatter()
  const tHome = useTranslations('home')
  const tList = useTranslations('home.tournamentList')
  const isLive = state === 'live'
  const isOngoing = state === 'ongoing'
  const isUpcoming = !isLive && !isOngoing
  const hasCover = Boolean(tournament.cover_image_url)
  const stateColor = isLive ? LIVE_RED : isOngoing ? ORANGE : GREEN
  const stateTint = isLive ? 'rgba(255,70,85,0.15)' : isOngoing ? 'rgba(245,166,35,0.15)' : GREEN_DIM
  const stateGlow = isLive ? 'rgba(255,70,85,0.4)' : isOngoing ? 'rgba(245,166,35,0.4)' : 'rgba(126,211,33,0.4)'

  return (
    <Link href={`/tournaments/${tournament.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div style={{
        margin: '0 16px 12px', padding: 18, position: 'relative', overflow: 'hidden',
        aspectRatio: '360 / 260', display: 'flex', flexDirection: 'column',
        clipPath: CHUNKY.card,
        background: `linear-gradient(135deg, ${isLive ? 'rgba(255,70,85,0.10)' : isOngoing ? 'rgba(245,166,35,0.08)' : 'rgba(126,211,33,0.06)'} 0%, ${BG_CARD} 60%)`,
        border: `1.5px solid ${isLive ? 'rgba(255,70,85,0.25)' : isOngoing ? 'rgba(245,166,35,0.2)' : 'rgba(126,211,33,0.2)'}`,
      }}>
        {/* Cover image + legibility scrims */}
        {tournament.cover_image_url && (
          <>
            <TournamentCoverImage
              src={tournament.cover_image_url}
              alt={tournament.name}
              variant="hero"
              sizes="(max-width: 480px) 100vw, 480px"
            />
            {/* top band keeps the status pill / countdown legible */}
            <div aria-hidden style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: 64, zIndex: 1,
              background: 'linear-gradient(180deg, rgba(8,9,6,0.55) 0%, rgba(8,9,6,0) 100%)',
            }} />
            {/* bottom-up scrim keeps the content block legible */}
            <div aria-hidden style={{
              position: 'absolute', inset: 0, zIndex: 1,
              background: 'linear-gradient(0deg, rgba(8,9,6,0.94) 0%, rgba(8,9,6,0.82) 16%, rgba(8,9,6,0.45) 38%, rgba(8,9,6,0.08) 60%, rgba(8,9,6,0) 78%)',
            }} />
          </>
        )}

        {/* Decorative corner glow */}
        <div aria-hidden style={{
          position: 'absolute', top: -30, right: -30, width: 100, height: 100, zIndex: 2, pointerEvents: 'none',
          background: isLive
            ? 'radial-gradient(circle, rgba(255,70,85,0.08) 0%, transparent 70%)'
            : isOngoing
              ? 'radial-gradient(circle, rgba(245,166,35,0.06) 0%, transparent 70%)'
              : 'radial-gradient(circle, rgba(126,211,33,0.06) 0%, transparent 70%)',
        }} />

        {/* Status pill — top-left */}
        <div style={{
          position: 'absolute', top: 14, left: 14, zIndex: 2,
          display: 'inline-flex', alignItems: 'center', gap: 5,
          clipPath: CHUNKY.badge, padding: '5px 10px', fontSize: 9, fontWeight: 800,
          letterSpacing: '0.08em', textTransform: 'uppercase',
          background: hasCover ? stateColor : stateTint,
          color: hasCover ? '#fff' : stateColor,
          boxShadow: hasCover ? `0 2px 8px ${stateGlow}` : 'none',
        }}>
          {isLive && (
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: hasCover ? '#fff' : LIVE_RED, animation: 'v3-pulse 2s infinite',
            }} />
          )}
          {isLive ? tHome('liveNow') : isOngoing ? tHome('ongoing') : tHome('comingUp')}
        </div>

        {/* Countdown badge — top-right, upcoming only (both variants) */}
        {isUpcoming && (
          <div style={{
            position: 'absolute', top: 12, right: 12, zIndex: 3,
            background: '#BCE83B', color: '#0a0a0a', padding: '5px 10px',
            borderRadius: 8, textAlign: 'center', fontWeight: 800,
          }}>
            <div style={{ fontSize: 18, lineHeight: 1 }}>{daysUntil(tournament.starts_at)}</div>
            <div style={{ fontSize: 8, letterSpacing: '0.08em' }}>{tList('daysLabel')}</div>
          </div>
        )}

        {/* Bottom-anchored content stack */}
        <div style={{ position: 'relative', zIndex: 2, marginTop: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <FlagImg country={tournament.country} size={22} />
            <span style={{
              fontSize: 22, fontWeight: 900, color: '#fff', lineHeight: 1.05, letterSpacing: '-0.01em',
              textShadow: hasCover ? '0 2px 12px rgba(0,0,0,0.7)' : 'none',
            }}>
              {titleCase(tournament.name)}
            </span>
          </div>
          <div style={{
            fontSize: 12, fontWeight: 600,
            color: hasCover ? '#e6e8ea' : MUTED,
            textShadow: hasCover ? '0 1px 6px rgba(0,0,0,0.8)' : 'none',
          }}>
            {formatDateRange(format, tournament.starts_at, tournament.ends_at)}
            {tournament.location ? ` · ${tournament.location}` : ''}
          </div>

          {/* Level pill + view CTA */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 13 }}>
            <span style={{
              ...pillStyle,
              background: hasCover ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)',
              color: hasCover ? '#fff' : MUTED,
              backdropFilter: hasCover ? 'blur(4px)' : undefined,
            }}>
              {levelLabel(tournament.level)}
            </span>
            <div style={{ flex: 1 }} />
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '7px 15px', clipPath: CHUNKY.badge,
              background: isLive
                ? (hasCover ? LIVE_RED : 'rgba(255,70,85,0.12)')
                : (hasCover ? '#BCE83B' : GREEN_DIM),
              fontSize: 11, fontWeight: 800,
              color: isLive ? (hasCover ? '#fff' : LIVE_RED) : (hasCover ? '#0a0a0a' : GREEN),
            }}>
              {isLive ? tList('viewMatches') : tList('viewEvent')}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
          </div>
        </div>
      </div>
    </Link>
  )
}

// ── Ongoing carousel ───────────────────────────────────────────
//
// When two or more tournaments are concurrently ongoing, render them
// all at the same big-card size in a horizontal scroll-snap track
// instead of buryng the rest behind a single hero plus compact strip.
// Auto-advances every 5 seconds; pauses for 10 seconds after any user
// interaction (touch, mousedown, manual scroll) so the carousel
// doesn't yank the page out from under someone reading a card.
//
// Card width is 100% of the carousel viewport so each ongoing card
// gets full presence; users see the next card by swiping or waiting
// for the auto-advance to roll forward. Scroll-snap mandatory keeps
// finger swipes locked to whole-card increments.
function OngoingCarousel({ tournaments, state = 'ongoing' }: { tournaments: TournamentWithWinners[]; state?: 'live' | 'ongoing' }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [activeIdx, setActiveIdx] = useState(0)
  const pauseUntilRef = useRef(0)
  // Set when the auto-advance effect calls scrollTo so the resulting
  // scroll event doesn't bounce back into a "user interacted" pause.
  const programmaticScrollRef = useRef(false)

  const pause = (ms = 10_000) => {
    pauseUntilRef.current = Date.now() + ms
  }

  // Auto-advance every 5s
  useEffect(() => {
    if (tournaments.length < 2) return
    const tick = setInterval(() => {
      if (Date.now() < pauseUntilRef.current) return
      setActiveIdx((i) => (i + 1) % tournaments.length)
    }, 5000)
    return () => clearInterval(tick)
  }, [tournaments.length])

  // When activeIdx changes (auto-advance), scroll-snap to that card.
  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const target = track.children[activeIdx] as HTMLElement | undefined
    if (!target) return
    const left = target.offsetLeft - track.offsetLeft
    programmaticScrollRef.current = true
    track.scrollTo({ left, behavior: 'smooth' })
    // Smooth scroll fires multiple scroll events as it animates — drop
    // the programmatic flag a beat later so a real user scroll right
    // afterwards still pauses correctly.
    const t = setTimeout(() => {
      programmaticScrollRef.current = false
    }, 600)
    return () => clearTimeout(t)
  }, [activeIdx])

  // Track which card is centred when the user scrolls manually so the
  // dot indicator stays in sync.
  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    let raf = 0
    const onScroll = () => {
      // Skip centre-detection while we're driving a programmatic
      // scroll. Otherwise the smooth-scroll animation fires scroll
      // events partway through which would reset activeIdx to whatever
      // card is currently centred (often the previous one), bouncing
      // the carousel back instead of letting it complete the advance.
      if (programmaticScrollRef.current) return
      // User-driven scroll — pause the auto-advance.
      pause()
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const trackRect = track.getBoundingClientRect()
        const trackCentre = trackRect.left + trackRect.width / 2
        let best = 0
        let bestDist = Infinity
        for (let i = 0; i < track.children.length; i++) {
          const c = track.children[i] as HTMLElement
          const r = c.getBoundingClientRect()
          const d = Math.abs(r.left + r.width / 2 - trackCentre)
          if (d < bestDist) { bestDist = d; best = i }
        }
        setActiveIdx(best)
      })
    }
    track.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      track.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [tournaments.length])

  return (
    <div ref={containerRef}>
      <div
        ref={trackRef}
        className="v3-scroll-hide"
        onTouchStart={() => pause()}
        onMouseDown={() => pause()}
        style={{
          display: 'flex',
          overflowX: 'auto',
          scrollSnapType: 'x mandatory',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {tournaments.map((t) => (
          <div
            key={t.id}
            style={{
              flex: '0 0 100%',
              scrollSnapAlign: 'start',
              minWidth: 0,
            }}
          >
            <BigTournamentCard tournament={t} state={state} />
          </div>
        ))}
      </div>
      {/* Dots */}
      <div style={{
        display: 'flex', gap: 6, justifyContent: 'center',
        padding: '2px 0 12px',
      }}>
        {tournaments.map((t, i) => (
          <span
            key={t.id}
            aria-hidden
            style={{
              width: i === activeIdx ? 18 : 6,
              height: 6,
              borderRadius: 3,
              background: i === activeIdx ? ORANGE : 'rgba(255,255,255,0.18)',
              transition: 'width 0.25s ease, background 0.25s ease',
            }}
          />
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Loading skeleton — mirrors the structure rendered when data lands:
// hero card on top, horizontal upcoming-strip below, a couple of
// completed-list rows. Replaces the previous blue spinner so the
// loading state previews the layout instead of just signalling "wait".
// Uses the global `.skeleton-line` shimmer class from globals.css.
// ─────────────────────────────────────────────────────────────────────

function TournamentsViewSkeleton() {
  return (
    <div style={{ padding: '8px 16px 16px' }}>
      {/* Section title placeholder */}
      <span
        className="skeleton-line"
        style={{ width: 110, height: 12, display: 'inline-block', marginBottom: 10 }}
        aria-hidden
      >
        .
      </span>

      {/* Hero card — large primary tournament block */}
      <div
        style={{
          background: BG_CARD,
          border: `1px solid ${BORDER}`,
          clipPath: CHUNKY.card,
          padding: 16,
          marginBottom: 16,
          minHeight: 140,
        }}
      >
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span
            className="skeleton-line"
            style={{ width: 44, height: 44, display: 'inline-block', borderRadius: 6 }}
            aria-hidden
          >
            .
          </span>
          <div style={{ flex: 1 }}>
            <span
              className="skeleton-line"
              style={{ width: '70%', height: 16, display: 'inline-block', marginBottom: 8 }}
              aria-hidden
            >
              .
            </span>
            <br />
            <span
              className="skeleton-line"
              style={{ width: '45%', height: 12, display: 'inline-block' }}
              aria-hidden
            >
              .
            </span>
          </div>
        </div>
        <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
          <span
            className="skeleton-line"
            style={{ width: 60, height: 22, display: 'inline-block' }}
            aria-hidden
          >
            .
          </span>
          <span
            className="skeleton-line"
            style={{ width: 80, height: 22, display: 'inline-block' }}
            aria-hidden
          >
            .
          </span>
        </div>
      </div>

      {/* Upcoming strip — small horizontal cards */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, overflow: 'hidden' }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              padding: '10px 14px',
              background: BG_CARD,
              border: `1px solid ${BORDER}`,
              clipPath: CHUNKY.card,
              minWidth: 160,
            }}
          >
            <span
              className="skeleton-line"
              style={{ width: 50, height: 9, display: 'inline-block', marginBottom: 6 }}
              aria-hidden
            >
              .
            </span>
            <br />
            <span
              className="skeleton-line"
              style={{ width: 96, height: 12, display: 'inline-block' }}
              aria-hidden
            >
              .
            </span>
            <br />
            <span
              className="skeleton-line"
              style={{ width: 48, height: 10, display: 'inline-block', marginTop: 4 }}
              aria-hidden
            >
              .
            </span>
          </div>
        ))}
      </div>

      {/* Completed list rows */}
      <span
        className="skeleton-line"
        style={{ width: 80, height: 12, display: 'inline-block', marginBottom: 10 }}
        aria-hidden
      >
        .
      </span>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            padding: '12px 14px',
            background: BG_CARD,
            border: `1px solid ${BORDER}`,
            clipPath: CHUNKY.card,
            marginBottom: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span
            className="skeleton-line"
            style={{ width: 28, height: 28, display: 'inline-block' }}
            aria-hidden
          >
            .
          </span>
          <div style={{ flex: 1 }}>
            <span
              className="skeleton-line"
              style={{ width: '70%', height: 13, display: 'inline-block' }}
              aria-hidden
            >
              .
            </span>
            <br />
            <span
              className="skeleton-line"
              style={{ width: '40%', height: 10, display: 'inline-block', marginTop: 4 }}
              aria-hidden
            >
              .
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

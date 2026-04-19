'use client'
// src/app/(app)/matches/page.tsx
// V3 Scores — Live / Upcoming / Results with tournament-grouped matches.
// Chunky clip-path brand language, no border-radius anywhere.

import { useEffect, useState, useCallback, useRef, useMemo, Suspense } from 'react'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { useRouter } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import { Match } from '@/types/match'
import BrandedLoader, { LOADER_HINTS } from '../../../components/BrandedLoader'
import { withTimeout } from '@/lib/with-timeout'
import AppHeader from '@/components/AppHeader'
import SearchOverlay from '@/components/nav/SearchOverlay'
import MatchesDateStrip from '@/components/MatchesDateStrip'
import TournamentCard from '@/components/TournamentCard'
import MatchesFilterSheet, { countAppliedFilters, type FilterSheetValue } from '@/components/MatchesFilterSheet'
import {
  applyFilters,
  computeDayWindow,
  parseDateParam,
  remapLegacyTab,
  type Circuit,
  type Gender,
} from '@/lib/matches-filters'
import { useFollowing } from '@/hooks/useFollowing'

// ── Brand colors ───────────────────────────────────────────────
const GREEN = '#7ED321'
const BG_BASE = '#1A1A1A'
const BG_CARD = '#141414'
const MUTED = '#6B7280'
const BORDER = 'rgba(255,255,255,0.06)'
const MEN_BLUE = '#4A9EFF'
const WOMEN_PURPLE = '#D966FF'
const GREEN_DIM = 'rgba(126,211,33,0.14)'

// ── Chunky clip-path presets ───────────────────────────────────
const CHUNKY = {
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
  card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
}

// ── Helpers ────────────────────────────────────────────────────

function hasPlayers(m: Match): boolean {
  const a = m as any
  return !!(a.pair1_player1 || a.pair1_player2 || a.pair2_player1 || a.pair2_player2)
}

function isoDateForOffset(now: Date, tz: string, offset: number): string {
  const w = computeDayWindow(now, tz, offset)
  return w.dayStart.slice(0, 10)   // YYYY-MM-DD
}

function groupByTournament(matches: Match[]): { tournament: any; matches: Match[] }[] {
  const groups: { tournament: any; matches: Match[] }[] = []
  for (const m of matches) {
    const t = (m as any).tournament
    const tid = t?.id ?? 'unknown'
    let group = groups.find(g => (g.tournament?.id ?? 'unknown') === tid)
    if (!group) {
      group = { tournament: t, matches: [] }
      groups.push(group)
    }
    group.matches.push(m)
  }
  groups.sort((a, b) => {
    const aHasLive = a.matches.some(m => m.status === 'live')
    const bHasLive = b.matches.some(m => m.status === 'live')
    if (aHasLive !== bHasLive) return aHasLive ? -1 : 1
    const aDate = a.tournament?.starts_at ?? ''
    const bDate = b.tournament?.starts_at ?? ''
    return bDate.localeCompare(aDate)
  })
  return groups
}

// ── Keyframes ─────────────────────────────────────────────────

const KEYFRAMES = `
@keyframes v3-scores-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
@keyframes v3-score-roll {
  0%   { transform: translateY(-120%); opacity: 0; }
  15%  { transform: translateY(-120%); opacity: 0; }
  45%  { transform: translateY(6%); opacity: 1; }
  65%  { transform: translateY(-3%); }
  80%  { transform: translateY(1%); }
  100% { transform: translateY(0); }
}
/* Red banner that covers the scoring pair, holds, then swipes right.
   Total ~2.5s. The 0% step starts the banner just off the left edge so
   it slides in to fully cover, holds for ~1s, then slides out right.
   Pointer-events:none in the overlay style keeps the row clickable. */
@keyframes v3-score-sweep {
  0%   { transform: translateX(-110%); opacity: 0; }
  18%  { transform: translateX(0);     opacity: 1; }
  60%  { transform: translateX(0);     opacity: 1; }
  100% { transform: translateX(110%);  opacity: 0; }
}
`

// ── Empty state helper ────────────────────────────────────────

function EmptyState({ tab, leagueFilter }: { tab: 'live' | 'upcoming' | 'results'; leagueFilter: string }) {
  const t = useTranslations('matches')
  return (
    <div style={{
      clipPath: CHUNKY.card,
      background: BG_CARD,
      border: `1px solid ${BORDER}`,
      padding: '28px 20px',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 32, marginBottom: 10 }}>&#127934;</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', marginBottom: 6 }}>
        {tab === 'live' ? t('noLive') : tab === 'upcoming' ? t('noUpcoming') : t('noResults')}
      </div>
      <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.5 }}>
        {leagueFilter !== 'all'
          ? t('filterHint', { league: leagueFilter === 'premier' ? 'FIP Tour' : 'Premier Padel' })
          : tab === 'live' ? 'Check back during tournament days'
          : tab === 'upcoming' ? 'Schedules will appear closer to match day'
          : 'Results will appear after matches finish'}
      </div>
    </div>
  )
}

// ── Live Now strip ────────────────────────────────────────────

function LiveNowStrip({ count }: { count: number }) {
  const t = useTranslations('matches')
  return (
    <div style={{
      padding: '12px 14px',
      background: 'linear-gradient(180deg, rgba(255,70,85,0.06) 0%, transparent 100%)',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontSize: 9, fontWeight: 900, letterSpacing: 1.2,
        textTransform: 'uppercase', color: '#FF4655',
      }}>
        <span style={{
          width: 7, height: 7, borderRadius: '50%',
          background: '#FF4655',
          animation: 'v3-scores-pulse 2s infinite',
        }} />
        {t('liveNow')} · {count}
      </span>
    </div>
  )
}

function AppliedFiltersStrip({
  circuits, genders, levels, favouritesOnly, hideQualifiers,
  onRemove, onClear,
}: {
  circuits: Set<Circuit>
  genders: Set<Gender>
  levels: Set<string>
  favouritesOnly: boolean
  hideQualifiers: boolean
  onRemove: (kind: 'circuit' | 'gender' | 'level' | 'favouritesOnly' | 'hideQualifiers', value?: string) => void
  onClear: () => void
}) {
  const t = useTranslations('matches.filters')
  const chips: { key: string; label: string; tint?: string; color?: string; onX: () => void }[] = []

  if (circuits.size === 1) {
    const v = [...circuits][0]
    chips.push({ key: `c-${v}`, label: v === 'premier' ? t('premierPadel') : t('fipTour'), onX: () => onRemove('circuit', v) })
  }
  if (genders.size === 1) {
    const v = [...genders][0]
    chips.push({
      key: `g-${v}`, label: v === 'men' ? t('men') : t('women'),
      tint: v === 'men' ? 'rgba(74,158,255,0.14)' : 'rgba(217,102,255,0.14)',
      color: v === 'men' ? MEN_BLUE : WOMEN_PURPLE,
      onX: () => onRemove('gender', v),
    })
  }
  for (const lvl of levels) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const label = lvl === 'fip_gold' ? t('fipGold') : lvl === 'fip_silver' ? t('fipSilver') : t(lvl as any)
    chips.push({ key: `l-${lvl}`, label, onX: () => onRemove('level', lvl) })
  }
  if (favouritesOnly) chips.push({ key: 'fav', label: t('favouritesOnly'), onX: () => onRemove('favouritesOnly') })
  if (hideQualifiers) chips.push({ key: 'hq', label: t('hideQualifiers'), onX: () => onRemove('hideQualifiers') })

  if (chips.length === 0) return null

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '10px 16px',
      borderBottom: `1px solid ${BORDER}`,
      overflowX: 'auto',
    }}>
      {chips.map(c => (
        <span key={c.key} style={{
          flex: '0 0 auto',
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '4px 8px 4px 10px',
          background: c.tint ?? GREEN_DIM,
          color: c.color ?? GREEN,
          fontSize: 10, fontWeight: 700,
          clipPath: CHUNKY.badge,
          whiteSpace: 'nowrap',
        }}>
          {c.label}
          <button onClick={c.onX} aria-label={t('removeFilter', { label: c.label })} style={{
            background: 'none', border: 'none', padding: 0, marginLeft: 2,
            color: 'inherit', cursor: 'pointer', fontSize: 12, lineHeight: 1, opacity: 0.7,
          }}>×</button>
        </span>
      ))}
      <button onClick={onClear} style={{
        marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
        fontSize: 10, fontWeight: 700, color: '#9CA3AF',
        textTransform: 'uppercase', letterSpacing: 0.4,
      }}>
        {t('clear')}
      </button>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────

export default function V3ScoresPageWrapper() {
  return (
    <Suspense fallback={<BrandedLoader hints={[...LOADER_HINTS.matches]} />}>
      <V3ScoresPage />
    </Suspense>
  )
}

function V3ScoresPage() {
  const searchParams = useSearchParams()
  const router = useRouter()

  // Legacy redirect
  useEffect(() => {
    const tid = searchParams.get('tournament')
    if (tid) {
      const round = searchParams.get('round')
      router.replace(`/tournaments/${tid}${round ? `?round=${round}` : ''}`)
    }
  }, [searchParams, router])

  const [liveMatches, setLiveMatches] = useState<Match[]>([])
  const [scheduledMatches, setScheduledMatches] = useState<Match[]>([])
  const [recentMatches, setRecentMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)
  const [dateOffset, setDateOffset] = useState<number>(0)
  const [liveOnly, setLiveOnly] = useState<boolean>(false)

  const [circuits, setCircuits] = useState<Set<Circuit>>(new Set(['premier', 'fip']))
  const [genders, setGenders]   = useState<Set<Gender>>(new Set(['men', 'women']))
  const [levels, setLevels]     = useState<Set<string>>(new Set())
  const [favouritesOnly, setFavouritesOnly] = useState(false)
  const [hideQualifiers, setHideQualifiers] = useState(false)
  const [filterSheetOpen, setFilterSheetOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const { getFollowed } = useFollowing()

  useEffect(() => {
    // Accept ?date=YYYY-MM-DD first
    const rawDate = searchParams.get('date')
    if (rawDate) {
      const parsed = parseDateParam(rawDate, new Date(), timezone)
      if (parsed !== null) { setDateOffset(parsed); return }
    }
    // Fall back to legacy ?tab=live|upcoming|results
    const rawTab = searchParams.get('tab')
    const remapped = remapLegacyTab(rawTab)
    if (remapped) {
      setDateOffset(remapped.dateOffset)
      setLiveOnly(remapped.liveOnly)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // Player joins shared by all match queries
  const matchPlayerJoins = `
    tournament:tournaments(id, name, starts_at, ends_at, country, timezone, level, logo_url, source, entry_list_status),
    pair1_player1:players!matches_pair1_player1_id_fkey(id, name, display_name, country, external_id, ranking, avatar_url, side),
    pair1_player2:players!matches_pair1_player2_id_fkey(id, name, display_name, country, external_id, ranking, avatar_url, side),
    pair2_player1:players!matches_pair2_player1_id_fkey(id, name, display_name, country, external_id, ranking, avatar_url, side),
    pair2_player2:players!matches_pair2_player2_id_fkey(id, name, display_name, country, external_id, ranking, avatar_url, side)`

  // Live matches need games(*) for current point score display
  const matchSelectLive = `*, ${matchPlayerJoins}, sets(*, games(*))`
  // Scheduled/finished only need set scores — no game-level data
  const matchSelectLean = `*, ${matchPlayerJoins}, sets(set_number, set_score, pair1_games, pair2_games, is_current, score_source)`

  const sortSets = (data: any[]) =>
    data.map(m => ({ ...m, sets: (m.sets ?? []).sort((a: any, b: any) => a.set_number - b.set_number) }))

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const safetyTimeout = setTimeout(() => {
      console.warn('[V3 Scores] fetchData safety timeout — releasing loading state')
      setLoading(false)
    }, 12_000)
    try {
      const wrap = <T,>(p: Promise<T>, label: string) => withTimeout(p, 10_000, label)
      const results = await Promise.allSettled([
        wrap(supabase.from('matches').select(matchSelectLive)
          .eq('status', 'live')
          .order('court_order', { ascending: true }) as any, 'matches:live'),
        wrap(supabase.from('matches').select(matchSelectLean)
          .eq('status', 'scheduled')
          .order('scheduled_at', { ascending: true })
          .limit(200) as any, 'matches:scheduled'),
        wrap(supabase.from('matches').select(matchSelectLean)
          .in('status', ['finished', 'retired', 'walkover'])
          .not('finished_at', 'is', null)
          .gte('finished_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
          .order('finished_at', { ascending: false }) as any, 'matches:recent'),
      ])

      const dataOf = (i: number) => {
        const r = results[i]
        if (r.status === 'fulfilled') return (r.value as any)?.data ?? []
        console.warn(`[V3 Scores] fetch[${i}] failed:`, (r.reason as Error)?.message)
        return []
      }

      // Note: the legacy "filter out sim_ external_id" guard was removed
      // after scripts/purge-simulated.ts cleaned the orphan simulator
      // matches from the DB. Future simulator runs use source='simulated'
      // on the parent tournament, which is filtered separately if needed.
      const liveData = dataOf(0)
      setLiveMatches(sortSets(liveData))
      setScheduledMatches(sortSets(dataOf(1)))
      setRecentMatches(sortSets(dataOf(2)))
    } catch (e) {
      console.error('[V3 Scores] fetchData error:', e)
    } finally {
      clearTimeout(safetyTimeout)
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (searchParams.get('tournament')) return
    fetchData()
  }, [fetchData, searchParams])

  // Realtime subscription — silent refresh (no spinner)
  const realtimeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const handleChange = () => {
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current)
      realtimeDebounceRef.current = setTimeout(() => fetchData(true), 500)
    }
    const ch = supabase
      .channel('v3-scores-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, handleChange)
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current)
    }
  }, [fetchData])

  // Auto-refresh for today — silent (live matches may be updating)
  useEffect(() => {
    if (dateOffset !== 0) return
    const interval = setInterval(() => fetchData(true), 30000)
    return () => clearInterval(interval)
  }, [dateOffset, fetchData])

  // ── Date window + compound filtered slices ────────────────────
  // Read the user's timezone from the geo-timezone cookie (set by proxy).
  const timezone = useMemo(() => {
    if (typeof document === 'undefined') return 'UTC'
    const m = document.cookie.match(/(?:^|; )geo-timezone=([^;]+)/)
    try {
      return m ? decodeURIComponent(m[1]) : Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
      return 'UTC'
    }
  }, [])

  const favourites = useMemo(() => ({
    matches: new Set(getFollowed('match')),
    players: new Set(getFollowed('player')),
    tournaments: new Set(getFollowed('tournament')),
  }), [getFollowed])

  const filters = useMemo(() => ({
    circuits, genders, levels, favouritesOnly, hideQualifiers, favourites,
  }), [circuits, genders, levels, favouritesOnly, hideQualifiers, favourites])

  const dayWindow = useMemo(() => computeDayWindow(new Date(), timezone, dateOffset), [timezone, dateOffset])

  const dayMatches = useMemo(() => {
    const { dayStart, dayEnd } = dayWindow
    const within = (ts: string | null | undefined) => !!ts && ts >= dayStart && ts < dayEnd

    if (dateOffset === 0) {
      // Today: live ∪ scheduled-today ∪ finished-today
      const seen = new Set<string>()
      const pool = [
        ...liveMatches,
        ...scheduledMatches.filter(m => within(m.scheduled_at) && hasPlayers(m)),
        ...recentMatches.filter(m => within((m as any).finished_at)),
      ]
      return applyFilters(pool.filter(m => seen.has(m.id) ? false : (seen.add(m.id), true)), filters)
    }
    if (dateOffset < 0) {
      return applyFilters(recentMatches.filter(m => within((m as any).finished_at)), filters)
    }
    return applyFilters(scheduledMatches.filter(m => within(m.scheduled_at) && hasPlayers(m)), filters)
  }, [dateOffset, dayWindow, liveMatches, scheduledMatches, recentMatches, filters])

  const visibleMatches = useMemo(
    () => liveOnly ? dayMatches.filter(m => m.status === 'live') : dayMatches,
    [dayMatches, liveOnly],
  )

  const dayGrouped = useMemo(() => groupByTournament(visibleMatches), [visibleMatches])

  const liveInDay = useMemo(() => dayMatches.filter(m => m.status === 'live').length, [dayMatches])

  // Stable value for the filter sheet — memoized so the child's draft-re-sync
  // effect doesn't fire on every parent re-render and wipe in-progress edits.
  const sheetValue: FilterSheetValue = useMemo(() => ({
    circuits, genders, levels, favouritesOnly, hideQualifiers,
  }), [circuits, genders, levels, favouritesOnly, hideQualifiers])

  return (
    <main style={{
      background: BG_BASE, minHeight: '100vh',
      maxWidth: 500, margin: '0 auto',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      borderLeft: `0.5px solid ${BORDER}`,
      borderRight: `0.5px solid ${BORDER}`,
    }}>
      <style dangerouslySetInnerHTML={{ __html: KEYFRAMES }} />

      {/* Header */}
      <AppHeader onSearchOpen={() => setSearchOpen(true)} />
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />

      {loading ? (
        <BrandedLoader hints={[...LOADER_HINTS.matches]} />
      ) : (
        <>
          <MatchesDateStrip
            dateOffset={dateOffset}
            onDateChange={(next) => {
              setDateOffset(next)
              const params = new URLSearchParams()
              if (next !== 0) params.set('date', isoDateForOffset(new Date(), timezone, next))
              const url = params.toString() ? `/matches?${params.toString()}` : '/matches'
              router.replace(url, { scroll: false })
            }}
            filterCount={countAppliedFilters(sheetValue)}
            onFilterClick={() => setFilterSheetOpen(true)}
            liveOnly={liveOnly}
            onLiveToggle={() => setLiveOnly(v => !v)}
            liveDisabled={liveInDay === 0}
          />

          <AppliedFiltersStrip
            circuits={circuits}
            genders={genders}
            levels={levels}
            favouritesOnly={favouritesOnly}
            hideQualifiers={hideQualifiers}
            onRemove={(kind, value) => {
              if (kind === 'circuit' && value) setCircuits(new Set(['premier', 'fip']))
              else if (kind === 'gender' && value) setGenders(new Set(['men', 'women']))
              else if (kind === 'level' && value) setLevels(prev => { const n = new Set(prev); n.delete(value); return n })
              else if (kind === 'favouritesOnly') setFavouritesOnly(false)
              else if (kind === 'hideQualifiers') setHideQualifiers(false)
            }}
            onClear={() => {
              setCircuits(new Set(['premier', 'fip']))
              setGenders(new Set(['men', 'women']))
              setLevels(new Set())
              setFavouritesOnly(false)
              setHideQualifiers(false)
            }}
          />

          <MatchesFilterSheet
            key={filterSheetOpen ? 'open' : 'closed'}
            open={filterSheetOpen}
            initial={sheetValue}
            onApply={(next) => {
              setCircuits(next.circuits)
              setGenders(next.genders)
              setLevels(next.levels)
              setFavouritesOnly(next.favouritesOnly)
              setHideQualifiers(next.hideQualifiers)
              setFilterSheetOpen(false)
            }}
            onClose={() => setFilterSheetOpen(false)}
          />

          {liveInDay > 0 && dateOffset === 0 && !liveOnly && (
            <LiveNowStrip count={liveInDay} />
          )}
          {dayGrouped.length === 0
            ? <EmptyState
                tab={dateOffset < 0 ? 'results' : dateOffset === 0 ? 'live' : 'upcoming'}
                leagueFilter="all"
              />
            : dayGrouped.map(g => (
                <TournamentCard
                  key={g.tournament?.id ?? 'u'}
                  tournament={g.tournament}
                  matches={g.matches}
                  tab={dateOffset < 0 ? 'yesterday' : dateOffset === 0 ? 'today' : 'upcoming'}
                />
              ))}
        </>
      )}
    </main>
  )
}

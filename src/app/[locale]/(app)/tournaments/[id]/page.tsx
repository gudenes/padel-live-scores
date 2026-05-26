'use client'
// src/app/(app)/tournaments/[id]/page.tsx
// V3 Tournament Detail — matches by round with gender toggle, stage selector,
// realtime updates, overview tab, and recap tab. Styled with PadelNachos brand.

import { useEffect, useState, useCallback, useMemo, useRef, use, Suspense } from 'react'
import Image from 'next/image'
import { useFormatter, useTranslations, useLocale } from 'next-intl'
import { TIME_24H, DATE_SHORT, DATE_WITH_WEEKDAY } from '@/lib/format-patterns'
import { useSearchParams } from 'next/navigation'
import { useRouter, usePathname, Link } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import { Match, countryFlag, pairName, parseSetScore, parseSetFromGames, isWarmingUp, toShortName } from '@/types/match'
import { hydrateThinPlayers } from '@/lib/thin-match-player'
import Spinner from '../../../../components/Spinner'
import DetailPageSkeleton from '@/components/skeletons/DetailPageSkeleton'
import MatchCardSkeleton from '@/components/skeletons/MatchCardSkeleton'
import { withTimeout } from '@/lib/with-timeout'
import FollowButton from '@/components/FollowButton'
import { MatchCard } from '@/components/MatchCard'
import { WhereToWatchInline } from '@/components/where-to-watch/WhereToWatchInline'
import type { BroadcasterRow, LiveChannel, ChannelMeta } from '@/lib/where-to-watch/group-builder'
import { levelToChannelAbbr } from '@/lib/where-to-watch/circuit-map'
import { filterTournamentStreams } from '@/lib/where-to-watch/filter-tournament-streams'
import { tokenize } from '@/lib/fip-stream-title-parser'
import { tournamentSearchUrl } from '@/lib/fip-stream-resolver'
import { isFipTier } from '@/lib/fip-channel'
import { EditorialBlock } from '@/components/EditorialBlock'
import { FlagImage } from '@/components/FlagImage'
import EmptyState from '@/components/EmptyState'
import { pickDefaultRound, type PickDefaultRoundMatch } from '@/lib/pick-default-round'
import { levelLabel } from '@/lib/tournament-labels'
import TournamentCoverImage from '@/components/TournamentCoverImage'
import { getTierPill } from '@/lib/tournament-tier-style'
import DrawTab from './DrawTab'
import SlidingInkTabs from '@/components/SlidingInkTabs'

// ── Brand colors ───────────────────────────────────────────────
const GREEN = '#7ED321'
const ORANGE = '#F5A623'
const LIVE_RED = '#FF4655'
const BG_BASE = '#1A1A1A'
const BG_CARD = '#141414'
const MUTED = '#6B7280'
const BORDER = 'rgba(255,255,255,0.06)'
const MEN_BLUE = '#4A9EFF'
const WOMEN_PURPLE = '#D966FF'

// ── Chunky clip-path presets (NO border-radius) ───────────────
const CHUNKY = {
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
  card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
  button: 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)',
}

// ── Collapsing header dimensions ──────────────────────────────
const HERO_EXPANDED = 280
const HERO_COLLAPSED = 62
const COLLAPSE_SCROLL = HERO_EXPANDED - HERO_COLLAPSED  // 218

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

// ── Coverage levels with live point-by-point scoring ──────────
const FULL_COVERAGE_LEVELS = new Set(['major', 'p1', 'p2', 'finals', 'fip_platinum'])

// Tiers that get the Draw tab. Lower tiers (fip_other, padelapi-only)
// don't have reliable bracket data and skip this UI.
const DRAW_TIERS = new Set([
  'major', 'p1', 'p2', 'finals',
  'fip_bronze', 'fip_silver', 'fip_gold', 'fip_platinum',
])

// ── Stage ordering ────────────────────────────────────────────
// Keys are the canonical labels produced by `normalizeRoundFull`. The
// sort comparator uses these values: bigger = earlier in the bracket
// (Q1 first, Final last). Qualifying rounds always come before main
// draw — they happen first chronologically.
const ROUND_ORDER: Record<string, number> = {
  'Q1': 9,
  'Q2': 8,
  'Q3': 7,
  'Round of 64': 6,
  'Round of 32': 5,
  'Round of 16': 4,
  'Quarterfinals': 3,
  'Semifinals': 2,
  'Finals': 1,
}

// Map round_schedule's compact keys to the canonical labels in ROUND_ORDER.
const ROUND_KEY_TO_LABEL: Record<string, string> = {
  q1: 'Q1',
  q2: 'Q2',
  q3: 'Q3',
  r64: 'Round of 64',
  r32: 'Round of 32',
  r16: 'Round of 16',
  qf: 'Quarterfinals',
  sf: 'Semifinals',
  f: 'Finals',
}

// And the inverse for finding a round_schedule date by canonical label.
const ROUND_LABEL_TO_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(ROUND_KEY_TO_LABEL).map(([k, v]) => [v, k]),
)

// Collapse every alias the upstream feeds throw at us (FIP "SemiFinals",
// padelapi "R16", widget "Final", "Quarter") into one canonical label
// that matches a key in ROUND_ORDER. Without canonicalisation the
// tournament page rendered the same bracket round twice ("R16" + "Round
// of 16") and the DB's "SemiFinals" (camelCase) fell through unsorted to
// the bottom because ROUND_ORDER only had "Semifinals" (lowercase F).
function normalizeRoundFull(r: string): string {
  const key = r.toLowerCase().replace(/\s+/g, '')
  const map: Record<string, string> = {
    'final': 'Finals',
    'finals': 'Finals',
    'f': 'Finals',
    'semi': 'Semifinals',
    'semifinal': 'Semifinals',
    'semifinals': 'Semifinals',
    'sf': 'Semifinals',
    'quarter': 'Quarterfinals',
    'quarters': 'Quarterfinals',
    'quarterfinal': 'Quarterfinals',
    'quarterfinals': 'Quarterfinals',
    'qf': 'Quarterfinals',
    'r16': 'Round of 16',
    'roundof16': 'Round of 16',
    'r32': 'Round of 32',
    'roundof32': 'Round of 32',
    'r64': 'Round of 64',
    'roundof64': 'Round of 64',
  }
  return map[key] ?? r
}

function localDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const KEEP_UPPER = new Set(['FIP', 'P1', 'P2', 'WPT', 'APT', 'A1', 'II', 'III', 'IV', 'BNL'])
function titleCase(name: string): string {
  return name.split(' ').map(word => {
    if (KEEP_UPPER.has(word.toUpperCase())) return word.toUpperCase()
    if (word.length <= 1) return word.toUpperCase()
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  }).join(' ')
}

// levelLabel is imported at the top from @/lib/tournament-labels —
// the canonical map there covers all FIP tiers (Beyond, Promises,
// Hexagon, etc.). The local copy that used to live here only knew
// about the top few tiers and let newer levels fall through as raw
// keys, which uppercased to "FIP_BEYOND" etc. inside the level pill.

// Does a match's pair N (1 or 2) have at least one resolved player?
// The fip-draw-populator inserts every bracket cell — including ones
// where an opponent is still "winner of Q1 #5" (one pair fully TBD).
// PARTIDAS hides those scaffold rows; CUADRO keeps them. A pair is
// considered resolved if EITHER player has an id or a name set.
function hasResolvedPair(m: unknown, pairN: 1 | 2): boolean {
  const r = m as Record<string, unknown>
  const p1Id = r[`pair${pairN}_player1_id`]
  const p1Name = r[`pair${pairN}_player1_name`]
  const p2Id = r[`pair${pairN}_player2_id`]
  const p2Name = r[`pair${pairN}_player2_name`]
  return !!(p1Id || p1Name || p2Id || p2Name)
}

// ══════════════════════════════════════════════════════════════
// ── Wrapper (unwraps async params) ───────────────────────────
// ══════════════════════════════════════════════════════════════

export default function TournamentDetailWrapper({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return (
    <Suspense fallback={<DetailPageSkeleton variant="tournament" />}>
      <TournamentDetail tournamentId={id} />
    </Suspense>
  )
}

// ══════════════════════════════════════════════════════════════
// ── Main component ───────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

function TournamentDetail({ tournamentId }: { tournamentId: string }) {
  const format = useFormatter()
  const tTournament = useTranslations('tournament')
  const tCommon = useTranslations('common')
  const locale = useLocale()
  // User's timezone from the browser. Falls back to UTC when Intl is
  // unavailable (very old engines). MatchCard formats the date
  // chip in this tz.
  const userTz = (typeof Intl !== 'undefined'
    ? (Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC')
    : 'UTC')
  const searchParams = useSearchParams()
  const paramRound = searchParams.get('round')
  const paramTab = searchParams.get('tab')
  const router = useRouter()

  // ── State ─────────────────────────────────────────────────────
  const [allMatches, setAllMatches] = useState<Match[]>([])
  const [tournaments, setTournaments] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [liveCount, setLiveCount] = useState(0)
  const [syncAgo, setSyncAgo] = useState('')
  const [lastSynced, setLastSynced] = useState<Date | null>(null)
  const [justUpdated, setJustUpdated] = useState(false)

  const [heroProgress, setHeroProgress] = useState(0)

  const [activeTournament, setActiveTournament] = useState<string | null>(null)
  const [selectedRound, setSelectedRound] = useState<string | null>(null)
  const [genderFilter, setGenderFilter] = useState<'men' | 'women'>('men')
  // Animated arrival from home's "VER PARTIDOS" card: when intent=matches is
  // present alongside tab=matches, mount on Overview and slide to Matches
  // after a short beat (see the mount effect below).
  const wantsMatchesAnimation =
    searchParams.get('intent') === 'matches' && paramTab === 'matches'

  const [pageTab, setPageTabState] = useState<'matches' | 'overview' | 'story' | 'draw'>(
    // Map the legacy `?tab=recap` URL param to the new 'story' tab so old
    // share links and bookmarks keep working.
    wantsMatchesAnimation
      ? 'overview'
      : paramTab === 'draw'
      ? 'draw'
      : paramTab === 'story' || paramTab === 'recap'
      ? 'story'
      : paramTab === 'matches'
      ? 'matches'
      : 'overview'
  )

  // Tracks whether the user has manually changed tabs, so the scheduled
  // animated-arrival commit doesn't override a tap that happens during the dwell.
  const userChangedTabRef = useRef(false)
  const setPageTab = useCallback((next: 'matches' | 'overview' | 'story' | 'draw') => {
    userChangedTabRef.current = true
    setPageTabState(next)
  }, [])

  const stageStripRef = useRef<HTMLDivElement>(null)

  // prefers-reduced-motion snaps between expanded and collapsed
  const reducedMotion = useMemo(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }, [])

  const p = reducedMotion ? (heroProgress > 0.5 ? 1 : 0) : heroProgress
  const navbarLayerOpacity = p
  const compactOpacity     = clamp01((p - 0.55) / 0.4)
  const inlineOpacity      = clamp01((0.7 - p) / 0.4)

  // Animated arrival from home's "VER PARTIDOS": mount on Overview,
  // slide to Matches after a short beat (or commit immediately under
  // reduced-motion). The visible animation is SlidingInkTabs' existing
  // spring on activeKey change.
  const pathname = usePathname()
  useEffect(() => {
    if (!wantsMatchesAnimation) return

    const commit = () => {
      if (userChangedTabRef.current) return
      setPageTabState('matches')

      // Strip ?intent so refresh/back doesn't replay the animation.
      const params = new URLSearchParams(searchParams.toString())
      params.delete('intent')
      const qs = params.toString()
      router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false })
    }

    if (reducedMotion) {
      commit()
      return
    }

    const t = window.setTimeout(commit, 280)
    return () => window.clearTimeout(t)
    // Intentionally mount-only — animated arrival fires once per navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])


  // ── Fetch ─────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    const safetyTimeout = setTimeout(() => {
      console.warn('[V3 Tournament] fetchAll safety timeout — releasing loading state')
      setLoading(false)
    }, 12_000)
    try {
      const result = await withTimeout<{ data: any; error: any }>(
        supabase
          .from('matches')
          .select(`
            *,
            tournament:tournaments!inner(id, name, starts_at, ends_at, country, timezone, level),
            pair1_player1:players!matches_pair1_player1_id_fkey(id, name, display_name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
            pair1_player2:players!matches_pair1_player2_id_fkey(id, name, display_name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
            pair2_player1:players!matches_pair2_player1_id_fkey(id, name, display_name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
            pair2_player2:players!matches_pair2_player2_id_fkey(id, name, display_name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
            sets(*, games(*))
          `)
          .eq('tournament.id', tournamentId)
          .in('status', ['live', 'scheduled', 'finished', 'retired', 'walkover', 'ended', 'bye'])
          .order('court_order', { ascending: true, nullsFirst: false })
          .order('started_at', { ascending: false }) as unknown as Promise<{ data: any; error: any }>,
        10_000,
        'tournament:matches'
      )
      const { data, error } = result

      if (error) {
        console.error('[V3 Tournament] fetchAll error:', error)
        return
      }

      const sorted = (data as any[]).map(m => hydrateThinPlayers({
        ...m,
        sets: (m.sets ?? []).sort((a: any, b: any) => a.set_number - b.set_number),
      }))

      setAllMatches(sorted)
      setLiveCount(sorted.filter((m: any) => m.status === 'live' && !isWarmingUp(m as Match)).length)
      setLastSynced(new Date())
      setJustUpdated(true)
      setTimeout(() => setJustUpdated(false), 1500)
    } catch (e) {
      console.error('[V3 Tournament] fetchAll exception:', e)
    } finally {
      clearTimeout(safetyTimeout)
      setLoading(false)
    }
  }, [tournamentId])

  const fetchTournaments = useCallback(async () => {
    const { data } = await supabase
      .from('tournaments')
      .select('id, name, starts_at, ends_at, country, timezone, level, status, logo_url, cover_image_url, venue, venue_address, venue_type, prize_money, prize_money_fip, prize_breakdown, round_schedule, signup_fee_eur, registration_status, schedule_notes, draw_size_md, draw_size_qd, entry_list_status, source, fip_id, slug, factsheet_url, factsheet_data')
      .order('starts_at', { ascending: false })
    if (data) setTournaments(data)
  }, [])


  useEffect(() => { fetchAll(); fetchTournaments() }, [fetchAll, fetchTournaments])

  // ── Collapsing header scroll listener ─────────────────────────
  // Listens on BOTH window (mobile) and .app-screen (desktop preview
  // where ≥1100 px viewports use the in-frame inner scroller; see
  // globals.css `@media (min-width: 1100px) .app-screen { overflow-y: auto }`).
  // Reading scrollTop from whichever is non-zero picks up the active
  // scroller without needing a viewport-width guess.
  useEffect(() => {
    const appScreen = document.querySelector('.app-screen') as HTMLElement | null
    let rafToken: number | null = null
    function readScrollTop(): number {
      const a = appScreen?.scrollTop ?? 0
      const w = window.scrollY
      return Math.max(a, w)
    }
    function onScroll() {
      if (rafToken != null) return
      rafToken = requestAnimationFrame(() => {
        rafToken = null
        setHeroProgress(clamp01(readScrollTop() / COLLAPSE_SCROLL))
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    appScreen?.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => {
      window.removeEventListener('scroll', onScroll)
      appScreen?.removeEventListener('scroll', onScroll)
      if (rafToken != null) cancelAnimationFrame(rafToken)
    }
  }, [])

  // ── Realtime — list-shape watcher only ────────────────────────
  //
  // MatchCard now subscribes per-match via useLiveMatch when its row
  // is live/on_court, so score ticks no longer flow through this
  // page. The parent's only job is to react to status transitions
  // (scheduled→live, live→finished) and bracket additions, which
  // require re-bucketing the visible groups. Filter scopes the sub
  // to this tournament's matches so unrelated tournaments don't
  // trigger refetches here.
  const realtimeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const handleChange = () => {
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current)
      realtimeDebounceRef.current = setTimeout(fetchAll, 500)
    }
    const ch = supabase
      .channel(`v3-tournament-feed-${tournamentId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches', filter: `tournament_id=eq.${tournamentId}` },
        handleChange,
      )
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current)
    }
  }, [fetchAll, tournamentId])

  // ── Sync ago ──────────────────────────────────────────────────
  useEffect(() => {
    if (!lastSynced) return
    const update = () => {
      const secs = Math.floor((Date.now() - lastSynced.getTime()) / 1000)
      if (secs < 5) setSyncAgo('just updated')
      else if (secs < 60) setSyncAgo(`${secs}s ago`)
      else setSyncAgo(`${Math.floor(secs / 60)}m ago`)
    }
    update()
    const t = setInterval(update, 5000)
    return () => clearInterval(t)
  }, [lastSynced])

  useEffect(() => { setActiveTournament(tournamentId) }, [tournamentId])

  const activeTournamentObj = tournaments.find(t => t.id === activeTournament) ?? null

  // Default tab to 'story' when the tournament is finished and no explicit
  // tab was requested via URL. Runs once per tournament load.
  const autoTabSetRef = useRef<string | null>(null)
  useEffect(() => {
    if (!activeTournamentObj || paramTab) return
    if (autoTabSetRef.current === activeTournamentObj.id) return
    const isFinished = activeTournamentObj.status === 'completed' || activeTournamentObj.status === 'finished'
    if (isFinished) {
      setPageTab('story')
      autoTabSetRef.current = activeTournamentObj.id
    }
  }, [activeTournamentObj, paramTab])

  // ── Auto-switch gender if no matches ──────────────────────────
  useEffect(() => {
    if (loading || allMatches.length === 0) return
    const hasMen = allMatches.some(m => (m as any).category === 'men')
    const hasWomen = allMatches.some(m => (m as any).category === 'women')
    if (genderFilter === 'men' && !hasMen && hasWomen) setGenderFilter('women')
    else if (genderFilter === 'women' && !hasWomen && hasMen) setGenderFilter('men')
  }, [loading, allMatches, genderFilter])

  // ── Available rounds (ordered R64 → Finals) ──────────────────
  const availableRounds = useMemo(() => {
    const seen = new Set<string>()
    for (const m of allMatches) {
      if (activeTournament && (m as any).tournament?.id !== activeTournament) continue
      if ((m as any).category !== genderFilter) continue
      // Skip bracket-scaffold rows (one or both pairs entirely TBD). The
      // fip-draw-populator inserts every bracket cell, including ones where
      // an opponent is still "winner of Q1 #N" — those belong in CUADRO,
      // not in the round chip strip on PARTIDAS.
      if (!hasResolvedPair(m, 1) || !hasResolvedPair(m, 2)) continue
      const r = m.round as string | null
      if (r) seen.add(normalizeRoundFull(r))
    }
    const real = [...seen]

    // Per scope decision A — only show placeholders for rounds AFTER the
    // most-advanced real round. If there are no real rounds yet (pre-
    // tournament), we show nothing rather than guessing — keeps current
    // behavior on empty tournaments and avoids the 16-draw "1st round MD"
    // ambiguity (the parser might map it to r32 for a tournament that
    // doesn't have an R32).
    if (real.length === 0) {
      return real.sort((a, b) => (ROUND_ORDER[b] ?? 0) - (ROUND_ORDER[a] ?? 0))
    }

    const sched = ((activeTournamentObj as any)?.round_schedule ?? {}) as Record<string, string>
    const realMinOrder = Math.min(...real.map(r => ROUND_ORDER[r] ?? 99))
    const placeholderRounds = Object.keys(sched)
      .map(k => ROUND_KEY_TO_LABEL[k])
      .filter((label): label is string => !!label)
      .filter(label => (ROUND_ORDER[label] ?? 99) < realMinOrder)
      .filter(label => !seen.has(label))   // never duplicate a real round

    return [...real, ...placeholderRounds].sort(
      (a, b) => (ROUND_ORDER[b] ?? 0) - (ROUND_ORDER[a] ?? 0),
    )
  }, [allMatches, activeTournament, activeTournamentObj, genderFilter])

  // ── Dates per round ──────────────────────────────────────────
  const roundDates = useMemo(() => {
    const map: Record<string, string> = {}
    for (const round of availableRounds) {
      const dates = new Set<string>()
      for (const m of allMatches) {
        if (activeTournament && (m as any).tournament?.id !== activeTournament) continue
        if ((m as any).category !== genderFilter) continue
        if (normalizeRoundFull(m.round as string) !== round) continue
        const src = (m as any).scheduled_at ?? (m as any).started_at
        if (src) dates.add(src.slice(0, 10))
      }
      const sorted = [...dates].sort()
      if (sorted.length === 0) continue
      const fmt = (iso: string) => format.dateTime(new Date(iso), DATE_SHORT)
      map[round] = sorted.length === 1 ? fmt(sorted[0]) : `${fmt(sorted[0])} - ${fmt(sorted[sorted.length - 1])}`
    }

    // Backfill placeholder rounds with their round_schedule date.
    const sched = ((activeTournamentObj as any)?.round_schedule ?? {}) as Record<string, string>
    for (const round of availableRounds) {
      if (map[round]) continue   // already has a match-derived date
      const key = ROUND_LABEL_TO_KEY[round]
      const iso = key ? sched[key] : null
      if (iso) {
        map[round] = format.dateTime(new Date(`${iso}T00:00:00Z`), DATE_SHORT)
      }
    }

    return map
  }, [allMatches, availableRounds, activeTournament, activeTournamentObj, genderFilter])

  // ── Auto-select round: live > today > most-advanced-finished > Q1 ──
  useEffect(() => {
    if (availableRounds.length === 0) return
    const todayKey = localDateKey(new Date())
    const candidates: PickDefaultRoundMatch[] = allMatches.map(m => {
      const src = (m as any).scheduled_at ?? (m as any).started_at
      return {
        normalizedRound: normalizeRoundFull(m.round as string),
        status: m.status as string,
        scheduledDateKey: typeof src === 'string' ? src.slice(0, 10) : null,
        tournamentId: (m as any).tournament?.id ?? null,
      }
    })
    const smartDefault = pickDefaultRound({
      availableRounds,
      matches: candidates,
      activeTournamentId: activeTournament ?? null,
      todayKey,
    })
    setSelectedRound(prev => {
      if (paramRound && !prev) {
        const normalized = normalizeRoundFull(paramRound)
        if (availableRounds.includes(normalized)) return normalized
      }
      if (prev && availableRounds.includes(prev)) return prev
      return smartDefault
    })
  }, [availableRounds, activeTournament, paramRound, allMatches])

  // ── Auto-scroll stage strip: center the active round chip ─────
  // Uses container.scrollTo (not scrollIntoView) so the strip's horizontal
  // scroll is the only thing that moves — scrollIntoView would also nudge
  // the page's vertical scroll on iOS/Webkit.
  //
  // Uses getBoundingClientRect-based math (not offsetLeft) because the
  // strip container has no CSS positioning context, so offsetLeft returns
  // a position relative to <body>, not the container.
  //
  // Depends on pageTab so we re-fire when the matches view mounts: the
  // round strip is only in the DOM when pageTab === 'matches', and
  // selectedRound can be computed earlier (during the animated-arrival
  // dwell where pageTab is still 'overview'). Without this dep, the
  // first-fire of the effect finds no active button and silently bails.
  //
  // The first-paint measurement can produce a wrong target when the
  // strip's clientWidth isn't fully settled (hero image loading,
  // cookie banner shifting layout, sticky positioning). We retry on
  // every ResizeObserver tick of the container until we successfully
  // center, then stop — that way the user's manual scrolls aren't
  // fought by later size changes.
  useEffect(() => {
    if (pageTab !== 'matches') return
    if (!selectedRound || !stageStripRef.current) return
    const container = stageStripRef.current

    let centered = false
    const center = () => {
      if (centered) return
      const btn = container.querySelector<HTMLElement>('[data-active="true"]')
      if (!btn) return
      const cRect = container.getBoundingClientRect()
      const bRect = btn.getBoundingClientRect()
      // Guard against transient layout where dimensions are tiny/zero.
      // A real round chip is wider than 30px; a real strip wider than 100px.
      if (container.clientWidth < 100 || bRect.width < 30) return

      const btnLeftInScrollSpace = bRect.left - cRect.left + container.scrollLeft
      const target = btnLeftInScrollSpace - (container.clientWidth - bRect.width) / 2
      const max = container.scrollWidth - container.clientWidth
      const clamped = Math.max(0, Math.min(target, max))
      container.scrollTo({ left: clamped, behavior: 'smooth' })
      centered = true
    }

    const raf = requestAnimationFrame(center)

    // ResizeObserver retries center() each time the strip's size changes,
    // catching the case where the initial rAF ran before layout settled.
    // The `centered` flag ensures we only commit once per round selection.
    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        if (!centered) requestAnimationFrame(center)
      })
      ro.observe(container)
    }

    return () => {
      cancelAnimationFrame(raf)
      ro?.disconnect()
    }
  }, [selectedRound, pageTab])

  // ── Filtered matches ──────────────────────────────────────────
  const filtered = useMemo(() => {
    const passed = allMatches.filter(m => {
      if (activeTournament && (m as any).tournament?.id !== activeTournament) return false
      if (selectedRound && normalizeRoundFull(m.round as string) !== selectedRound) return false
      if ((m as any).category !== genderFilter) return false
      // Same scaffold filter as availableRounds: hide bracket cells whose
      // opponents haven't been determined yet. CUADRO still shows them.
      if (!hasResolvedPair(m, 1) || !hasResolvedPair(m, 2)) return false
      return true
    })
    // Defense-in-depth dedup: cross-source ingest sometimes leaves two
    // match rows with identical 4-player UUIDs in the same tournament
    // (entry-list path + live-poller create-or-find race). Without this
    // step, both rows render — once under LIVE NOW and again under
    // UP NEXT. Keep the row with the higher status priority + richer
    // metadata. Run dedup-same-player-uuids.mjs to fix the underlying
    // data, but the UI stays clean even if new dupes slip through.
    const rank = (s: string) => ({ live: 4, on_court: 3, finished: 2, scheduled: 1 }[s as 'live'] ?? 0)
    const bestByUuids = new Map<string, typeof passed[number]>()
    for (const m of passed) {
      const ids = [
        (m as any).pair1_player1_id,
        (m as any).pair1_player2_id,
        (m as any).pair2_player1_id,
        (m as any).pair2_player2_id,
      ].filter(Boolean).sort().join('|')
      if (!ids) { bestByUuids.set(m.id, m); continue }
      const key = `${(m as any).tournament?.id ?? activeTournament ?? ''}::${ids}`
      const existing = bestByUuids.get(key)
      if (!existing) { bestByUuids.set(key, m); continue }
      const a = rank(existing.status as string)
      const b = rank(m.status as string)
      // Higher status wins; ties broken by widget_id_composite presence
      // (entry-list-tracked rows have richer metadata: round, seeds, names).
      if (b > a) bestByUuids.set(key, m)
      else if (b === a && !(existing as any).widget_id_composite && (m as any).widget_id_composite) {
        bestByUuids.set(key, m)
      }
    }
    return [...bestByUuids.values()]
  }, [allMatches, activeTournament, selectedRound, genderFilter])

  const liveMatches = filtered.filter(m => (m.status === 'live' || (m.status as string) === 'on_court') && !isWarmingUp(m as Match))
  const warmingUpMatches = filtered.filter(m => (m.status === 'live' || (m.status as string) === 'on_court') && isWarmingUp(m as Match))
  const scheduledMatches = filtered
    .filter(m => m.status === 'scheduled')
    .sort((a: any, b: any) => {
      const ca = a.court_order ?? 999
      const cb = b.court_order ?? 999
      if (ca !== cb) return ca - cb
      const da = a.scheduled_at ?? a.started_at ?? ''
      const db = b.scheduled_at ?? b.started_at ?? ''
      return da.localeCompare(db)
    })

  // ── Estimated time labels for scheduled matches ───────────────
  function parseAmPm(label: string): { h: number; m: number } | null {
    const tm = label.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
    if (!tm) return null
    let h = parseInt(tm[1]); const m = parseInt(tm[2]); const ap = tm[3].toUpperCase()
    if (ap === 'PM' && h < 12) h += 12
    if (ap === 'AM' && h === 12) h = 0
    return { h, m }
  }
  function toAmPmLabel(h: number, m: number): string {
    const ap = h >= 12 ? 'PM' : 'AM'
    const h12 = h > 12 ? h - 12 : (h === 0 ? 12 : h)
    return `Starting at ${h12}:${String(m).padStart(2, '0')} ${ap}`
  }
  function courtKey(m: any): string | null {
    const c = m.court as string | null
    if (c) return `name:${c}`
    const co = m.court_order as string | number | null
    if (co != null) return `order:${co}`
    return null
  }

  const estimatedLabels = useMemo(() => {
    const map: Record<string, string> = {}
    const floorByCourt: Record<string, string> = {}
    const tz = activeTournamentObj?.timezone ?? 'UTC'
    for (const m of allMatches) {
      const status = m.status as string
      if (status !== 'live' && status !== 'finished') continue
      const ck = courtKey(m as any)
      if (!ck) continue
      const startedAt = (m as any).started_at as string | null
      if (!startedAt) continue
      try {
        const d = new Date(startedAt)
        const localStr = d.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true })
        const tm = localStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
        if (!tm) continue
        let h = parseInt(tm[1]); const min = parseInt(tm[2]); const ap = tm[3].toUpperCase()
        if (ap === 'PM' && h < 12) h += 12
        if (ap === 'AM' && h === 12) h = 0
        const totalMins = h * 60 + min + 90
        const candidate = toAmPmLabel(Math.floor(totalMins / 60) % 24, totalMins % 60)
        if (!floorByCourt[ck] || status === 'live') {
          floorByCourt[ck] = candidate
        }
      } catch { /* ignore */ }
    }

    for (let i = 0; i < scheduledMatches.length; i++) {
      const m = scheduledMatches[i] as any
      const sl = m.schedule_label as string | null
      const mKey = courtKey(m)
      if (sl && /starting at/i.test(sl)) continue
      const rawPrev = scheduledMatches[i - 1] as any | undefined
      const prev = (rawPrev && mKey && courtKey(rawPrev) === mKey) ? rawPrev : undefined
      if (sl && /not before/i.test(sl)) {
        const prevSl = prev?.schedule_label as string | null
        if (prev && prevSl && /not before/i.test(prevSl)) {
          const prevLabel = map[prev.id] ?? prevSl
          const parsed = parseAmPm(prevLabel)
          if (parsed) {
            const totalMins = parsed.h * 60 + parsed.m + 90
            map[m.id] = toAmPmLabel(Math.floor(totalMins / 60) % 24, totalMins % 60)
            continue
          }
        }
        map[m.id] = sl
        continue
      }
      if (!prev) {
        if (mKey && floorByCourt[mKey]) {
          map[m.id] = floorByCourt[mKey]
        }
        continue
      }
      const prevLabel = (prev.schedule_label && /starting at/i.test(prev.schedule_label))
        ? prev.schedule_label
        : map[prev.id] ?? null
      if (!prevLabel) continue
      const parsed = parseAmPm(prevLabel)
      if (!parsed) continue
      const totalMins = parsed.h * 60 + parsed.m + 90
      map[m.id] = toAmPmLabel(Math.floor(totalMins / 60) % 24, totalMins % 60)
    }
    return map
  }, [scheduledMatches, allMatches, activeTournamentObj]) // eslint-disable-line

  const finishedMatches = filtered
    .filter(m => ['finished', 'retired', 'walkover', 'ended'].includes(m.status as string))
    .sort((a: any, b: any) => {
      const ca = a.court_order ?? 999
      const cb = b.court_order ?? 999
      if (ca !== cb) return ca - cb
      const ta = a.started_at ?? a.updated_at ?? ''
      const tb = b.started_at ?? b.updated_at ?? ''
      return tb.localeCompare(ta)
    })

  // ── Gender accent color ───────────────────────────────────────
  const genderColor = genderFilter === 'women' ? WOMEN_PURPLE : MEN_BLUE

  // Draw-tab gating: tier check only. The Draw tab itself handles its
  // own empty states — when no main-draw matches exist it shows "Main
  // draw not yet released" (Asuncion P2 with only Q1 round_canonical),
  // and when partial data exists the bracket builder renders placeholder
  // slots for missing matches.
  //
  // (An earlier version of this gate did a "≥80% completeness" check
  // against round_canonical, but the denominator naturally included
  // qualifying rounds and pushed the ratio below threshold for
  // tournaments with full main-draw data — Kuala Lumpur 31/51 = 61%.
  // Just trust the tier and let the tab render; the empty states cover
  // the rest.)
  const showDrawTab = useMemo(() => {
    if (!activeTournamentObj) return false
    return DRAW_TIERS.has(activeTournamentObj.level ?? '')
  }, [activeTournamentObj])

  // ══════════════════════════════════════════════════════════════
  // ── RENDER ────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════

  return (
    <div style={{ background: BG_BASE, minHeight: '100vh' }}>
      <main style={{
        background: BG_BASE, minHeight: '100vh',
        maxWidth: 500, margin: '0 auto',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        borderLeft: `0.5px solid ${BORDER}`,
        borderRight: `0.5px solid ${BORDER}`,
      }}>

        {/* Navbar — sticky bar with chrome + opacity-driven cover bg.
            The navbar's own background is rgba(10,10,10, p) so it's
            FULLY TRANSPARENT at scroll=0 (the hero's cover image renders
            through it from z=5 behind), and FULLY OPAQUE black at full
            collapse (covers whatever body content is scrolling past).
            ──
            paddingTop respects env(safe-area-inset-top) so the chrome
            row sits below the status bar / notch — capped at 12px so
            Android Capacitor edge-to-edge devices (which report a
            generous ~24-30pt inset) don't push the buttons unusually
            far from the top. iOS notched devices still get capped at
            12px which keeps the chrome readable while leaving more
            of the cover image visible at the top. */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 25,
          minHeight: HERO_COLLAPSED,
          paddingTop: 'env(safe-area-inset-top)',
          overflow: 'hidden',
          background: `rgba(10, 10, 10, ${navbarLayerOpacity})`,
        }}>
          {activeTournamentObj?.cover_image_url ? (
            <>
              <Image
                src={activeTournamentObj.cover_image_url}
                alt=""
                aria-hidden
                fill
                sizes="(max-width: 480px) 100vw, 500px"
                style={{
                  objectFit: 'cover',
                  objectPosition: 'center top',
                  zIndex: 0,
                  filter: 'brightness(0.35) saturate(0.7)',
                  opacity: navbarLayerOpacity,
                }}
              />
              <div aria-hidden style={{
                position: 'absolute', inset: 0, zIndex: 1,
                background: 'rgba(10,10,10,0.55)',
                opacity: navbarLayerOpacity,
                pointerEvents: 'none',
              }} />
            </>
          ) : null}

          {/* Chrome row — back, compact title (fades in), M/W toggle, compact FOLLOW (fades in).
              ──
              Layout-wise, the chrome row lives at y=env(safe-area-inset-top)
              (right below the status bar). That's correct for the SCROLLED
              state when the navbar is opaque and we need clearance under
              the status bar.
              At scroll=0 (hero expanded, navbar transparent), we visually
              pull the chrome row UP via translateY so it hugs the top of
              the screen — the chrome buttons sit ~12px from the very top
              of the viewport, partially overlapping the OS status bar
              text but on top of the cover image which provides enough
              contrast.
              The transform interpolates with heroProgress so the chrome
              row smoothly slides down into its full safe-area clearance
              as the user scrolls. transform doesn't affect layout, so
              tabs/hero positioning stays static. */}
          <div style={{
            position: 'relative', zIndex: 2,
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: '6px 16px 12px', height: HERO_COLLAPSED,
            transform: `translateY(calc(-1 * max(0px, env(safe-area-inset-top) - 12px) * ${1 - p}))`,
            willChange: 'transform',
          }}>
            <button
              onClick={() => { if (window.history.length > 1) router.back(); else router.push('/home') }}
              style={{
                width: 36, height: 36, border: 'none', cursor: 'pointer',
                // Match the opaque dark backing used by M/W and FOLLOW so
                // the chevron reads against any cover-image brightness.
                background: 'rgba(20,20,20,0.85)',
                clipPath: CHUNKY.badge,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', flexShrink: 0,
                padding: 0,
              }}
              aria-label={tCommon('back')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>

            {/* Compact title — fades in over progress 0.55 → 0.95 */}
            <span
              aria-hidden={compactOpacity < 0.05}
              style={{
                flex: 1, minWidth: 0,
                fontSize: 18, fontWeight: 800, letterSpacing: -0.3,
                color: '#fff',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                opacity: compactOpacity,
              }}
            >
              {activeTournamentObj ? titleCase(activeTournamentObj.name) : 'Tournament Detail'}
            </span>

            {/* M/W toggle — always visible (was previously gated by
                compactOpacity). Opaque dark background reads against
                any poster brightness, even with a transparent navbar.
                marginTop offsets the toggle a few px below the back
                button so the pair (M/W + FOLLOW) doesn't crowd against
                the very top edge of the navbar. */}
            <div style={{ flexShrink: 0, marginTop: 4 }}>
              <div
                onClick={() => setGenderFilter(g => g === 'men' ? 'women' : 'men')}
                style={{
                  display: 'inline-flex', alignItems: 'center', cursor: 'pointer',
                  background: 'rgba(20,20,20,0.85)',
                  clipPath: CHUNKY.badge,
                  padding: '4px 6px', position: 'relative', width: 56, height: 28,
                  flexShrink: 0,
                }}
              >
                <div style={{
                  position: 'absolute', top: 3,
                  left: genderFilter === 'men' ? 4 : 28,
                  width: 24, height: 22,
                  background: genderFilter === 'women' ? WOMEN_PURPLE : MEN_BLUE,
                  clipPath: CHUNKY.badge,
                  transition: 'left 0.2s ease, background 0.2s ease',
                }} />
                <span style={{
                  flex: 1, textAlign: 'center', fontSize: 11, fontWeight: 800,
                  position: 'relative', zIndex: 1,
                  color: genderFilter === 'men' ? '#000' : MUTED,
                  transition: 'color 0.2s',
                }}>M</span>
                <span style={{
                  flex: 1, textAlign: 'center', fontSize: 11, fontWeight: 800,
                  position: 'relative', zIndex: 1,
                  color: genderFilter === 'women' ? '#000' : MUTED,
                  transition: 'color 0.2s',
                }}>W</span>
              </div>
            </div>

            {/* FOLLOW — always visible. Same opaque dark background as
                M/W so the pair reads as one cluster. marginTop matches
                the toggle's offset above. */}
            {activeTournamentObj ? (
              <div style={{ flexShrink: 0, marginTop: 4 }}>
                <FollowButton
                  type="tournament"
                  targetId={activeTournamentObj.id}
                  variant="follow"
                  style={{ background: 'rgba(20,20,20,0.85)', color: '#fff' }}
                />
              </div>
            ) : null}
          </div>
        </div>

        {/* Expanded hero — pulled up to overlap the navbar at scroll=0,
            scrolls away naturally as the user scrolls.
            ──
            marginTop pulls past BOTH the chrome row (HERO_COLLAPSED)
            AND the safe-area inset, so the cover image fills behind
            the status bar / notch too. Without the safe-area offset,
            the transparent navbar's top region would let the page
            background bleed through as a gray bar on notched devices. */}
        <div style={{
          position: 'relative', zIndex: 5,
          height: HERO_EXPANDED,
          marginTop: `calc(-1 * (env(safe-area-inset-top) + ${HERO_COLLAPSED}px))`,
          overflow: 'hidden',
          background: '#0A0A0A',
        }}>
          {activeTournamentObj?.cover_image_url ? (
            <>
              <TournamentCoverImage
                src={activeTournamentObj.cover_image_url}
                alt={activeTournamentObj.name}
                variant="hero"
                sizes="(max-width: 480px) 100vw, 500px"
                priority
              />
              <div aria-hidden style={{
                position: 'absolute', inset: 0, zIndex: 1,
                background: 'linear-gradient(180deg, rgba(10,10,10,0.40) 0%, rgba(10,10,10,0.15) 30%, rgba(10,10,10,0.92) 100%)',
                pointerEvents: 'none',
              }} />
            </>
          ) : null}

          {/* V1 Broadcast identity block at bottom-left.
              Layout (revised 2026-05-19 for readability):
                [kicker pill]
                [flag] [title]              [FOLLOW]
                [pin icon] venue
                dates · prize
              Two metadata rows instead of one cramped line; flag is
              inline with the title to anchor identity prominently. */}
          {activeTournamentObj ? (
            <div style={{
              position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 3,
              padding: '14px 16px 18px',
            }}>
              {/* Kicker pill — level indicator above title.
                  M/W + FOLLOW now live in the chrome navbar (always
                  visible) so the title row gets full width. */}
              {activeTournamentObj.level ? (() => {
                const pill = getTierPill(activeTournamentObj.level)
                return (
                  <span style={{
                    display: 'inline-block',
                    fontSize: 10, fontWeight: 800,
                    color: pill.color,
                    background: pill.background,
                    clipPath: CHUNKY.badge,
                    padding: '4px 12px',
                    letterSpacing: 0.7,
                    textTransform: 'uppercase',
                  }}>
                    {levelLabel(activeTournamentObj.level)}
                  </span>
                )
              })() : null}

              {/* Title row: flag + title (full width — no inline
                  controls; SEGUIR and M/W live in the chrome navbar). */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                marginTop: 6,
              }}>
                {activeTournamentObj.country ? (
                  <FlagImage country={activeTournamentObj.country} size={24} />
                ) : null}
                <div style={{
                  flex: 1, minWidth: 0,
                  fontSize: 26, fontWeight: 900,
                  lineHeight: 1.05, letterSpacing: -0.5,
                  color: '#fff',
                  textShadow: '0 2px 8px rgba(0,0,0,0.45)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {titleCase(activeTournamentObj.name)}
                </div>
              </div>

              {/* Meta row 1 — venue */}
              {activeTournamentObj.venue ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  marginTop: 8,
                }}>
                  <svg width="11" height="13" viewBox="0 0 24 28" fill="none"
                    stroke="rgba(255,255,255,0.7)" strokeWidth="2.5" strokeLinecap="round"
                    style={{ flexShrink: 0 }}
                  >
                    <path d="M12 2C7.58 2 4 5.58 4 10c0 6.63 8 16 8 16s8-9.37 8-16c0-4.42-3.58-8-8-8z"/>
                    <circle cx="12" cy="10" r="2.5" fill="rgba(255,255,255,0.7)" stroke="none"/>
                  </svg>
                  <span style={{
                    fontSize: 12, fontWeight: 600,
                    color: 'rgba(255,255,255,0.92)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    textShadow: '0 1px 4px rgba(0,0,0,0.4)',
                  }}>
                    {activeTournamentObj.venue}
                  </span>
                </div>
              ) : null}

              {/* Meta row 2 — dates · prize */}
              {(activeTournamentObj.starts_at || activeTournamentObj.prize_money_fip || activeTournamentObj.prize_money) ? (
                <div style={{
                  fontSize: 12, fontWeight: 600,
                  color: 'rgba(255,255,255,0.78)',
                  marginTop: 4,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  textShadow: '0 1px 4px rgba(0,0,0,0.4)',
                }}>
                  {(() => {
                    const parts: string[] = []
                    if (activeTournamentObj.starts_at && activeTournamentObj.ends_at) {
                      parts.push(
                        `${format.dateTime(new Date(activeTournamentObj.starts_at), DATE_SHORT)} – ${format.dateTime(new Date(activeTournamentObj.ends_at), DATE_SHORT)}`
                      )
                    }
                    if (activeTournamentObj.prize_money_fip && activeTournamentObj.prize_money_fip > 0) {
                      parts.push(`€${activeTournamentObj.prize_money_fip.toLocaleString()}`)
                    } else {
                      const raw = activeTournamentObj.prize_money?.trim()
                      if (raw && !/^[^\d]*0$/.test(raw)) parts.push(raw)
                    }
                    return parts.join(' · ')
                  })()}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Tabs — sticky just below the navbar. Top offset matches the
            navbar's effective height (62px + safe-area) so tabs stick
            flush below the chrome row on devices with a notch / status
            bar. Sliding ink-bar handled by <SlidingInkTabs>. */}
        <SlidingInkTabs
          tabs={(['overview', 'story', 'matches', ...(showDrawTab ? ['draw'] as const : [])] as const).map(tab => ({
            key: tab,
            label: tTournament(tab),
          }))}
          activeKey={pageTab}
          onChange={setPageTab}
          containerStyle={{
            position: 'sticky',
            top: `calc(env(safe-area-inset-top) + ${HERO_COLLAPSED}px)`,
            zIndex: 19,
            background: '#0A0A0A',
            borderBottom: `1px solid ${BORDER}`,
          }}
        />

        {/* Coverage disclaimer */}
        {activeTournamentObj && !FULL_COVERAGE_LEVELS.has(activeTournamentObj.level ?? '') && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 16px',
            fontSize: 11, color: MUTED,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
            </svg>
            <span>{tTournament('noPbpCoverage')}</span>
          </div>
        )}

        {/* Stage selector strip (matches tab only) */}
        {pageTab === 'matches' && availableRounds.length > 0 && (
          <div ref={stageStripRef} style={{
            display: 'flex', gap: 6, padding: '8px 16px 10px',
            overflowX: 'auto', scrollbarWidth: 'none',
          }}>
            {availableRounds.map(round => {
              const active = round === selectedRound
              const hasLive = allMatches.some(m =>
                m.status === 'live' &&
                normalizeRoundFull(m.round as string) === round &&
                (!activeTournament || (m as any).tournament?.id === activeTournament)
              )
              return (
                <button
                  key={round}
                  data-active={active ? 'true' : undefined}
                  onClick={() => setSelectedRound(round)}
                  style={{
                    flexShrink: 0,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                    padding: '6px 14px',
                    clipPath: CHUNKY.button,
                    border: 'none',
                    background: active ? 'rgba(126,211,33,0.12)' : 'rgba(255,255,255,0.04)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    {hasLive && (
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: LIVE_RED, flexShrink: 0, animation: 'v3-pulse 2s infinite' }} />
                    )}
                    <span style={{
                      fontSize: 11, fontWeight: 800, letterSpacing: 0.5,
                      color: active ? GREEN : MUTED,
                      textTransform: 'uppercase',
                    }}>
                      {round}
                    </span>
                  </div>
                  {roundDates[round] && (
                    <span style={{
                      fontSize: 8, letterSpacing: 0.2,
                      color: active ? 'rgba(126,211,33,0.7)' : 'rgba(255,255,255,0.2)',
                      textTransform: 'uppercase',
                    }}>
                      {roundDates[round]}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* ── Matches Feed ── */}
        {pageTab === 'matches' && (
          <div style={{ padding: '8px 12px 16px' }}>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <MatchCardSkeleton key={i} />
              ))
            ) : (
              <>
                {liveMatches.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <SectionHeader
                      label="Live now" dot color={LIVE_RED}
                      right={syncAgo}
                      rightColor={justUpdated ? GREEN : undefined}
                    />
                    {liveMatches.map(m => (
                      <MatchCard key={m.id} match={m} genderColor={genderColor} locale={locale} userTz={userTz} tournamentLevel={activeTournamentObj?.level} />
                    ))}
                  </div>
                )}

                {warmingUpMatches.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <SectionHeader dot color={ORANGE} label="Warming up" />
                    {warmingUpMatches.map(m => (
                      <MatchCard key={m.id} match={m} genderColor={genderColor} locale={locale} userTz={userTz} tournamentLevel={activeTournamentObj?.level} />
                    ))}
                  </div>
                )}

                {scheduledMatches.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <SectionHeader label="Up next" />
                    {scheduledMatches.map(m => (
                      <MatchCard key={m.id} match={m} genderColor={genderColor} locale={locale} userTz={userTz} estimatedLabel={estimatedLabels[m.id]} tournamentLevel={activeTournamentObj?.level} />
                    ))}
                  </div>
                )}

                {finishedMatches.length > 0 && (
                  <div>
                    <SectionHeader label={`Results \u00B7 ${selectedRound ?? ''}`} />
                    {finishedMatches.map(m => (
                      <MatchCard key={m.id} match={m} genderColor={genderColor} locale={locale} userTz={userTz} tournamentLevel={activeTournamentObj?.level} />
                    ))}
                  </div>
                )}

                {liveMatches.length === 0 && warmingUpMatches.length === 0 && scheduledMatches.length === 0 && finishedMatches.length === 0 && (
                  <div style={{ paddingTop: 24 }}>
                    {(() => {
                      const sched = ((activeTournamentObj as any)?.round_schedule ?? {}) as Record<string, string>
                      const key = selectedRound ? ROUND_LABEL_TO_KEY[selectedRound] : null
                      const isPlaceholder = !!(key && sched[key])
                      return (
                        <EmptyState
                          title={tTournament(isPlaceholder ? 'placeholder.headline' : 'noMatchesForStage')}
                          subtitle={tTournament(isPlaceholder ? 'placeholder.body' : 'tryDifferentRound')}
                        />
                      )
                    })()}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Overview Tab ── */}
        {pageTab === 'overview' && (
          <V3Overview
            tournament={activeTournamentObj}
            allMatches={allMatches}
            genderFilter={genderFilter}
            genderColor={genderColor}
            availableRounds={availableRounds}
            roundDates={roundDates}
            liveCount={liveCount}
          />
        )}

        {/* ── Story Tab (editorial preview/recap + winner card) ──
            Always mounted (not tab-conditional) so the editorial text is
            in the DOM for Googlebot regardless of which tab is active.
            CSS display toggle handles visual tab switching. */}
        <div style={{ display: pageTab === 'story' ? 'block' : 'none' }}>
          <V3Story
            tournament={activeTournamentObj}
            allMatches={allMatches}
            genderFilter={genderFilter}
            genderColor={genderColor}
            locale={locale}
            userTz={userTz}
          />
        </div>

        {/* ── Draw Tab ── */}
        {pageTab === 'draw' && activeTournamentObj && showDrawTab && (
          <DrawTab
            tournamentId={tournamentId}
            matches={allMatches.filter(m => (m as any).category === genderFilter)}
            category={genderFilter}
            defendingChamp={null}
            preMainDrawDate={(activeTournamentObj as any).round_schedule?.r32 ?? (activeTournamentObj as any).round_schedule?.r16 ?? null}
            onSwitchToMatchesTab={() => setPageTab('matches')}
          />
        )}
      </main>

      {/* Keyframes */}
      <style>{`
        @keyframes v3-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// ── Section Header ──────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

function SectionHeader({ label, color, dot, right, rightColor }: {
  label: string; color?: string; dot?: boolean; right?: string; rightColor?: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 2px 8px' }}>
      {dot && <span style={{ width: 5, height: 5, borderRadius: '50%', background: color ?? MUTED, flexShrink: 0, animation: 'v3-pulse 2s infinite' }} />}
      <span style={{ fontSize: 9, color: color ?? MUTED, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: color ? `${color}18` : BORDER }} />
      {right && <span style={{ fontSize: 9, color: rightColor ?? 'rgba(255,255,255,0.2)', whiteSpace: 'nowrap', transition: 'color 0.4s ease' }}>{right}</span>}
    </div>
  )
}

// Single-line label/value row used by the Tournament Info card.
function InfoRow({
  icon, label, value, multiline = false, valueAccent,
}: {
  icon: React.ReactNode
  label: string
  value: string
  multiline?: boolean
  valueAccent?: string
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: multiline ? 'flex-start' : 'center',
      gap: 10,
      padding: '9px 0',
      borderBottom: `0.5px solid ${BORDER}`,
    }}>
      <span style={{ flexShrink: 0, color: MUTED, paddingTop: multiline ? 2 : 0 }}>{icon}</span>
      <span style={{ fontSize: 10, fontWeight: 700, color: MUTED, letterSpacing: 0.3, textTransform: 'uppercase', minWidth: 70, flexShrink: 0 }}>{label}</span>
      <span style={{
        fontSize: 12, fontWeight: 600,
        color: valueAccent ?? '#fff',
        flex: 1, minWidth: 0,
        wordBreak: multiline ? 'break-word' : 'normal',
        whiteSpace: multiline ? 'normal' : 'nowrap',
        overflow: multiline ? 'visible' : 'hidden',
        textOverflow: multiline ? 'clip' : 'ellipsis',
      }}>
        {value}
      </span>
    </div>
  )
}


// ══════════════════════════════════════════════════════════════
// ── Overview Tab ────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

interface DefendingChampion {
  year: number
  names: string
  country1: string | null
  country2: string | null
  /** Tournament id of the previous edition, so users can open it. */
  previousTournamentId?: string | null
}

// Shared tile used by both "Champion" and "Defending Champion" rows.
// Accent color differentiates them (green for current, orange for previous).
// When `clickable` is true, an arrow appears on the right — the caller is
// expected to wrap the tile in a Link / onClick handler.
function ChampionTile({
  label, year, names, country1, country2, accent, clickable = false,
}: {
  label: string
  year: number
  names: string
  country1: string | null
  country2: string | null
  accent: string
  clickable?: boolean
}) {
  // Convert any CSS color to rgba-ish tints for background + border.
  // For our two known accents (GREEN, ORANGE) we hand-code the tints.
  const tint = accent === GREEN
    ? {
        gradient: 'linear-gradient(135deg, rgba(126,211,33,0.22), rgba(126,211,33,0.08))',
        border: 'rgba(126,211,33,0.35)',
        innerGlow: 'rgba(126,211,33,0.1)',
      }
    : {
        gradient: 'linear-gradient(135deg, rgba(245,166,35,0.22), rgba(245,166,35,0.08))',
        border: 'rgba(245,166,35,0.35)',
        innerGlow: 'rgba(245,166,35,0.1)',
      }

  return (
    <div style={{
      background: BG_CARD,
      clipPath: CHUNKY.card,
      border: `1px solid ${BORDER}`,
      padding: '14px 16px',
      marginBottom: 10,
      display: 'flex', alignItems: 'center', gap: 14,
      cursor: clickable ? 'pointer' : 'default',
    }}>
      {/* Chunky trophy tile */}
      <div style={{
        width: 48, height: 48, flexShrink: 0,
        background: tint.gradient,
        clipPath: CHUNKY.badge,
        border: `1px solid ${tint.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 24,
        boxShadow: `inset 0 0 0 1px ${tint.innerGlow}`,
      }}>
        🏆
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 9, color: accent, fontWeight: 800,
          textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span>{label}{year ? ` · ${year}` : ''}</span>
          {clickable && (
            <span style={{ fontSize: 9, color: accent, opacity: 0.7 }}>· VIEW EDITION</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {/* Stacked overlapping flags — same pattern as latest results cards */}
          <div style={{ position: 'relative', width: 26, height: 20, flexShrink: 0 }}>
            <div style={{ position: 'absolute', top: 0, left: 0, zIndex: 2 }}>
              <FlagImage country={country1} size={16} />
            </div>
            <div style={{ position: 'absolute', top: 6, left: 8, zIndex: 1 }}>
              <FlagImage country={country2} size={16} />
            </div>
          </div>
          <span style={{
            fontSize: 13, fontWeight: 700, color: '#fff',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {names}
          </span>
        </div>
      </div>

      {clickable && (
        <span style={{
          fontSize: 16, fontWeight: 800, color: accent,
          flexShrink: 0, marginLeft: 4,
        }}>
          →
        </span>
      )}
    </div>
  )
}

function V3Overview({ tournament, allMatches, genderFilter, genderColor, availableRounds, roundDates, liveCount }: {
  tournament: any
  allMatches: Match[]
  genderFilter: 'men' | 'women'
  genderColor: string
  availableRounds: string[]
  roundDates: Record<string, string>
  liveCount: number
}) {
  const format = useFormatter()
  const tTournament = useTranslations('tournament')
  const genderMatches = allMatches.filter(m => (m as any).category === genderFilter)
  const totalMatches = genderMatches.length

  // ── Current tournament champion (if the final has been played) ──
  // Derived directly from allMatches — no extra fetch needed.
  const currentChampion: DefendingChampion | null = useMemo(() => {
    const finishedStatuses = new Set(['finished', 'retired', 'walkover'])
    const finalMatch = genderMatches.find(m =>
      finishedStatuses.has(m.status as string) &&
      (m as any).winner_pair != null &&
      normalizeRoundFull((m as any).round as string) === 'Finals'
    )
    if (!finalMatch) return null
    const wp = (finalMatch as any).winner_pair
    const winners = wp === 1
      ? [(finalMatch as any).pair1_player1, (finalMatch as any).pair1_player2]
      : [(finalMatch as any).pair2_player1, (finalMatch as any).pair2_player2]
    const winnerPlayers = winners.filter(Boolean)
    if (winnerPlayers.length === 0) return null
    const names = winnerPlayers.map((p: any) => toShortName(p.display_name?.trim() || p.name)).join(' / ')
    const country1 = winnerPlayers[0]?.country ?? null
    const country2 = winnerPlayers[1]?.country ?? null
    const year = tournament?.ends_at ? new Date(tournament.ends_at).getFullYear() : 0
    return { year, names, country1, country2 }
  }, [genderMatches, tournament?.ends_at])

  // ── Previous edition + defending champion lookup ──────────────
  // Find the most recent previous edition of this tournament (same level,
  // same name ignoring year tokens, ending before the current one's start).
  // If found, try to extract its Final winner for the selected category.
  //
  // `previousEdition` is set as soon as we find the tournament row, so the
  // user can always navigate to it — even if we can't resolve the champion.
  const [previousEdition, setPreviousEdition] = useState<{ id: string; year: number } | null>(null)
  const [defendingChampion, setDefendingChampion] = useState<DefendingChampion | null>(null)

  // ── Where to Watch ────────────────────────────────────────────
  const [wtwBroadcasters, setWtwBroadcasters] = useState<BroadcasterRow[]>([])
  const [wtwLiveChannels, setWtwLiveChannels] = useState<LiveChannel[]>([])
  const [wtwChannelsMeta, setWtwChannelsMeta] = useState<ChannelMeta[]>([])
  const [wtwGeoCountry, setWtwGeoCountry] = useState<string | null>(null)
  const [wtwFallback, setWtwFallback] = useState<{ url: string; tournamentName: string } | null>(null)

  const tournamentChannelAbbr = useMemo(
    () => levelToChannelAbbr(tournament?.level),
    [tournament?.level],
  )

  useEffect(() => {
    // Read geo-country cookie client-side (server proxy sets this from x-vercel-ip-country)
    const cookieMatch = typeof document !== 'undefined'
      ? document.cookie.match(/(?:^|;\s*)geo-country=([^;]*)/)
      : null
    const country = cookieMatch?.[1]?.toLowerCase() || null
    setWtwGeoCountry(country)

    // Skip entirely if no tournament yet or its level doesn't map to a tracked
    // circuit (e.g. legacy WPT). Keeps behaviour conservative for tiers we
    // haven't decided to surface streams for.
    if (!tournament || !tournamentChannelAbbr) {
      setWtwBroadcasters([])
      setWtwLiveChannels([])
      setWtwChannelsMeta([])
      setWtwFallback(null)
      return
    }

    let cancelled = false
    const STALE_MS = 30 * 60 * 1000
    const tournamentNameTokens = tokenize(tournament.name)
    const tournamentId = tournament.id
    const tournamentName = tournament.name
    const tournamentLevel = tournament.level

    // Opt into the FIP-channel title-token heuristic *only* for currently-
    // active tournaments. The window [starts_at, ends_at + 24h] is wide
    // enough to cover late finals on the final day but tight enough to
    // exclude past editions of the same event still in the DB. Past
    // editions are the original false-positive concern the strict-
    // attribution rule was built around — gating on the active window
    // neutralises that risk.
    //
    // If either date is missing we leave the flag off (defensive — we
    // can't temporally place this tournament safely).
    const nowMs = Date.now()
    const startsAtMs = tournament.starts_at ? new Date(tournament.starts_at).getTime() : null
    const endsAtMs = tournament.ends_at ? new Date(tournament.ends_at).getTime() : null
    const applyFipHeuristic =
      startsAtMs != null && endsAtMs != null &&
      nowMs >= startsAtMs &&
      nowMs <= endsAtMs + 24 * 60 * 60 * 1000

    // Fetch all active broadcasters (across countries) so the region
    // picker can switch without a round-trip; buildGroups filters by
    // the effective country at render time.
    const broadcastersP = supabase
      .from('broadcasters')
      .select('id, name, url, logo_url, is_free, display_order, country_iso2, channel_id')
      .eq('active', true)
      .not('channel_id', 'is', null)
      .order('country_iso2', { ascending: true })
      .order('display_order', { ascending: true })
      .order('is_free', { ascending: false })

    // Live channels across ALL active YouTube channels (no abbreviation
    // filter). Per-tournament filtering happens in-memory via
    // filterTournamentStreams once all queries resolve.
    const liveChannelsP = supabase
      .from('youtube_channel_live')
      .select(`video_id, title, channel:youtube_channels!inner(id, name, abbreviation, color_hex, display_order)`)
      .gt('last_seen_at', new Date(Date.now() - STALE_MS).toISOString())
      .eq('channel.is_active', true)

    // All active channels' metadata (no abbreviation filter — broadcaster-only
    // groups still need channel meta to render even when a channel isn't
    // currently live).
    const channelsMetaP = supabase
      .from('youtube_channels')
      .select('id, name, abbreviation, color_hex, display_order')
      .eq('is_active', true)

    // Canonical FIP TOUR attribution: video IDs explicitly mapped to this
    // tournament (manual ops backfills + anything the discovery cron ever
    // attributed). Always wins inside filterTournamentStreams, so an
    // operator-set row beats heuristic guesses even when both would match.
    //
    // For tournaments inside their active window we *also* apply a title-
    // token heuristic on top — that's what surfaces live FIP TOUR videos
    // the attribution pipeline never produced (see applyFipHeuristic above
    // and filter-tournament-streams.ts for the long-form rationale).
    //
    // No `state` filter on purpose — youtube_channel_live is pruned ~30 min
    // after a video goes offline, so archived attribution IDs can never
    // appear in the live set we intersect against.
    const attributedP = supabase
      .from('fip_court_streams')
      .select('youtube_video_id')
      .eq('tournament_id', tournamentId)

    Promise.all([broadcastersP, liveChannelsP, channelsMetaP, attributedP]).then(([bRes, lcRes, cmRes, attRes]) => {
      if (cancelled) return
      setWtwBroadcasters(((bRes.data ?? []) as BroadcasterRow[]))

      const allLiveVideos = (lcRes.data ?? []).map((r: any) => {
        const ch = Array.isArray(r.channel) ? r.channel[0] : r.channel
        if (!ch) return null
        return {
          videoId: r.video_id as string,
          title: r.title as string,
          channel: {
            id: ch.id as string,
            name: ch.name as string,
            abbreviation: ch.abbreviation as string,
            colorHex: ch.color_hex as string,
            displayOrder: ch.display_order as number,
          },
        }
      }).filter((x: LiveChannel | null): x is LiveChannel => x !== null)

      const attributedSet = new Set(
        (attRes.data ?? []).map((r: any) => r.youtube_video_id as string)
      )

      const filteredLive = filterTournamentStreams({
        liveVideos: allLiveVideos,
        attributedVideoIds: attributedSet,
        tournamentNameTokens,
        applyFipHeuristic,
      })
      setWtwLiveChannels(filteredLive)

      const channelsMeta = (cmRes.data ?? []).map((r: any) => ({
        id: r.id as string,
        name: r.name as string,
        abbreviation: r.abbreviation as string,
        colorHex: r.color_hex as string,
        displayOrder: r.display_order as number,
      }))
      setWtwChannelsMeta(channelsMeta)

      // FIP-TOUR-only fallback: when nothing matched and this is an FIP-tier
      // tournament, surface a single tournament-scoped channel-search row.
      // Premier and other tiers do NOT get a fallback (the search URL is FIP
      // TOUR's handle — would mislead on a Premier page).
      if (filteredLive.length === 0 && isFipTier(tournamentLevel)) {
        setWtwFallback({
          url: tournamentSearchUrl(tournamentName),
          tournamentName,
        })
      } else {
        setWtwFallback(null)
      }
    }).catch(err => {
      if (cancelled) return
      console.warn('[tournament:wtw] fetch failed:', err)
      setWtwFallback(null)
    })

    return () => { cancelled = true }
  }, [tournament?.id, tournament?.name, tournament?.level, tournamentChannelAbbr])

  useEffect(() => {
    if (!tournament?.id || !tournament?.name || !tournament?.level || !tournament?.starts_at) return
    let cancelled = false

    // Strip diacritics so "Cancún" and "Cancun" tokenize the same.
    const stripAccents = (s: string): string =>
      s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

    // Tokenize a tournament name into its meaningful words.
    // - strips diacritics so accent variants (Cancún / Cancun) line up
    // - strips 4-digit years (2025, 2026)
    // - drops generic/sponsor noise words that vary across editions
    // - lowercases, splits on non-alphanumerics
    //
    // Example:
    //   "Motorola Razr Miami Premier Padel P1" → {motorola, razr, miami, p1}
    //   "Miami P1 2026"                         → {miami, p1}
    const NOISE_TOKENS = new Set([
      'premier', 'padel', 'tour', 'open', 'the', 'by', 'presented',
      'pro', 'vip', 'official', 'season', 'championship', 'championships',
    ])
    const tokenize = (n: string): Set<string> => {
      return new Set(
        stripAccents(n)
          .toLowerCase()
          .replace(/\b(19|20)\d{2}\b/g, '')
          .replace(/[^a-z0-9]+/g, ' ')
          .split(/\s+/)
          .filter(w => w.length >= 2 && !NOISE_TOKENS.has(w))
      )
    }

    const currentTokens = tokenize(tournament.name)
    if (currentTokens.size < 2) return // too generic to match safely

    async function loadDefendingChampion() {
      try {
        // Pick the longest current token as the LIKE filter so we fetch a
        // narrow candidate list (common tokens like "p1" are too broad).
        const discriminating = [...currentTokens]
          .filter(t => t.length >= 3)
          .sort((a, b) => b.length - a.length)[0]
          ?? [...currentTokens][0]

        // ILIKE is accent-sensitive in Postgres, so match both the stripped
        // form and the accented form (if they differ) to catch cross-year
        // accent variants like "Cancún" vs "Cancun".
        const originalWords = (tournament!.name as string)
          .toLowerCase()
          .match(/[\p{L}\p{N}]+/gu) ?? []
        const accented = originalWords.find(w => stripAccents(w) === discriminating) ?? discriminating
        const orFilter = discriminating === accented
          ? `name.ilike.%${discriminating}%`
          : `name.ilike.%${discriminating}%,name.ilike.%${accented}%`

        const { data: candidates } = await supabase
          .from('tournaments')
          .select('id, name, starts_at, ends_at')
          .eq('level', tournament!.level)
          .lt('ends_at', tournament!.starts_at)
          .or(orFilter)
          .order('ends_at', { ascending: false })
          .limit(50)
        if (cancelled || !candidates || candidates.length === 0) return

        // Subset match: every current token must appear in the candidate's
        // tokens. This handles sponsor prefixes (2025 "Motorola Razr Miami
        // Premier Padel P1" contains all of {miami, p1}).
        const previous = candidates.find(c => {
          const candTokens = tokenize(c.name)
          for (const t of currentTokens) {
            if (!candTokens.has(t)) return false
          }
          return true
        })
        if (!previous) return

        // Record the previous edition id immediately so the user can navigate
        // to it even if the champion lookup below comes up empty.
        const previousYear = previous.ends_at ? new Date(previous.ends_at).getFullYear() : 0
        if (!cancelled) setPreviousEdition({ id: previous.id, year: previousYear })

        // Fetch finished matches from that edition for the current category
        // and pick the one in the Final round.
        const { data: finalMatches } = await supabase
          .from('matches')
          .select(`
            id, round, winner_pair, status, category,
            pair1_player1:players!matches_pair1_player1_id_fkey(name, display_name, country),
            pair1_player2:players!matches_pair1_player2_id_fkey(name, display_name, country),
            pair2_player1:players!matches_pair2_player1_id_fkey(name, display_name, country),
            pair2_player2:players!matches_pair2_player2_id_fkey(name, display_name, country)
          `)
          .eq('tournament_id', previous.id)
          .eq('category', genderFilter)
          .in('status', ['finished', 'retired', 'walkover'])
          .not('winner_pair', 'is', null)
        if (cancelled || !finalMatches || finalMatches.length === 0) return

        const final = finalMatches.find(m => normalizeRoundFull((m as any).round as string) === 'Finals')
        if (!final) return

        const winners = (final as any).winner_pair === 1
          ? [(final as any).pair1_player1, (final as any).pair1_player2]
          : [(final as any).pair2_player1, (final as any).pair2_player2]
        const winnerPlayers = winners.filter(Boolean)
        if (winnerPlayers.length === 0) return

        const names = winnerPlayers.map((p: any) => toShortName(p.display_name?.trim() || p.name)).join(' / ')
        const country1 = winnerPlayers[0]?.country ?? null
        const country2 = winnerPlayers[1]?.country ?? null
        const year = previous.ends_at ? new Date(previous.ends_at).getFullYear() : 0
        if (cancelled) return
        setDefendingChampion({ year, names, country1, country2, previousTournamentId: previous.id })
      } catch (e) {
        console.warn('[V3Overview] defending champion lookup failed:', e)
      }
    }

    // Clear stale values from a different tournament/category before fetching.
    setPreviousEdition(null)
    setDefendingChampion(null)
    void loadDefendingChampion()
    return () => { cancelled = true }
  }, [tournament?.id, tournament?.name, tournament?.level, tournament?.starts_at, genderFilter])

  // Count unique teams from match data.
  const teamSet = new Set<string>()
  for (const m of genderMatches) {
    const p1 = [(m as any).pair1_player1?.name, (m as any).pair1_player2?.name].filter(Boolean).sort().join('/')
    const p2 = [(m as any).pair2_player1?.name, (m as any).pair2_player2?.name].filter(Boolean).sort().join('/')
    if (p1) teamSet.add(p1)
    if (p2) teamSet.add(p2)
  }
  const totalTeams = teamSet.size

  // Count unique countries from match data.
  const countrySet = new Set<string>()
  for (const m of genderMatches) {
    for (const key of ['pair1_player1', 'pair1_player2', 'pair2_player1', 'pair2_player2'] as const) {
      const country = (m as any)[key]?.country as string | undefined
      if (country) countrySet.add(country)
    }
  }
  const totalCountries = countrySet.size

  // Total match count — prefer the live match count; otherwise compute
  // from the tournament's main-draw size (single-elimination → N-1 matches)
  // so upcoming events surface the right expected number.
  const expectedMatches = (() => {
    const drawSize = (tournament as any)?.draw_size_md as number | undefined
    if (drawSize && drawSize > 0) return drawSize - 1
    return 0
  })()
  const displayMatches = totalMatches || expectedMatches

  // Schedule — derived from the matches table so it works for every
  // tournament, not just the ~10% with a published factsheet PDF.
  const schedule = availableRounds.map(round => {
    const count = genderMatches.filter(m => normalizeRoundFull(m.round as string) === round).length
    return { round, date: roundDates[round] ?? '', count }
  })

  const StatCard = ({ value, label, accent }: { value: string | number; label: string; accent?: boolean }) => (
    <div style={{
      background: BG_CARD,
      clipPath: CHUNKY.card,
      border: `1px solid ${BORDER}`,
      padding: 14, textAlign: 'center',
    }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent ? GREEN : '#fff' }}>{value}</div>
      <div style={{ fontSize: 10, color: MUTED, marginTop: 3, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase' }}>{label}</div>
    </div>
  )

  // Tournament dates
  const startsAt = tournament?.starts_at ? new Date(tournament.starts_at) : null
  const endsAt = tournament?.ends_at ? new Date(tournament.ends_at) : null
  const now = new Date()
  const daysUntilStart = startsAt ? Math.ceil((startsAt.getTime() - now.getTime()) / 86400000) : null
  const isUpcoming = daysUntilStart != null && daysUntilStart > 0
  // Has any Final match (men or women) been played out? Same signal the
  // ops Tournament Explorer uses for the "Live now" tile — events often
  // finish on the penultimate day of their calendar window, and `ends_at`
  // doesn't catch up until the next sync. Using only date-range +
  // liveCount made tournaments show "Ongoing" all day after the final
  // had already happened (Brussels P2 2026-04-27).
  const finalPlayed = useMemo(() => {
    const finishedStatuses = new Set(['finished', 'retired', 'walkover'])
    return allMatches.some(m => {
      if (!finishedStatuses.has(m.status as string)) return false
      if ((m as any).winner_pair == null) return false
      const r = ((m as any).round as string ?? '').trim().split(/\s+/).pop()?.toLowerCase() ?? ''
      return r === 'f' || r === 'final' || r === 'finals'
    })
  }, [allMatches])

  const isInDateRange = !!(startsAt && endsAt && now >= startsAt && now <= endsAt)
  const isLive = isInDateRange && liveCount > 0 && !finalPlayed
  const isOngoing = isInDateRange && liveCount === 0 && !finalPlayed

  const formatDate = (d: Date) => format.dateTime(d, DATE_WITH_WEEKDAY)

  return (
    <div style={{ padding: '14px 14px 20px' }}>
      {/* Tournament timing banner */}
      {startsAt && (
        <div style={{
          background: isLive ? 'rgba(255,69,85,0.08)' : isOngoing ? 'rgba(245,166,35,0.08)' : isUpcoming ? 'rgba(126,211,33,0.08)' : 'rgba(255,255,255,0.04)',
          borderLeft: `3px solid ${isLive ? LIVE_RED : isOngoing ? ORANGE : isUpcoming ? GREEN : MUTED}`,
          borderRadius: 4, padding: '10px 14px', marginBottom: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>
              {isLive ? tTournament('tournamentInProgress') : isOngoing ? tTournament('tournamentInProgress') : isUpcoming ? tTournament('mainDrawStarts') : tTournament('tournamentEnded')}
            </div>
            <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
              {formatDate(startsAt)}{endsAt ? ` — ${formatDate(endsAt)}` : ''}
            </div>
          </div>
          {isUpcoming && daysUntilStart != null && (
            <div style={{
              fontSize: 13, fontWeight: 800,
              color: daysUntilStart <= 2 ? '#FF4655' : daysUntilStart <= 7 ? '#F5A623' : GREEN,
            }}>
              {daysUntilStart === 1 ? tTournament('tomorrow') : tTournament('daysAway', { count: daysUntilStart })}
            </div>
          )}
          {isLive && (
            <div style={{
              fontSize: 10, fontWeight: 800, color: LIVE_RED,
              background: 'rgba(255,69,85,0.15)', padding: '3px 8px', borderRadius: 4,
              textTransform: 'uppercase', letterSpacing: 0.5,
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: LIVE_RED, animation: 'v3-pulse 2s infinite' }} />
              Live
            </div>
          )}
          {isOngoing && (
            <div style={{
              fontSize: 10, fontWeight: 800, color: ORANGE,
              background: 'rgba(245,166,35,0.15)', padding: '3px 8px', borderRadius: 4,
              textTransform: 'uppercase', letterSpacing: 0.5,
            }}>
              {tTournament('ongoing')}
            </div>
          )}
        </div>
      )}

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
        <StatCard value={totalTeams || (tournament?.draw_size_md ? tTournament('pairs', { count: tournament.draw_size_md }) : '\u2014')} label={tTournament('teams')} accent />
        <StatCard value={displayMatches || '\u2014'} label={tTournament('matches')} />
        <StatCard value={totalCountries || '\u2014'} label={tTournament('countries')} />
        <StatCard value={(() => {
          if (tournament?.prize_money_fip && tournament.prize_money_fip > 0) {
            return `€${tournament.prize_money_fip.toLocaleString()}`
          }
          const raw = tournament?.prize_money?.trim()
          if (raw && !/^[^\d]*0$/.test(raw)) return raw
          return '—'
        })()} label={tTournament('prizeMoney')} />
      </div>

      {/* Tournament Info — venue address, court conditions, registration
          status. Only renders sections present on the FIP overview page
          (not all events publish all fields). Sign-up fee + per-round
          prize breakdown are scraped into the DB but kept ops-only —
          we don't want to send the user to padelfip.com to register. */}
      {(tournament?.venue_address || tournament?.venue_type || tournament?.registration_status) && (
        <>
          <SectionHeader label={tTournament('tournamentInfo')} />
          <div style={{
            background: BG_CARD,
            clipPath: CHUNKY.card,
            border: `1px solid ${BORDER}`,
            padding: '4px 14px',
            marginBottom: 16,
          }}>
            {tournament.venue_address && (
              <InfoRow
                icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2" strokeLinecap="round"><path d="M12 2C7.58 2 4 5.58 4 10c0 6.63 8 16 8 16s8-9.37 8-16c0-4.42-3.58-8-8-8z"/><circle cx="12" cy="10" r="2.5" fill={MUTED} stroke="none"/></svg>}
                label="Address"
                value={tournament.venue_address}
                multiline
              />
            )}
            {tournament.venue_type && (
              <InfoRow
                icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2" strokeLinecap="round"><rect x="3" y="6" width="18" height="12" rx="1"/><line x1="12" y1="6" x2="12" y2="18"/></svg>}
                label="Court"
                value={tournament.venue_type[0].toUpperCase() + tournament.venue_type.slice(1)}
              />
            )}
            {tournament.registration_status && (
              <InfoRow
                icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>}
                label={tTournament('registrationLabel')}
                value={tournament.registration_status === 'closed'
                  ? tTournament('registrationClosed')
                  : tournament.registration_status === 'open'
                  ? tTournament('registrationOpen')
                  : tournament.registration_status[0].toUpperCase() + tournament.registration_status.slice(1)}
                valueAccent={tournament.registration_status === 'open' ? GREEN : undefined}
              />
            )}
          </div>
        </>
      )}

      {/* Factsheet download — FIP publishes a PDF factsheet on most
          Platinum/Major/Premier events; detected by padelgod's
          fip-event-page-enricher and stored on tournament.factsheet_url. */}
      {tournament?.factsheet_url && (
        <a
          href={tournament.factsheet_url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 14px',
            background: BG_CARD,
            clipPath: CHUNKY.card,
            border: `1px solid ${BORDER}`,
            color: '#fff',
            textDecoration: 'none',
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 16,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="12" y1="18" x2="12" y2="12" />
            <polyline points="9 15 12 18 15 15" />
          </svg>
          <span style={{ flex: 1 }}>{tTournament('downloadFactsheet')}</span>
          <span style={{ color: MUTED, fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>PDF</span>
        </a>
      )}

      {/* Prize money breakdown — extracted from the factsheet PDF by the
          process-factsheets cron. Per-round per-player payouts. */}
      {(() => {
        type PrizeRow = { round_label?: string; per_player_eur?: number | null }
        const pm = tournament?.factsheet_data?.prize_money as PrizeRow[] | undefined
        const rows = (pm ?? []).filter(p => p && typeof p.per_player_eur === 'number' && p.per_player_eur > 0)
        if (rows.length === 0) return null

        // Friendly labels — Claude returns enum-ish keys; show humans
        // something readable. Fallback to the raw value title-cased.
        const labelMap: Record<string, string> = {
          winner: 'Winner',
          finalist: 'Finalist',
          semifinalist: 'Semifinalist',
          quarterfinalist: 'Quarterfinalist',
          round_16: 'Round of 16',
          round_32: 'Round of 32',
          last_of_qualy: 'Last of Qualy',
          qualy_bonus: 'Qualy bonus',
        }
        const labelize = (raw: string | undefined) =>
          labelMap[raw ?? ''] ?? (raw ?? '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
        const formatEur = (v: number) => new Intl.NumberFormat('en', {
          style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
        }).format(v)

        return (
          <>
            <SectionHeader label={tTournament('prizeBreakdown')} />
            <div style={{
              background: BG_CARD,
              clipPath: CHUNKY.card,
              border: `1px solid ${BORDER}`,
              padding: '4px 14px',
              marginBottom: 16,
            }}>
              {rows.map((p, i) => (
                <div
                  key={`${p.round_label}-${i}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 0',
                    borderBottom: i === rows.length - 1 ? 'none' : `1px solid ${BORDER}`,
                  }}
                >
                  <span style={{ fontSize: 12, color: '#fff', fontWeight: 600 }}>
                    {labelize(p.round_label)}
                  </span>
                  <span style={{ fontSize: 13, color: GREEN, fontWeight: 700 }}>
                    {formatEur(p.per_player_eur as number)}
                    <span style={{ color: MUTED, fontWeight: 400, fontSize: 10, marginLeft: 4 }}>
                      / {tTournament('perPlayer')}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </>
        )
      })()}

      {/* Champion (current tournament, only once the final has been played) */}
      {currentChampion && (
        <ChampionTile
          label={tTournament('champion')}
          year={currentChampion.year}
          names={currentChampion.names}
          country1={currentChampion.country1}
          country2={currentChampion.country2}
          accent={GREEN}
        />
      )}

      {/* Defending Champion (from previous edition, if we can find it) */}
      {defendingChampion && previousEdition && (
        <Link href={`/tournaments/${previousEdition.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
          <ChampionTile
            label={tTournament('defendingChampion')}
            year={defendingChampion.year}
            names={defendingChampion.names}
            country1={defendingChampion.country1}
            country2={defendingChampion.country2}
            accent="#F5A623"
            clickable
          />
        </Link>
      )}

      {/* Fallback: previous edition exists but no champion data.
          Still give the user a way to open it. */}
      {!defendingChampion && previousEdition && (
        <Link href={`/tournaments/${previousEdition.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block', marginBottom: 10 }}>
          <div style={{
            background: BG_CARD,
            clipPath: CHUNKY.card,
            border: `1px solid ${BORDER}`,
            padding: '11px 14px',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{
              width: 28, height: 28, flexShrink: 0,
              background: 'rgba(245,166,35,0.12)',
              clipPath: CHUNKY.badge,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#F5A623', fontSize: 14,
            }}>
              🏆
            </div>
            <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: '#fff' }}>
              View {previousEdition.year || 'last'} edition
            </span>
            <span style={{ fontSize: 16, color: '#F5A623', fontWeight: 800 }}>→</span>
          </div>
        </Link>
      )}

      {/* Where to Watch — expanded inline panel (self-hides when buildGroups returns empty) */}
      <WhereToWatchInline
        liveChannels={wtwLiveChannels}
        broadcasters={wtwBroadcasters}
        channelsMeta={wtwChannelsMeta}
        todayCircuits={tournamentChannelAbbr ? [tournamentChannelAbbr] : []}
        geoCountry={wtwGeoCountry}
        fallback={wtwFallback}
      />

      {/* Schedule — date + round + match count, computed from the matches
          table so every tournament has it (the factsheet PDF schedule was
          richer but only ~10% of events publish one). */}
      {schedule.length > 0 && (
        <>
          <SectionHeader label="Schedule" />
          <div style={{
            background: BG_CARD,
            clipPath: CHUNKY.card,
            border: `1px solid ${BORDER}`,
            padding: '4px 14px',
          }}>
            {schedule.map((s, i) => (
              <div key={s.round} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0',
                borderBottom: i < schedule.length - 1 ? `0.5px solid ${BORDER}` : 'none',
              }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: i === 0 ? GREEN : MUTED, width: 50 }}>
                  {s.date.split('-')[0]?.trim() || '—'}
                </span>
                <span style={{ fontSize: 12, color: MUTED, flex: 1 }}>
                  {s.round} ({s.count} {s.count === 1 ? 'match' : 'matches'})
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// ── Story Tab ──────────────────────────────────────────────
//
// The "Story" tab is the narrative home of the tournament page:
//   - Pre-event: shows only the auto-generated preview editorial
//   - Post-event: switches to recap editorial + winner card + round summary
//
// The EditorialBlock auto-selects preview/recap based on what exists in
// editorial_posts, so this component never needs to know which state is
// active — it just renders the block and the winner card falls through
// gracefully when no final has been played yet.
// ══════════════════════════════════════════════════════════════

function V3Story({ tournament, allMatches, genderFilter, genderColor, locale, userTz }: {
  tournament: any
  allMatches: Match[]
  genderFilter: 'men' | 'women'
  genderColor: string
  locale: string
  userTz: string
}) {
  const router = useRouter()
  const tTournament = useTranslations('tournament')
  const genderMatches = allMatches.filter(m => (m as any).category === genderFilter)
  const finishedMatches = genderMatches.filter(m =>
    ['finished', 'retired', 'walkover', 'ended'].includes(m.status as string)
  )

  const finalMatch = genderMatches.find(m => {
    const r = normalizeRoundFull(m.round as string)
    return r === 'Finals' && ['finished', 'retired', 'walkover', 'ended'].includes(m.status as string)
  })

  const getWinner = (m: Match): 0 | 1 | 2 => {
    if ((m as any).winner_pair === 1) return 1
    if ((m as any).winner_pair === 2) return 2
    const sets = (m as any).sets ?? []
    let p1Sets = 0, p2Sets = 0
    for (const s of sets) {
      const parsed = parseSetScore(s.set_score) ?? parseSetFromGames(s.pair1_games, s.pair2_games)
      const p1 = parsed?.p1 ?? s.pair1_games ?? 0
      const p2 = parsed?.p2 ?? s.pair2_games ?? 0
      if (p1 > p2) p1Sets++
      else if (p2 > p1) p2Sets++
    }
    if (p1Sets === p2Sets) return 0
    return p1Sets > p2Sets ? 1 : 2
  }

  // Stats
  const totalPlayed = finishedMatches.length
  const threeSetMatches = finishedMatches.filter(m => ((m as any).sets ?? []).length >= 3).length
  const threeSetPct = totalPlayed > 0 ? Math.round((threeSetMatches / totalPlayed) * 100) : 0

  const durations = finishedMatches
    .map(m => {
      const d = (m as any).duration as string | null
      if (!d) return 0
      const parts = d.split(':')
      if (parts.length === 2) return parseInt(parts[0]) * 60 + parseInt(parts[1])
      return 0
    })
    .filter(d => d > 0)
  const avgDurationMins = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0
  const avgDurationLabel = avgDurationMins > 0
    ? avgDurationMins >= 60 ? `${Math.floor(avgDurationMins / 60)}h ${avgDurationMins % 60}m` : `${avgDurationMins} min`
    : null

  // Top upsets
  type Upset = { winner: string; loser: string; winnerRank: number; loserRank: number; gap: number; match: Match }
  const topUpsets: Upset[] = (() => {
    const upsets: Upset[] = []
    for (const m of finishedMatches) {
      const p1a = (m as any).pair1_player1
      const p1b = (m as any).pair1_player2
      const p2a = (m as any).pair2_player1
      const p2b = (m as any).pair2_player2
      const rank1 = Math.min(p1a?.ranking || 9999, p1b?.ranking || 9999)
      const rank2 = Math.min(p2a?.ranking || 9999, p2b?.ranking || 9999)
      if (rank1 >= 9999 || rank2 >= 9999) continue
      if (rank1 === rank2) continue
      if (rank1 > 30 && rank2 > 30) continue
      const winner = getWinner(m)
      if (winner === 0) continue
      const favoriteIsPair = rank1 < rank2 ? 1 : 2
      if (winner === favoriteIsPair) continue
      const winnerRank = winner === 1 ? rank1 : rank2
      const loserRank = winner === 1 ? rank2 : rank1
      const gap = winnerRank - loserRank
      const winnerDisplay = winner === 1
        ? `${toShortName(p1a?.name ?? '?')} / ${toShortName(p1b?.name ?? '?')}`
        : `${toShortName(p2a?.name ?? '?')} / ${toShortName(p2b?.name ?? '?')}`
      const loserDisplay = winner === 1
        ? `${toShortName(p2a?.name ?? '?')} / ${toShortName(p2b?.name ?? '?')}`
        : `${toShortName(p1a?.name ?? '?')} / ${toShortName(p1b?.name ?? '?')}`
      upsets.push({ winner: winnerDisplay, loser: loserDisplay, winnerRank, loserRank, gap, match: m })
    }
    return upsets.sort((a, b) => b.gap - a.gap).slice(0, 3)
  })()

  const stats: { label: string; value: string }[] = [
    { label: 'Total matches played', value: String(totalPlayed) },
    { label: '3-set matches', value: `${threeSetMatches} (${threeSetPct}%)` },
  ]
  if (avgDurationLabel) stats.push({ label: 'Average match duration', value: avgDurationLabel })

  const AvatarCircle = ({ player, size }: { player: any; size: number }) => (
    <div style={{
      width: size, height: size, borderRadius: '50%', overflow: 'hidden',
      background: BG_CARD, border: `2px solid ${BG_CARD}`, flexShrink: 0,
    }}>
      {player?.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={player.avatar_url} alt={player.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.32, color: MUTED }}>
          {player?.name?.charAt(0) ?? '?'}
        </div>
      )}
    </div>
  )

  return (
    <div style={{ padding: '14px 14px 20px' }}>
      {/* Auto-generated editorial — preview pre-event, recap post-event.
          Reads from EditorialContext (populated server-side in layout.tsx),
          so the content is in the initial HTML response for Googlebot. */}
      <EditorialBlock />

      {/* Winner card */}
      {finalMatch && getWinner(finalMatch) !== 0 ? (() => {
        const winnerPair = getWinner(finalMatch)
        const loserPair = winnerPair === 1 ? 2 : 1
        const wp1 = winnerPair === 1 ? (finalMatch as any).pair1_player1 : (finalMatch as any).pair2_player1
        const wp2 = winnerPair === 1 ? (finalMatch as any).pair1_player2 : (finalMatch as any).pair2_player2
        const lp1 = loserPair === 1 ? (finalMatch as any).pair1_player1 : (finalMatch as any).pair2_player1
        const lp2 = loserPair === 1 ? (finalMatch as any).pair1_player2 : (finalMatch as any).pair2_player2
        const sets = ((finalMatch as any).sets ?? []).sort((a: any, b: any) => a.set_number - b.set_number)
        const winnerGames = sets.map((s: any) => winnerPair === 1 ? (s.pair1_games ?? 0) : (s.pair2_games ?? 0))
        const loserGames = sets.map((s: any) => winnerPair === 1 ? (s.pair2_games ?? 0) : (s.pair1_games ?? 0))
        const winnerSetsWon = winnerGames.filter((g: number, i: number) => g > loserGames[i]).length
        const loserSetsWon = loserGames.filter((g: number, i: number) => g > winnerGames[i]).length

        return (
          <div style={{
            background: `linear-gradient(135deg, rgba(126,211,33,0.06), rgba(126,211,33,0.02))`,
            border: `1px solid rgba(126,211,33,0.2)`,
            clipPath: CHUNKY.card,
            padding: 18, marginBottom: 16, position: 'relative',
          }}>
            {/* Top: CHAMPIONS + details link */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{
                fontSize: 9, fontWeight: 800, letterSpacing: 1.5,
                textTransform: 'uppercase',
                background: GREEN,
                color: '#000',
                padding: '3px 10px',
                clipPath: CHUNKY.badge,
              }}>
                CHAMPIONS
              </div>
              <div
                onClick={() => router.push(`/match/${finalMatch.id}`)}
                style={{ fontSize: 11, color: GREEN, cursor: 'pointer', fontWeight: 700 }}
              >
                Details &rsaquo;
              </div>
            </div>

            {/* Winner row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ display: 'flex', flexShrink: 0 }}>
                <AvatarCircle player={wp1} size={36} />
                <div style={{ marginLeft: -10, zIndex: 0 }}>
                  <AvatarCircle player={wp2} size={36} />
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 800, lineHeight: 1.3, color: '#fff' }}>
                  {wp1?.country ? countryFlag(wp1.country) + ' ' : ''}{wp1?.name ? toShortName(wp1.name) : 'TBD'}
                </div>
                <div style={{ fontSize: 13, fontWeight: 800, lineHeight: 1.3, color: '#fff' }}>
                  {wp2?.country ? countryFlag(wp2.country) + ' ' : ''}{wp2?.name ? toShortName(wp2.name) : 'TBD'}
                </div>
              </div>
              <div style={{
                fontSize: 24, fontWeight: 800, color: GREEN,
                flexShrink: 0,
              }}>{winnerSetsWon}</div>
            </div>

            {/* Loser row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: 0.5 }}>
              <div style={{ display: 'flex', flexShrink: 0 }}>
                <AvatarCircle player={lp1} size={36} />
                <div style={{ marginLeft: -10, zIndex: 0 }}>
                  <AvatarCircle player={lp2} size={36} />
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: MUTED, lineHeight: 1.3 }}>
                  {lp1?.country ? countryFlag(lp1.country) + ' ' : ''}{lp1?.name ? toShortName(lp1.name) : 'TBD'}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: MUTED, lineHeight: 1.3 }}>
                  {lp2?.country ? countryFlag(lp2.country) + ' ' : ''}{lp2?.name ? toShortName(lp2.name) : 'TBD'}
                </div>
              </div>
              <div style={{
                fontSize: 24, fontWeight: 800, color: MUTED,
                flexShrink: 0,
              }}>{loserSetsWon}</div>
            </div>
          </div>
        )
      })() : (
        <div style={{ textAlign: 'center', padding: '40px 0 20px' }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>&#127942;</div>
          <p style={{ color: MUTED, fontWeight: 600, fontSize: 14, margin: 0 }}>{tTournament('finalNotPlayed')}</p>
          <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12, marginTop: 6 }}>{tTournament('checkBackAfterTournament')}</p>
        </div>
      )}

      {/* Tournament stats */}
      {totalPlayed > 0 && (
        <>
          <SectionHeader label="Tournament Stats" />
          {stats.map((stat, i) => (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 14px', background: BG_CARD,
              clipPath: CHUNKY.card,
              marginBottom: 4, border: `1px solid ${BORDER}`,
            }}>
              <span style={{ fontSize: 12, color: MUTED }}>{stat.label}</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>{stat.value}</span>
            </div>
          ))}

          {/* Biggest upsets */}
          {topUpsets.length > 0 && (
            <>
              <div style={{ marginTop: 8 }}>
                <SectionHeader label="Biggest Upsets" />
              </div>
              {topUpsets.map((upset, i) => (
                <div key={i} style={{ marginBottom: 4 }}>
                  <MatchCard match={upset.match} genderColor={genderColor} locale={locale} userTz={userTz} tournamentLevel={tournament?.level} />
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  )
}

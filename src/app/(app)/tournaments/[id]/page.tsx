'use client'
// src/app/(app)/tournaments/[id]/page.tsx
// V3 Tournament Detail — matches by round with gender toggle, stage selector,
// realtime updates, overview tab, and recap tab. Styled with PadelNachos brand.

import { useEffect, useState, useCallback, useMemo, useRef, use, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Match, countryFlag, pairName, parseSetScore, isWarmingUp, toShortName } from '@/types/match'
import Link from 'next/link'
import Spinner from '../../../components/Spinner'
import BrandedLoader, { LOADER_HINTS } from '../../../components/BrandedLoader'
import { withTimeout } from '@/lib/with-timeout'
import FollowButton from '@/components/FollowButton'
import { isTournamentGated } from '@/lib/tournament-utils'
import BracketView from '@/components/BracketView'
import { EntryList } from '@/components/EntryList'
import { V3MatchCard } from '@/components/V3MatchCard'
import WhereToWatch from '@/components/WhereToWatch'

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

// ── Coverage levels with live point-by-point scoring ──────────
const FULL_COVERAGE_LEVELS = new Set(['major', 'p1', 'p2', 'finals', 'fip_platinum'])

// ── Stage ordering ────────────────────────────────────────────
const ROUND_ORDER: Record<string, number> = {
  'Finals': 1, 'Final': 1, 'F': 1,
  'Semifinals': 2, 'Semifinal': 2, 'Semi': 2, 'SF': 2,
  'Quarterfinals': 3, 'Quarter': 3, 'Quarters': 3, 'QF': 3,
  'Round of 16': 4, 'R16': 4,
  'Round of 32': 5, 'R32': 5,
  'Round of 64': 6, 'R64': 6,
}

function normalizeRoundFull(r: string): string {
  const map: Record<string, string> = {
    'Quarter': 'Quarterfinals', 'Quarters': 'Quarterfinals', 'QF': 'Quarterfinals',
    'Semi': 'Semifinals', 'Semifinal': 'Semifinals', 'SF': 'Semifinals',
    'Final': 'Finals', 'F': 'Finals',
    'R16': 'R16', 'R32': 'R32', 'R64': 'R64',
  }
  return map[r] ?? r
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

function levelLabel(level: string | null): string {
  const map: Record<string, string> = {
    finals: 'Finals', major: 'Major', p1: 'P1', p2: 'P2',
    fip_platinum: 'FIP Platinum', fip_gold: 'FIP Gold',
    fip_silver: 'FIP Silver', fip_bronze: 'FIP Bronze', fip_other: 'FIP Tour',
  }
  return level ? (map[level] ?? level) : ''
}

// ── Flag image (consistent, no emoji) ─────────────────────────
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

// ══════════════════════════════════════════════════════════════
// ── Wrapper (unwraps async params) ───────────────────────────
// ══════════════════════════════════════════════════════════════

export default function TournamentDetailWrapper({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return (
    <Suspense fallback={<BrandedLoader hints={[...LOADER_HINTS.tournament]} />}>
      <TournamentDetail tournamentId={id} />
    </Suspense>
  )
}

// ══════════════════════════════════════════════════════════════
// ── Main component ───────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

function TournamentDetail({ tournamentId }: { tournamentId: string }) {
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

  const [drawEntries, setDrawEntries] = useState<any[]>([])
  const [playerMap, setPlayerMap] = useState<Record<string, { avatar_url: string | null; ranking: number | null }>>({})
  const [debutStatusMap, setDebutStatusMap] = useState<Record<string, 'fresh' | 'newThisSeason' | null>>({})
  const [activeTournament, setActiveTournament] = useState<string | null>(null)
  const [selectedRound, setSelectedRound] = useState<string | null>(null)
  const [genderFilter, setGenderFilter] = useState<'men' | 'women'>('men')
  const [pageTab, setPageTab] = useState<'matches' | 'overview' | 'draw' | 'recap'>(
    paramTab === 'recap' ? 'recap' : paramTab === 'draw' ? 'draw' : paramTab === 'matches' ? 'matches' : 'overview'
  )
  const stageStripRef = useRef<HTMLDivElement>(null)

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
            pair1_player1:players!matches_pair1_player1_id_fkey(id, name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
            pair1_player2:players!matches_pair1_player2_id_fkey(id, name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
            pair2_player1:players!matches_pair2_player1_id_fkey(id, name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
            pair2_player2:players!matches_pair2_player2_id_fkey(id, name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
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

      const sorted = (data as any[]).map(m => ({
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
      .select('id, name, starts_at, ends_at, country, timezone, level, status, logo_url, venue, prize_money, prize_money_fip, draw_size_md, draw_size_qd, entry_list_status, source')
      .order('starts_at', { ascending: false })
    if (data) setTournaments(data)
  }, [])

  // Fetch entry list / draw data + player hydration (avatars, rankings)
  const fetchDrawEntries = useCallback(async () => {
    const { data: drawData } = await supabase
      .from('tournament_draws')
      .select('draw_position, seed, marker, category, round, player1_name, player1_country, player1_id, player2_name, player2_country, player2_id, team_points')
      .eq('tournament_id', tournamentId)
      .order('draw_position', { ascending: true })

    if (!drawData) return
    setDrawEntries(drawData)

    // Collect unique resolved player IDs
    const playerIds = new Set<string>()
    for (const d of drawData as any[]) {
      if (d.player1_id) playerIds.add(d.player1_id)
      if (d.player2_id) playerIds.add(d.player2_id)
    }
    if (playerIds.size === 0) return

    // Hydrate player avatars + rankings
    const { data: playerData } = await supabase
      .from('players')
      .select('id, avatar_url, ranking')
      .in('id', Array.from(playerIds))

    if (playerData) {
      const map: Record<string, { avatar_url: string | null; ranking: number | null }> = {}
      for (const p of playerData as any[]) {
        map[p.id] = { avatar_url: p.avatar_url ?? null, ranking: p.ranking ?? null }
      }
      setPlayerMap(map)
    }

    // ── Compute debut status (fresh partners / new this season) ──
    // For each entry with both player IDs resolved, look at historical
    // finished matches (excluding this tournament) and count whether
    // they've played together, and whether any of those matches are
    // in the current calendar year.
    const idList = Array.from(playerIds)
    if (idList.length === 0) {
      setDebutStatusMap({})
      return
    }

    const orClause =
      `pair1_player1_id.in.(${idList.join(',')}),` +
      `pair1_player2_id.in.(${idList.join(',')}),` +
      `pair2_player1_id.in.(${idList.join(',')}),` +
      `pair2_player2_id.in.(${idList.join(',')})`

    const { data: histMatches } = await supabase
      .from('matches')
      .select('pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, finished_at')
      .in('status', ['finished', 'retired', 'walkover'])
      .neq('tournament_id', tournamentId)
      .or(orClause)
      .limit(5000)

    // Build a map: pairKey → { hasPast: boolean, hasThisYear: boolean }
    const pairStats: Record<string, { hasPast: boolean; hasThisYear: boolean }> = {}
    const currentYear = new Date().getFullYear()

    const makeKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`

    for (const m of (histMatches ?? []) as any[]) {
      // For each match, check both pair slots. If both IDs in a slot
      // are members of our playerIds set, record them as a played-together pair.
      const pairs: Array<[string | null, string | null]> = [
        [m.pair1_player1_id, m.pair1_player2_id],
        [m.pair2_player1_id, m.pair2_player2_id],
      ]
      for (const [a, b] of pairs) {
        if (!a || !b) continue
        if (!playerIds.has(a) || !playerIds.has(b)) continue
        const key = makeKey(a, b)
        const year = m.finished_at ? new Date(m.finished_at).getFullYear() : 0
        const existing = pairStats[key] ?? { hasPast: false, hasThisYear: false }
        existing.hasPast = true
        if (year === currentYear) existing.hasThisYear = true
        pairStats[key] = existing
      }
    }

    // Map each current-tournament entry to a debut status.
    const statusMap: Record<string, 'fresh' | 'newThisSeason' | null> = {}
    for (const d of drawData as any[]) {
      if (!d.player1_id || !d.player2_id) continue
      const key = makeKey(d.player1_id, d.player2_id)
      const stats = pairStats[key]
      if (!stats || !stats.hasPast) {
        statusMap[key] = 'fresh'
      } else if (!stats.hasThisYear) {
        statusMap[key] = 'newThisSeason'
      } else {
        statusMap[key] = null // established
      }
    }
    setDebutStatusMap(statusMap)
  }, [tournamentId])

  useEffect(() => { fetchAll(); fetchTournaments(); fetchDrawEntries() }, [fetchAll, fetchTournaments, fetchDrawEntries])

  // ── Realtime — debounced ──────────────────────────────────────
  const realtimeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const handleChange = () => {
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current)
      realtimeDebounceRef.current = setTimeout(fetchAll, 500)
    }
    const ch = supabase
      .channel('v3-tournament-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, handleChange)
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current)
    }
  }, [fetchAll])

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

  // Default tab to 'recap' when the tournament is finished and no explicit
  // tab was requested via URL. Runs once per tournament load.
  const autoTabSetRef = useRef<string | null>(null)
  useEffect(() => {
    if (!activeTournamentObj || paramTab) return
    if (autoTabSetRef.current === activeTournamentObj.id) return
    const isFinished = activeTournamentObj.status === 'completed' || activeTournamentObj.status === 'finished'
    if (isFinished) {
      setPageTab('recap')
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
      const r = m.round as string | null
      if (r) seen.add(normalizeRoundFull(r))
    }
    return [...seen].sort((a, b) => (ROUND_ORDER[b] ?? 0) - (ROUND_ORDER[a] ?? 0))
  }, [allMatches, activeTournament, genderFilter])

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
      const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
      map[round] = sorted.length === 1 ? fmt(sorted[0]) : `${fmt(sorted[0])} - ${fmt(sorted[sorted.length - 1])}`
    }
    return map
  }, [allMatches, availableRounds, activeTournament, genderFilter])

  // ── Auto-select round: prefer live > today > most advanced ──
  useEffect(() => {
    if (availableRounds.length === 0) return
    const todayKey = localDateKey(new Date())
    const hasLive = availableRounds.find(r =>
      allMatches.some(m =>
        m.status === 'live' &&
        normalizeRoundFull(m.round as string) === r &&
        (!activeTournament || (m as any).tournament?.id === activeTournament)
      )
    )
    const hasToday = availableRounds.find(r =>
      allMatches.some(m => {
        if (activeTournament && (m as any).tournament?.id !== activeTournament) return false
        if (normalizeRoundFull(m.round as string) !== r) return false
        const src = (m as any).scheduled_at ?? (m as any).started_at
        return src && src.slice(0, 10) === todayKey
      })
    )
    setSelectedRound(prev => {
      if (paramRound && !prev) {
        const normalized = normalizeRoundFull(paramRound)
        if (availableRounds.includes(normalized)) return normalized
      }
      if (prev && availableRounds.includes(prev)) return prev
      return hasLive ?? hasToday ?? availableRounds[0] ?? null
    })
  }, [availableRounds, activeTournament, paramRound, allMatches])

  // ── Auto-scroll stage strip ───────────────────────────────────
  useEffect(() => {
    if (!selectedRound || !stageStripRef.current) return
    const btn = stageStripRef.current.querySelector<HTMLElement>('[data-active="true"]')
    if (btn) btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [selectedRound])

  // ── Filtered matches ──────────────────────────────────────────
  const filtered = useMemo(() => {
    return allMatches.filter(m => {
      if (activeTournament && (m as any).tournament?.id !== activeTournament) return false
      if (selectedRound && normalizeRoundFull(m.round as string) !== selectedRound) return false
      if ((m as any).category !== genderFilter) return false
      return true
    })
  }, [allMatches, activeTournament, selectedRound, genderFilter])

  const liveMatches = filtered.filter(m => m.status === 'live' && !isWarmingUp(m as Match))
  const warmingUpMatches = filtered.filter(m => m.status === 'live' && isWarmingUp(m as Match))
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

        {/* ── Sticky header ── */}
        <div style={{
          background: '#0A0A0A', borderBottom: 'none', boxShadow: '0 1px 8px rgba(0,0,0,0.5)',
          position: 'sticky', top: 0, zIndex: 10,
        }}>

          {/* ROW 1: Back + title */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '12px 16px',
            height: 62,
          }}>
            <button
              onClick={() => { if (window.history.length > 1) router.back(); else router.push('/home') }}
              style={{
                width: 36, height: 36, border: 'none', cursor: 'pointer',
                background: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', flexShrink: 0,
              }}
              aria-label="Back"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>

            <span style={{ fontSize: 18, fontWeight: 800, color: '#fff', flex: 1, letterSpacing: -0.3 }}>
              Tournament Detail
            </span>

            {/* Gender toggle pill */}
            <div
              onClick={() => setGenderFilter(g => g === 'men' ? 'women' : 'men')}
              style={{
                display: 'inline-flex', alignItems: 'center', cursor: 'pointer',
                background: 'rgba(255,255,255,0.04)',
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

          {/* ROW 2: Tournament info card */}
          {activeTournamentObj && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 16px',
              borderTop: `1px solid ${BORDER}`,
              borderBottom: `1px solid ${BORDER}`,
              position: 'relative',
            }}>
              {/* Left accent bar removed */}

              {activeTournamentObj.country ? (
                <div style={{ width: 50, height: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <FlagImg country={activeTournamentObj.country} size={36} />
                </div>
              ) : null}

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    fontSize: 15, fontWeight: 800, color: '#fff',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    letterSpacing: 0.3,
                    flex: 1, minWidth: 0,
                  }}>
                    {titleCase(activeTournamentObj.name)}
                  </div>
                  <FollowButton type="tournament" targetId={activeTournamentObj.id} variant="follow" />
                </div>

                {activeTournamentObj.venue && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                    <svg width="10" height="12" viewBox="0 0 24 28" fill="none" stroke={MUTED} strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0 }}>
                      <path d="M12 2C7.58 2 4 5.58 4 10c0 6.63 8 16 8 16s8-9.37 8-16c0-4.42-3.58-8-8-8z"/>
                      <circle cx="12" cy="10" r="2.5" fill={MUTED} stroke="none"/>
                    </svg>
                    <span style={{ fontSize: 10, fontWeight: 600, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: 0.2 }}>
                      {activeTournamentObj.venue}
                    </span>
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                  {activeTournamentObj.starts_at && activeTournamentObj.ends_at && (
                    <span style={{ fontSize: 10, color: MUTED }}>
                      {new Date(activeTournamentObj.starts_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      {' - '}
                      {new Date(activeTournamentObj.ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </span>
                  )}
                  {activeTournamentObj.prize_money && (
                    <span style={{ fontSize: 10, color: MUTED }}>
                      &middot; {activeTournamentObj.prize_money}
                    </span>
                  )}
                  {activeTournamentObj.level && (
                    <span style={{
                      fontSize: 8, fontWeight: 800, color: GREEN,
                      background: 'rgba(126,211,33,0.12)',
                      clipPath: CHUNKY.badge,
                      padding: '2px 8px', letterSpacing: 0.5,
                      textTransform: 'uppercase',
                    }}>
                      {levelLabel(activeTournamentObj.level)}
                    </span>
                  )}
                  {liveCount > 0 && (
                    <span style={{
                      fontSize: 8, fontWeight: 800, color: LIVE_RED,
                      background: 'rgba(255,70,85,0.12)',
                      clipPath: CHUNKY.badge,
                      padding: '2px 8px', letterSpacing: 0.5,
                    }}>
                      <span style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: LIVE_RED, marginRight: 4, verticalAlign: 'middle', animation: 'v3-pulse 2s infinite' }} />
                      {liveCount} LIVE
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ROW 3: Page tabs — recap leads when the tournament is finished */}
          <div style={{ display: 'flex', borderBottom: `1px solid ${BORDER}` }}>
            {(['recap', 'overview', 'matches', 'draw'] as const).map(tab => {
              const active = pageTab === tab
              const isFinished = activeTournamentObj?.status === 'completed' || activeTournamentObj?.status === 'finished'
              if (tab === 'recap' && !isFinished) return null
              const hasDraws = drawEntries.filter((d: any) => d.category === genderFilter).length > 0
              if (tab === 'draw' && !hasDraws) return null
              return (
                <button
                  key={tab}
                  onClick={() => setPageTab(tab)}
                  style={{
                    flex: 1, padding: '12px 0', border: 'none', background: 'none', cursor: 'pointer',
                    fontSize: 12, fontWeight: 800, letterSpacing: 0.5, fontFamily: 'inherit',
                    color: active ? GREEN : MUTED,
                    position: 'relative', transition: 'color 0.2s',
                    textTransform: 'uppercase',
                  }}
                >
                  {tab}
                  {active && (
                    <span style={{
                      position: 'absolute', bottom: -1, left: '15%', right: '15%',
                      height: 2, background: GREEN,
                    }} />
                  )}
                </button>
              )
            })}
          </div>

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
              <span>Live point-by-point scoring is not available for this event.</span>
            </div>
          )}

          {/* Gated tournament banner */}
          {activeTournamentObj && isTournamentGated(activeTournamentObj) && (
            <div style={{
              margin: '0 16px', padding: '12px 16px',
              background: 'rgba(245, 166, 35, 0.1)',
              borderLeft: '3px solid #F5A623',
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Matches Coming Soon</div>
              <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>Entry list data is being processed for accurate player information</div>
            </div>
          )}

          {/* ROW 4: Stage selector strip (matches tab only) */}
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
        </div>

        {/* ── Matches Feed ── */}
        {pageTab === 'matches' && (
          <div style={{ padding: '8px 12px 16px', ...(activeTournamentObj && isTournamentGated(activeTournamentObj) ? { opacity: 0.4, pointerEvents: 'none' as const } : {}) }}>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} style={{ background: BG_CARD, clipPath: CHUNKY.card, height: 88, marginBottom: 6, opacity: 0.3 }} />
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
                      <V3MatchCard key={m.id} match={m} genderColor={genderColor} />
                    ))}
                  </div>
                )}

                {warmingUpMatches.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <SectionHeader dot color={ORANGE} label="Warming up" />
                    {warmingUpMatches.map(m => (
                      <V3MatchCard key={m.id} match={m} genderColor={genderColor} />
                    ))}
                  </div>
                )}

                {scheduledMatches.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <SectionHeader label="Up next" />
                    {scheduledMatches.map(m => (
                      <V3ScheduledCard key={m.id} match={m} genderColor={genderColor} estimatedLabel={estimatedLabels[m.id]} />
                    ))}
                  </div>
                )}

                {finishedMatches.length > 0 && (
                  <div>
                    <SectionHeader label={`Results \u00B7 ${selectedRound ?? ''}`} />
                    {finishedMatches.map(m => (
                      <V3MatchCard key={m.id} match={m} genderColor={genderColor} />
                    ))}
                  </div>
                )}

                {liveMatches.length === 0 && warmingUpMatches.length === 0 && scheduledMatches.length === 0 && finishedMatches.length === 0 && (
                  <div style={{ textAlign: 'center', paddingTop: 80 }}>
                    <div style={{ fontSize: 36, marginBottom: 12 }}>&#127934;</div>
                    <p style={{ color: MUTED, fontWeight: 700, fontSize: 14, margin: 0 }}>No matches for this stage</p>
                    <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12, marginTop: 6 }}>Try selecting a different round</p>
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
            drawEntries={drawEntries}
            playerMap={playerMap}
            debutStatusMap={debutStatusMap}
          />
        )}

        {/* ── Draw Tab ── */}
        {pageTab === 'draw' && (
          <BracketView
            drawEntries={drawEntries}
            matches={allMatches}
            genderFilter={genderFilter}
          />
        )}

        {/* ── Recap Tab ── */}
        {pageTab === 'recap' && (
          <V3Recap
            tournament={activeTournamentObj}
            allMatches={allMatches}
            genderFilter={genderFilter}
            genderColor={genderColor}
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

// ══════════════════════════════════════════════════════════════
// ── V3 Scheduled Card ───────────────────────────────────────
// ══════════════════════════════════════════════════════════════

function V3ScheduledCard({ match, genderColor, estimatedLabel }: { match: Match; genderColor: string; estimatedLabel?: string }) {
  const time = match.scheduled_at
    ? new Date(match.scheduled_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    : ''
  const scheduleLabel = (match as any).schedule_label as string | null

  return (
    <Link href={`/match/${match.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block', marginBottom: 6 }}>
      <div style={{
        background: BG_CARD,
        border: `1px solid ${BORDER}`,
        clipPath: CHUNKY.card,
        padding: '14px 16px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Left gender accent bar */}
        <div style={{
          position: 'absolute', top: 0, left: 0, bottom: 0,
          width: 3, background: genderColor,
        }} />

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: MUTED }}>
            {match.round ?? ''}{match.court ? ` \u00B7 ${match.court}` : ''}
          </span>
          <span style={{ fontSize: 10, fontWeight: 700, color: GREEN, fontFamily: 'monospace' }}>
            {scheduleLabel ?? (time || (estimatedLabel ?? 'TBD'))}
          </span>
        </div>

        {/* Players */}
        {[
          { p1: match.pair1_player1, p2: match.pair1_player2, key: 'pair1' },
          { p1: match.pair2_player1, p2: match.pair2_player2, key: 'pair2' },
        ].map(({ p1, p2, key }, idx) => {
          const seed = Math.min(p1?.ranking ?? 9999, p2?.ranking ?? 9999)
          return (
            <div key={key}>
              {idx === 1 && (
                <div style={{ fontSize: 9, color: MUTED, margin: '3px 0', paddingLeft: 2, fontWeight: 700, letterSpacing: 0.5 }}>VS</div>
              )}
              {[p1, p2].map((p, i) => (
                <div key={`${key}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
                  <FlagImg country={p?.country ?? null} size={14} />
                  <span style={{
                    fontSize: 12, fontWeight: 600, color: '#fff', flex: 1,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {p?.name ?? 'TBD'}
                  </span>
                  {i === 0 && seed < 9999 && (
                    <span style={{ fontSize: 9, fontWeight: 700, color: MUTED, opacity: 0.7 }}>#{seed}</span>
                  )}
                </div>
              ))}
            </div>
          )
        })}

        {/* Estimated time if available */}
        {estimatedLabel && !scheduleLabel && (
          <div style={{ marginTop: 6, fontSize: 9, color: ORANGE, fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase' }}>
            Est. {estimatedLabel}
          </div>
        )}
      </div>
    </Link>
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
              <FlagImg country={country1} size={16} />
            </div>
            <div style={{ position: 'absolute', top: 6, left: 8, zIndex: 1 }}>
              <FlagImg country={country2} size={16} />
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

function V3Overview({ tournament, allMatches, genderFilter, genderColor, availableRounds, roundDates, drawEntries, playerMap, debutStatusMap }: {
  tournament: any
  allMatches: Match[]
  genderFilter: 'men' | 'women'
  genderColor: string
  availableRounds: string[]
  roundDates: Record<string, string>
  drawEntries: any[]
  playerMap: Record<string, { avatar_url: string | null; ranking: number | null }>
  debutStatusMap: Record<string, 'fresh' | 'newThisSeason' | null>
}) {
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
    const names = winnerPlayers.map((p: any) => toShortName(p.name)).join(' / ')
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
            pair1_player1:players!matches_pair1_player1_id_fkey(name, country),
            pair1_player2:players!matches_pair1_player2_id_fkey(name, country),
            pair2_player1:players!matches_pair2_player1_id_fkey(name, country),
            pair2_player2:players!matches_pair2_player2_id_fkey(name, country)
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

        const names = winnerPlayers.map((p: any) => toShortName(p.name)).join(' / ')
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

  // Count unique teams
  const teamSet = new Set<string>()
  for (const m of genderMatches) {
    const p1 = [(m as any).pair1_player1?.name, (m as any).pair1_player2?.name].filter(Boolean).sort().join('/')
    const p2 = [(m as any).pair2_player1?.name, (m as any).pair2_player2?.name].filter(Boolean).sort().join('/')
    if (p1) teamSet.add(p1)
    if (p2) teamSet.add(p2)
  }
  const totalTeams = teamSet.size

  // Count unique countries
  const countrySet = new Set<string>()
  for (const m of genderMatches) {
    for (const key of ['pair1_player1', 'pair1_player2', 'pair2_player1', 'pair2_player2'] as const) {
      const country = (m as any)[key]?.country as string | undefined
      if (country) countrySet.add(country)
    }
  }
  const totalCountries = countrySet.size

  // Schedule
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
  const isLive = startsAt && endsAt && now >= startsAt && now <= endsAt

  const formatDate = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  return (
    <div style={{ padding: '14px 14px 20px' }}>
      {/* Tournament timing banner */}
      {startsAt && (
        <div style={{
          background: isLive ? 'rgba(126,211,33,0.08)' : 'rgba(245,166,35,0.08)',
          borderLeft: `3px solid ${isLive ? GREEN : '#F5A623'}`,
          borderRadius: 4, padding: '10px 14px', marginBottom: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>
              {isLive ? 'Tournament In Progress' : isUpcoming ? 'Main Draw Starts' : 'Tournament Ended'}
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
              {daysUntilStart === 1 ? 'Tomorrow' : `${daysUntilStart} days`}
            </div>
          )}
          {isLive && (
            <div style={{
              fontSize: 10, fontWeight: 800, color: GREEN,
              background: 'rgba(126,211,33,0.15)', padding: '3px 8px', borderRadius: 4,
              textTransform: 'uppercase', letterSpacing: 0.5,
            }}>
              Live
            </div>
          )}
        </div>
      )}

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
        <StatCard value={totalTeams || (tournament?.draw_size_md ? `${tournament.draw_size_md} pairs` : '\u2014')} label="Teams" accent />
        <StatCard value={totalMatches || '\u2014'} label="Matches" />
        <StatCard value={totalCountries || '\u2014'} label="Countries" />
        <StatCard value={tournament?.prize_money ?? (tournament?.prize_money_fip ? `€${tournament.prize_money_fip.toLocaleString()}` : '\u2014')} label="Prize Money" />
      </div>

      {/* Champion (current tournament, only once the final has been played) */}
      {currentChampion && (
        <ChampionTile
          label="Champion"
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
            label="Defending Champion"
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

      {/* Where to Watch — only shown for Premier-tier tournaments since the
          data we sync from premierpadel.com only covers Premier events */}
      {tournament?.level && ['p1', 'p2', 'major', 'finals'].includes(tournament.level) && (
        <WhereToWatch />
      )}

      {/* Entry List — hero rows for top seeds + compact for rest */}
      <EntryList
        entries={drawEntries as any}
        playerMap={playerMap}
        debutStatusMap={debutStatusMap}
        genderFilter={genderFilter}
      />

      {/* Schedule */}
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
                  {s.date.split('-')[0]?.trim() || '\u2014'}
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
// ── Recap Tab ───────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

function V3Recap({ tournament, allMatches, genderFilter, genderColor }: {
  tournament: any
  allMatches: Match[]
  genderFilter: 'men' | 'women'
  genderColor: string
}) {
  const router = useRouter()
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
      let p1 = s.pair1_games ?? 0
      let p2 = s.pair2_games ?? 0
      if (p1 === 0 && p2 === 0 && s.set_score) {
        const parsed = parseSetScore(s.set_score)
        if (parsed) { p1 = parsed.p1; p2 = parsed.p2 }
      }
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
          <p style={{ color: MUTED, fontWeight: 600, fontSize: 14, margin: 0 }}>Final not played yet</p>
          <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12, marginTop: 6 }}>Check back after the tournament ends</p>
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
                  <V3MatchCard match={upset.match} genderColor={genderColor} />
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  )
}

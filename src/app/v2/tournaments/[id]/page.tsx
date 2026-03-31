'use client'
// src/app/v2/tournaments/[id]/page.tsx
// Tournament detail page — shows matches for a specific tournament
// with gender toggle, stage selector, and realtime updates.

import { useEffect, useState, useCallback, useMemo, useRef, use, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Match, countryFlag, isWarmingUp, toShortName } from '@/types/match'
import MatchCard from '../../../components/MatchCard'
import { useBookmarks } from '@/hooks/useBookmarks'
import SearchOverlay from '../../SearchOverlay'
import Spinner from '../../../components/Spinner'

// ── Stage ordering ────────────────────────────────────────────────────────
const ROUND_ORDER: Record<string, number> = {
  'Finals': 1, 'Final': 1,
  'Semifinals': 2, 'Semifinal': 2, 'Semi': 2,
  'Quarterfinals': 3, 'Quarter': 3, 'Quarters': 3,
  'Round of 16': 4,
  'Round of 32': 5,
  'Round of 64': 6,
}

// Normalize API round names to full display names
function normalizeRoundFull(r: string): string {
  const map: Record<string, string> = {
    'Quarter': 'Quarterfinals', 'Quarters': 'Quarterfinals',
    'Semi': 'Semifinals', 'Semifinal': 'Semifinals',
    'Final': 'Finals',
  }
  return map[r] ?? r
}

// Local date key — kept for scheduled_at date comparison
function localDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function TournamentDetailWrapper({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return (
    <Suspense fallback={<Spinner fullHeight />}>
      <TournamentDetail tournamentId={id} />
    </Suspense>
  )
}

function TournamentDetail({ tournamentId }: { tournamentId: string }) {
  const searchParams = useSearchParams()
  const paramRound = searchParams.get('round')
  const router = useRouter()

  // ── State ─────────────────────────────────────────────────────────────
  const [allMatches, setAllMatches]   = useState<Match[]>([])
  const [tournaments, setTournaments] = useState<any[]>([])
  const [loading, setLoading]         = useState(true)
  const [liveCount, setLiveCount]     = useState(0)
  const [syncAgo, setSyncAgo]         = useState('')
  const [lastSynced, setLastSynced]   = useState<Date | null>(null)
  const [justUpdated, setJustUpdated] = useState(false)

  const [activeTournament, setActiveTournament] = useState<string | null>(null)
  const [selectedRound, setSelectedRound] = useState<string | null>(null)
  const [genderFilter, setGenderFilter] = useState<'men' | 'women'>('men')
  const [pageTab, setPageTab] = useState<'matches' | 'overview' | 'recap'>('matches')
  const stageStripRef = useRef<HTMLDivElement>(null)

  const { isBookmarked, toggle: toggleBookmark } = useBookmarks()
  const [searchOpen, setSearchOpen] = useState(false)

  // ── Fetch ─────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    const { data, error } = await supabase
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
      .order('started_at', { ascending: false })

    if (error) { console.error('v2 fetchAll error:', error); return }

    const sorted = (data as any[]).map(m => ({
      ...m,
      sets: (m.sets ?? []).sort((a: any, b: any) => a.set_number - b.set_number),
    }))

    setAllMatches(sorted)
    setLiveCount(sorted.filter((m: any) => m.status === 'live' && !isWarmingUp(m as Match)).length)
    setLastSynced(new Date())
    setJustUpdated(true)
    setTimeout(() => setJustUpdated(false), 1500)
    setLoading(false)
  }, [tournamentId])

  const fetchTournaments = useCallback(async () => {
    const { data } = await supabase
      .from('tournaments')
      .select('id, name, starts_at, ends_at, country, timezone, level, status, logo_url, venue, prize_money')
      .order('starts_at', { ascending: false })
    if (data) setTournaments(data)
  }, [])

  useEffect(() => { fetchAll(); fetchTournaments() }, [fetchAll, fetchTournaments])

  // ── Realtime — debounced to avoid partial-state renders ───────────────
  // The relay writes match → sets → games in a sequential loop; each individual
  // DB write fires a Supabase realtime event.  Without debouncing, the client
  // fetches 5-10 times per live update and renders intermediate partial states
  // (jumping points, stuck scores).  500 ms captures the whole write burst.
  const realtimeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const handleChange = () => {
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current)
      realtimeDebounceRef.current = setTimeout(fetchAll, 500)
    }
    // Only watch the matches table — the relay writes sets/games first and
    // updates the match row last, so this event fires only when the full
    // snapshot is already consistent in the DB.
    const ch = supabase
      .channel('v2-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, handleChange)
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current)
    }
  }, [fetchAll])

  // ── Sync ago ──────────────────────────────────────────────────────────
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

  // Always use the route param as the active tournament
  useEffect(() => {
    setActiveTournament(tournamentId)
  }, [tournamentId])

  const activeTournamentObj = tournaments.find(t => t.id === activeTournament) ?? null

  // ── Auto-switch gender if no matches exist for the default ────────────
  useEffect(() => {
    if (loading || allMatches.length === 0) return
    const hasMen = allMatches.some(m => (m as any).category === 'men')
    const hasWomen = allMatches.some(m => (m as any).category === 'women')
    if (genderFilter === 'men' && !hasMen && hasWomen) setGenderFilter('women')
    else if (genderFilter === 'women' && !hasWomen && hasMen) setGenderFilter('men')
  }, [loading, allMatches, genderFilter])

  // ── Available rounds for active tournament + gender (ordered R64 → Finals) ─
  const availableRounds = useMemo(() => {
    const seen = new Set<string>()
    for (const m of allMatches) {
      if (activeTournament && (m as any).tournament?.id !== activeTournament) continue
      if ((m as any).category !== genderFilter) continue
      const r = m.round as string | null
      if (r) seen.add(normalizeRoundFull(r))
    }
    // Sort ascending by round number: early rounds first (R64, R32 … Finals)
    return [...seen].sort((a, b) => (ROUND_ORDER[b] ?? 0) - (ROUND_ORDER[a] ?? 0))
  }, [allMatches, activeTournament, genderFilter]) // eslint-disable-line

  // ── Dates per round (for stage pill sub-label) ────────────────────────
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
      map[round] = sorted.length === 1 ? fmt(sorted[0]) : `${fmt(sorted[0])} – ${fmt(sorted[sorted.length - 1])}`
    }
    return map
  }, [allMatches, availableRounds, activeTournament]) // eslint-disable-line

  // Auto-select the current round: prefer live > today's scheduled > most advanced
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
      // If URL has a round param, use it (once)
      if (paramRound && !prev) {
        const normalized = normalizeRoundFull(paramRound)
        if (availableRounds.includes(normalized)) return normalized
      }
      // Don't override a user selection that's still valid
      if (prev && availableRounds.includes(prev)) return prev
      return hasLive ?? hasToday ?? availableRounds[0] ?? null
    })
  }, [availableRounds, activeTournament, paramRound]) // eslint-disable-line

  // Auto-scroll stage strip so the active pill is centred in view
  useEffect(() => {
    if (!selectedRound || !stageStripRef.current) return
    const btn = stageStripRef.current.querySelector<HTMLElement>('[data-active="true"]')
    if (btn) btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [selectedRound])

  // Active stage label for header (live matches stage)
  const activeTournamentStage = useMemo(() => {
    const rounds = allMatches
      .filter(m => m.status === 'live' && (m as any).tournament?.id === activeTournament)
      .map(m => normalizeRoundFull(m.round as string))
      .filter(Boolean)
    return rounds.sort((a, b) => (ROUND_ORDER[a] ?? 99) - (ROUND_ORDER[b] ?? 99))[0] ?? selectedRound ?? null
  }, [allMatches, activeTournament, selectedRound]) // eslint-disable-line

  // ── Filtered matches — by round ──────────────────────────────────────
  const filtered = useMemo(() => {
    return allMatches.filter(m => {
      if (activeTournament && (m as any).tournament?.id !== activeTournament) return false
      if (selectedRound && normalizeRoundFull(m.round as string) !== selectedRound) return false
      if ((m as any).category !== genderFilter) return false
      return true
    })
  }, [allMatches, activeTournament, selectedRound, genderFilter]) // eslint-disable-line

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

  // ── Estimated times for "Followed by" matches ─────────────────────────
  // Parse an AM/PM time label and return {h, m} in tournament local time
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
  // Stable court key: prefer court NAME (physical court identity) over
  // court_order (which is a global sequence number, not a per-court id).
  // Two sequential matches on the same court get consecutive court_order
  // values but the same court name — we need the name to chain them.
  function courtKey(m: any): string | null {
    const c = m.court as string | null
    if (c) return `name:${c}`
    const co = m.court_order as string | number | null
    if (co != null) return `order:${co}`
    return null
  }
  const estimatedLabels = useMemo(() => {
    const map: Record<string, string> = {}

    // Build per-court "estimated next start" floor from live AND recently-finished
    // matches.  When match A (court X) started at T, the next match on court X
    // starts ≈ T+90min.  We key by courtKey() so courts with null court_order
    // (identified only by their name string) are handled correctly.
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
        // Keep the latest floor per court (prefer live over finished)
        if (!floorByCourt[ck] || status === 'live') {
          floorByCourt[ck] = candidate
        }
      } catch { /* ignore */ }
    }

    for (let i = 0; i < scheduledMatches.length; i++) {
      const m = scheduledMatches[i] as any
      const sl = m.schedule_label as string | null
      const mKey = courtKey(m)

      // Hard start time — exact, no estimation needed
      if (sl && /starting at/i.test(sl)) continue

      // Only look at the previous match if it's on the SAME court
      const rawPrev = scheduledMatches[i - 1] as any | undefined
      const prev = (rawPrev && mKey && courtKey(rawPrev) === mKey) ? rawPrev : undefined

      // "Not before X:XX" — minimum time constraint
      if (sl && /not before/i.test(sl)) {
        const prevSl = prev?.schedule_label as string | null
        if (prev && prevSl && /not before/i.test(prevSl)) {
          // Chain: prev was also "Not before" on same court — +90 from it
          const prevLabel = map[prev.id] ?? prevSl
          const parsed = parseAmPm(prevLabel)
          if (parsed) {
            const totalMins = parsed.h * 60 + parsed.m + 90
            map[m.id] = toAmPmLabel(Math.floor(totalMins / 60) % 24, totalMins % 60)
            continue
          }
        }
        // First "Not before" on this court — use own label as floor
        map[m.id] = sl
        continue
      }

      // null / "Followed by" — estimate from previous same-court match + 90 min,
      // or from live/finished match floor if no prior scheduled match on this court
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
      const ca = (a as any).court_order ?? 999
      const cb = (b as any).court_order ?? 999
      if (ca !== cb) return ca - cb
      const ta = (a as any).started_at ?? (a as any).updated_at ?? ''
      const tb = (b as any).started_at ?? (b as any).updated_at ?? ''
      return tb.localeCompare(ta)
    })

  // ── Section header ────────────────────────────────────────────────────
  const SectionHeader = ({ label, color, dot, right, rightColor }: {
    label: string; color?: string; dot?: boolean; right?: string; rightColor?: string
  }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 2px 8px' }}>
      {dot && <span style={{ width: 5, height: 5, borderRadius: '50%', background: color ?? 'var(--text-muted)', flexShrink: 0, animation: 'blink 1.4s ease-in-out infinite' }} />}
      <span style={{ fontSize: 9, color: color ?? 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px' }}>{label}</span>
      <div style={{ flex: 1, height: '1px', background: color ? `${color}18` : 'var(--border-base)' }} />
      {right && <span style={{ fontSize: 9, color: rightColor ?? 'var(--text-faint)', whiteSpace: 'nowrap', transition: 'color 0.4s ease' }}>{right}</span>}
    </div>
  )

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div style={{ background: 'var(--bg-base)', minHeight: '100vh' }}>
      <main style={{
        background: 'var(--bg-base)', minHeight: '100vh',
        maxWidth: 500, margin: '0 auto',
        fontFamily: 'var(--font-sans)',
        borderLeft: '0.5px solid var(--border-base)',
        borderRight: '0.5px solid var(--border-base)',
      }}>

        <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />

        {/* ── Sticky header ── */}
        <div style={{
          background: 'var(--bg-base)', borderBottom: '0.5px solid var(--border-base)',
          padding: '0 14px 0', position: 'sticky', top: 0, zIndex: 10,
        }}>

          {/* ROW 1: Back button + Gender toggle pills + Search */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 0',
          }}>
            <button
              onClick={() => router.back()}
              style={{
                width: 36, height: 36, borderRadius: '50%', border: 'none', cursor: 'pointer',
                background: 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--text-muted)', flexShrink: 0,
              }}
              aria-label="Back"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6"/>
              </svg>
            </button>

            {/* PadelNacho logo — centered */}
            <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
              <img src="/padel-nacho-logo.png" alt="Padel Nachos" style={{ height: 28, width: 'auto', objectFit: 'contain' }} />
            </div>
            <div
              onClick={() => setGenderFilter(g => g === 'men' ? 'women' : 'men')}
              style={{
                display: 'inline-flex', alignItems: 'center', cursor: 'pointer',
                background: 'var(--bg-card-alt)', borderRadius: 14,
                padding: 2, position: 'relative', width: 52, height: 26,
                border: `1px solid ${genderFilter === 'women' ? 'rgba(244,114,182,0.3)' : 'rgba(255,255,255,0.08)'}`,
                transition: 'border-color 0.2s',
              }}
            >
              {/* Sliding pill */}
              <div style={{
                position: 'absolute', top: 2, left: genderFilter === 'men' ? 2 : 26,
                width: 22, height: 22, borderRadius: 11,
                background: genderFilter === 'women' ? 'var(--color-women)' : 'var(--color-accent)',
                transition: 'left 0.2s ease, background 0.2s ease',
              }} />
              <span style={{
                flex: 1, textAlign: 'center', fontSize: 11, fontWeight: 700,
                position: 'relative', zIndex: 1,
                color: genderFilter === 'men' ? '#000' : 'var(--text-faint)',
                transition: 'color 0.2s',
              }}>M</span>
              <span style={{
                flex: 1, textAlign: 'center', fontSize: 11, fontWeight: 700,
                position: 'relative', zIndex: 1,
                color: genderFilter === 'women' ? '#000' : 'var(--text-faint)',
                transition: 'color 0.2s',
              }}>F</span>
            </div>

            <button
              onClick={() => setSearchOpen(true)}
              style={{
                width: 36, height: 36, borderRadius: '50%', border: 'none', cursor: 'pointer',
                background: 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--text-muted)', flexShrink: 0,
              }}
              aria-label="Search"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
              </svg>
            </button>
          </div>

          {/* ROW 2: Tournament card */}
          {activeTournamentObj && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 0', borderTop: '0.5px solid var(--border-base)',
              borderBottom: '0.5px solid var(--border-base)',
            }}>
              {activeTournamentObj.logo_url ? (
                <img
                  src={activeTournamentObj.logo_url}
                  alt=""
                  style={{ width: 68, height: 68, objectFit: 'contain', borderRadius: 8, flexShrink: 0 }}
                />
              ) : activeTournamentObj.country ? (
                <div style={{ width: 68, height: 68, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, flexShrink: 0 }}>
                  {countryFlag(activeTournamentObj.country)}
                </div>
              ) : null}

              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {activeTournamentObj.name}
                </div>

                {activeTournamentObj.venue && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
                    <svg width="10" height="12" viewBox="0 0 24 28" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                      <path d="M12 2C7.58 2 4 5.58 4 10c0 6.63 8 16 8 16s8-9.37 8-16c0-4.42-3.58-8-8-8z"/>
                      <circle cx="12" cy="10" r="2.5" fill="var(--text-muted)" stroke="none"/>
                    </svg>
                    <span style={{
                      fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      letterSpacing: '0.2px',
                    }}>
                      {activeTournamentObj.venue}
                    </span>
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3, flexWrap: 'wrap' }}>
                  {activeTournamentObj.starts_at && activeTournamentObj.ends_at && (
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      {new Date(activeTournamentObj.starts_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      {' – '}
                      {new Date(activeTournamentObj.ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </span>
                  )}
                  {activeTournamentObj.prize_money && (
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>· {activeTournamentObj.prize_money}</span>
                  )}
                  {activeTournamentObj.status && (() => {
                    const s = activeTournamentObj.status as string
                    const isActive = s === 'active' || s === 'live' || s === 'ongoing'
                    const isUpcoming = s === 'upcoming' || s === 'scheduled'
                    const color = isActive ? 'var(--color-live)' : isUpcoming ? 'var(--color-accent)' : 'var(--text-faint)'
                    const bg = isActive ? 'var(--color-live-bg)' : isUpcoming ? 'var(--color-accent-bg)' : 'transparent'
                    const border = isActive ? 'var(--color-live-border)' : isUpcoming ? 'var(--color-accent-border)' : 'var(--border-base)'
                    return (
                      <span style={{ fontSize: 8, fontWeight: 700, color, background: bg, border: `0.5px solid ${border}`, borderRadius: 4, padding: '1px 5px', letterSpacing: '0.4px' }}>
                        {isActive ? '● ' : ''}{s.toUpperCase()}
                      </span>
                    )
                  })()}
                </div>
              </div>

              <span style={{ fontSize: 16, color: 'var(--text-faint)', flexShrink: 0, lineHeight: 1 }}>›</span>
            </div>
          )}

          {/* ROW 3: Page tabs — Matches / Overview / Recap */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border-base)' }}>
            {(['matches', 'overview', 'recap'] as const).map(tab => {
              const active = pageTab === tab
              // Hide Recap for non-finished tournaments
              const isFinished = activeTournamentObj?.status === 'completed' || activeTournamentObj?.status === 'finished'
              if (tab === 'recap' && !isFinished) return null
              return (
                <button
                  key={tab}
                  onClick={() => setPageTab(tab)}
                  style={{
                    flex: 1, padding: '10px 0', border: 'none', background: 'none', cursor: 'pointer',
                    fontSize: 12, fontWeight: 700, letterSpacing: '0.3px', fontFamily: 'inherit',
                    color: active ? 'var(--color-accent)' : 'var(--text-faint)',
                    position: 'relative', transition: 'color 0.2s',
                  }}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  {active && (
                    <span style={{
                      position: 'absolute', bottom: -1, left: '20%', right: '20%',
                      height: 2, borderRadius: 1, background: 'var(--color-accent)',
                    }} />
                  )}
                </button>
              )
            })}
          </div>

          {/* ROW 4: Stage selector strip (Matches tab only) */}
          {pageTab === 'matches' && availableRounds.length > 0 && (
            <div ref={stageStripRef} style={{
              display: 'flex', gap: 6, padding: '8px 0 10px',
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
                      borderRadius: 8,
                      border: active ? '1px solid rgba(56,200,255,0.45)' : '1px solid var(--border-strong)',
                      background: active ? 'rgba(56,200,255,0.08)' : 'var(--bg-card)',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      {hasLive && (
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-live)', flexShrink: 0, animation: 'blink 1.4s ease-in-out infinite' }} />
                      )}
                      <span style={{
                        fontSize: 11, fontWeight: 700, letterSpacing: '0.4px',
                        color: active ? 'var(--color-accent)' : 'var(--text-muted)',
                        textTransform: 'uppercase',
                      }}>
                        {round}
                      </span>
                    </div>
                    {roundDates[round] && (
                      <span style={{
                        fontSize: 8, letterSpacing: '0.2px',
                        color: active ? 'var(--color-accent)' : 'var(--text-faint)',
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
          <div style={{ padding: '6px 10px 16px' }}>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} style={{ background: 'var(--bg-card)', borderRadius: 10, height: 88, marginBottom: 6, opacity: 0.3 }} />
              ))
            ) : (
              <>
                {liveMatches.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <SectionHeader
                      dot color="var(--color-live)" label="Live now"
                      right={syncAgo}
                      rightColor={justUpdated ? 'var(--color-success)' : undefined}
                    />
                    {liveMatches.map(m => <MatchCard key={m.id} match={m} viewerCount={0} expanded={false} onToggle={() => {}} />)}
                  </div>
                )}

                {warmingUpMatches.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <SectionHeader dot color="var(--color-live)" label="Warming up" />
                    {warmingUpMatches.map(m => <MatchCard key={m.id} match={m} viewerCount={0} expanded={false} onToggle={() => {}} />)}
                  </div>
                )}

                {scheduledMatches.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <SectionHeader label="Up next" />
                    {scheduledMatches.map(m => (
                      <MatchCard
                        key={m.id} match={m} viewerCount={0} expanded={false} onToggle={() => {}}
                        bookmarked={isBookmarked(m.id)}
                        onBookmark={() => toggleBookmark(m.id)}
                        estimatedScheduleLabel={estimatedLabels[m.id]}
                      />
                    ))}
                  </div>
                )}

                {finishedMatches.length > 0 && (
                  <div>
                    <SectionHeader label={`Results · ${selectedRound ?? ''}`} />
                    {finishedMatches.map(m => <MatchCard key={m.id} match={m} viewerCount={0} expanded={false} onToggle={() => {}} />)}
                  </div>
                )}

                {liveMatches.length === 0 && warmingUpMatches.length === 0 && scheduledMatches.length === 0 && finishedMatches.length === 0 && (
                  <div style={{ textAlign: 'center', paddingTop: 80 }}>
                    <p style={{ fontSize: 36, marginBottom: 12 }}>🎾</p>
                    <p style={{ color: 'var(--text-muted)', fontWeight: 500 }}>No matches for this stage</p>
                    <p style={{ color: 'var(--text-faint)', fontSize: 13, marginTop: 4 }}>Try selecting a different round</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Overview Tab ── */}
        {pageTab === 'overview' && (
          <TournamentOverview
            tournament={activeTournamentObj}
            allMatches={allMatches}
            genderFilter={genderFilter}
            availableRounds={availableRounds}
            roundDates={roundDates}
          />
        )}

        {/* ── Recap Tab ── */}
        {pageTab === 'recap' && (
          <TournamentRecap
            tournament={activeTournamentObj}
            allMatches={allMatches}
            genderFilter={genderFilter}
          />
        )}
      </main>
    </div>
  )
}

// ── Overview Component ─────────────────────────────────────────────────────
function TournamentOverview({ tournament, allMatches, genderFilter, availableRounds, roundDates }: {
  tournament: any
  allMatches: Match[]
  genderFilter: 'men' | 'women'
  availableRounds: string[]
  roundDates: Record<string, string>
}) {
  const genderMatches = allMatches.filter(m => (m as any).category === genderFilter)
  const totalMatches = genderMatches.length

  // Count unique teams (pairs)
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

  // Build schedule: round → date + count
  const schedule = availableRounds.map(round => {
    const count = genderMatches.filter(m => normalizeRoundFull(m.round as string) === round).length
    return { round, date: roundDates[round] ?? '', count }
  })

  // Top seeds — first round matches where players have rankings, sorted by rank
  const seededTeams: { rank: number; names: string; flag: string }[] = []
  const seenPairs = new Set<string>()
  for (const m of genderMatches) {
    for (const pairKey of [['pair1_player1', 'pair1_player2'], ['pair2_player1', 'pair2_player2']]) {
      const p1 = (m as any)[pairKey[0]]
      const p2 = (m as any)[pairKey[1]]
      if (!p1?.name || !p2?.name) continue
      const key = [p1.name, p2.name].sort().join('/')
      if (seenPairs.has(key)) continue
      seenPairs.add(key)
      const bestRank = Math.min(p1.ranking || 9999, p2.ranking || 9999)
      if (bestRank < 9999) {
        seededTeams.push({
          rank: bestRank,
          names: `${toShortName(p1.name)} / ${toShortName(p2.name)}`,
          flag: countryFlag(p1.country) || countryFlag(p2.country) || '',
        })
      }
    }
  }
  seededTeams.sort((a, b) => a.rank - b.rank)
  const topSeeds = seededTeams.slice(0, 8)

  const StatCard = ({ value, label, accent }: { value: string | number; label: string; accent?: boolean }) => (
    <div style={{
      background: 'var(--bg-card)', borderRadius: 10,
      border: '1px solid var(--border-strong)',
      padding: 12, textAlign: 'center',
    }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent ? 'var(--color-accent)' : 'var(--text-primary)' }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, fontWeight: 600, letterSpacing: '0.3px' }}>{label}</div>
    </div>
  )

  return (
    <div style={{ padding: '14px 14px 20px' }}>
      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
        <StatCard value={totalTeams || '—'} label="TEAMS" accent />
        <StatCard value={totalMatches || '—'} label="MATCHES" />
        <StatCard value={totalCountries || '—'} label="COUNTRIES" />
        <StatCard value={tournament?.prize_money ?? '—'} label="PRIZE MONEY" />
      </div>

      {/* Top seeds */}
      {topSeeds.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 2px 8px' }}>
            <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px' }}>Top Seeds</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border-base)' }} />
          </div>
          <div style={{
            background: 'var(--bg-card)', borderRadius: 12,
            border: '1px solid var(--border-strong)',
            padding: '4px 14px', marginBottom: 16,
          }}>
            {topSeeds.map((seed, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0',
                borderBottom: i < topSeeds.length - 1 ? '0.5px solid var(--border-base)' : 'none',
              }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-faint)', width: 20, textAlign: 'center' }}>
                  {i + 1}
                </span>
                <span style={{ fontSize: 13, flexShrink: 0 }}>{seed.flag}</span>
                <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{seed.names}</span>
                <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>#{seed.rank}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Schedule */}
      {schedule.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 2px 8px' }}>
            <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px' }}>Schedule</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border-base)' }} />
          </div>
          <div style={{
            background: 'var(--bg-card)', borderRadius: 12,
            border: '1px solid var(--border-strong)',
            padding: '4px 14px',
          }}>
            {schedule.map((s, i) => (
              <div key={s.round} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0',
                borderBottom: i < schedule.length - 1 ? '0.5px solid var(--border-base)' : 'none',
              }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: i === 0 ? 'var(--color-accent)' : 'var(--text-muted)', width: 50 }}>
                  {s.date.split('–')[0]?.trim() || '—'}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1 }}>
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

// ── Recap Component ────────────────────────────────────────────────────────
function TournamentRecap({ tournament, allMatches, genderFilter }: {
  tournament: any
  allMatches: Match[]
  genderFilter: 'men' | 'women'
}) {
  const genderMatches = allMatches.filter(m => (m as any).category === genderFilter)
  const finishedMatches = genderMatches.filter(m =>
    ['finished', 'retired', 'walkover', 'ended'].includes(m.status as string)
  )

  // Find the final
  const finalMatch = genderMatches.find(m => {
    const r = normalizeRoundFull(m.round as string)
    return r === 'Finals' && ['finished', 'retired', 'walkover', 'ended'].includes(m.status as string)
  })

  // Find semifinals
  const semiMatches = genderMatches.filter(m => {
    const r = normalizeRoundFull(m.round as string)
    return r === 'Semifinals' && ['finished', 'retired', 'walkover', 'ended'].includes(m.status as string)
  })

  // Determine winner from final match
  const getWinner = (m: Match) => {
    const sets = (m as any).sets ?? []
    let p1Sets = 0, p2Sets = 0
    for (const s of sets) {
      if ((s.pair1_score ?? 0) > (s.pair2_score ?? 0)) p1Sets++
      else if ((s.pair2_score ?? 0) > (s.pair1_score ?? 0)) p2Sets++
    }
    return p1Sets > p2Sets ? 1 : 2
  }

  const formatMatchScore = (m: Match) => {
    const sets = ((m as any).sets ?? []).sort((a: any, b: any) => a.set_number - b.set_number)
    return sets.map((s: any) => `${s.pair1_score ?? 0}-${s.pair2_score ?? 0}`).join('  ')
  }

  const pairDisplay = (m: Match, pair: 1 | 2) => {
    const p1 = pair === 1 ? (m as any).pair1_player1 : (m as any).pair2_player1
    const p2 = pair === 1 ? (m as any).pair1_player2 : (m as any).pair2_player2
    const flag1 = p1?.country ? countryFlag(p1.country) : ''
    const flag2 = p2?.country ? countryFlag(p2.country) : ''
    const name1 = p1?.name ? toShortName(p1.name) : 'TBD'
    const name2 = p2?.name ? toShortName(p2.name) : 'TBD'
    return `${flag1} ${name1} / ${flag2} ${name2}`
  }

  // Stats
  const totalPlayed = finishedMatches.length
  const threeSetMatches = finishedMatches.filter(m => {
    const sets = ((m as any).sets ?? [])
    return sets.length >= 3
  }).length
  const threeSetPct = totalPlayed > 0 ? Math.round((threeSetMatches / totalPlayed) * 100) : 0

  return (
    <div style={{ padding: '14px 14px 20px' }}>
      {/* Winner card */}
      {finalMatch ? (() => {
        const winnerPair = getWinner(finalMatch)
        const loserPair = winnerPair === 1 ? 2 : 1
        return (
          <div style={{
            background: 'linear-gradient(135deg, rgba(56,200,255,0.06), rgba(56,200,255,0.02))',
            border: '1px solid var(--color-accent-border)',
            borderRadius: 14, padding: 16, textAlign: 'center', marginBottom: 16,
          }}>
            <div style={{ fontSize: 36, marginBottom: 6 }}>🏆</div>
            <div style={{ fontSize: 9, color: 'var(--color-accent)', fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 4 }}>
              CHAMPIONS
            </div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>
              {pairDisplay(finalMatch, winnerPair as 1 | 2)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              {formatMatchScore(finalMatch)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6 }}>
              vs {pairDisplay(finalMatch, loserPair as 1 | 2)}
            </div>
          </div>
        )
      })() : (
        <div style={{ textAlign: 'center', padding: '40px 0 20px' }}>
          <p style={{ fontSize: 36, marginBottom: 8 }}>🏆</p>
          <p style={{ color: 'var(--text-muted)', fontWeight: 500, fontSize: 14 }}>Final not played yet</p>
          <p style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 4 }}>Check back after the tournament ends</p>
        </div>
      )}

      {/* Tournament stats */}
      {totalPlayed > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 2px 8px' }}>
            <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px' }}>Tournament Stats</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border-base)' }} />
          </div>
          {[
            { label: 'Total matches played', value: String(totalPlayed) },
            { label: '3-set matches', value: `${threeSetMatches} (${threeSetPct}%)` },
          ].map((stat, i) => (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 12px', background: 'var(--bg-card)', borderRadius: 8,
              marginBottom: 4, border: '1px solid var(--border-strong)',
            }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{stat.label}</span>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{stat.value}</span>
            </div>
          ))}
        </>
      )}

      {/* Semifinal results */}
      {semiMatches.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '16px 2px 8px' }}>
            <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px' }}>Semifinal Results</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border-base)' }} />
          </div>
          {semiMatches.map(m => {
            const winner = getWinner(m)
            return (
              <div key={m.id} style={{
                background: 'var(--bg-card)', border: '1px solid var(--border-strong)',
                borderRadius: 12, padding: '12px 14px', marginBottom: 8,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: winner === 1 ? 'var(--color-accent)' : 'var(--text-primary)', opacity: winner === 1 ? 1 : 0.5 }}>
                    {pairDisplay(m, 1)}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: winner === 1 ? 'var(--text-primary)' : 'var(--text-faint)' }}>
                    {((m as any).sets ?? []).sort((a: any, b: any) => a.set_number - b.set_number).map((s: any) => `${s.pair1_score ?? 0}-${s.pair2_score ?? 0}`).join('  ')}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: winner === 2 ? 'var(--color-accent)' : 'var(--text-primary)', opacity: winner === 2 ? 1 : 0.5 }}>
                    {pairDisplay(m, 2)}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: winner === 2 ? 'var(--text-primary)' : 'var(--text-faint)' }}>
                    {((m as any).sets ?? []).sort((a: any, b: any) => a.set_number - b.set_number).map((s: any) => `${s.pair2_score ?? 0}-${s.pair1_score ?? 0}`).join('  ')}
                  </span>
                </div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

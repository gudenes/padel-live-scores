'use client'
// src/app/v2/page.tsx
// V2 Matches page — B1 Cobalt theme, bottom nav shell (see layout.tsx)
// Shows all leagues by default; auto-selects the live tournament.
// Feed is organised by section headers: Live Now → Up Next → Finished

import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { Match, countryFlag, isWarmingUp } from '@/types/match'
import MatchCard from '../components/MatchCard'
import { useBookmarks } from '@/hooks/useBookmarks'

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

export default function V2Page() {
  // ── State ─────────────────────────────────────────────────────────────
  const [allMatches, setAllMatches]   = useState<Match[]>([])
  const [tournaments, setTournaments] = useState<any[]>([])
  const [loading, setLoading]         = useState(true)
  const [liveCount, setLiveCount]     = useState(0)
  const [syncAgo, setSyncAgo]         = useState('')
  const [lastSynced, setLastSynced]   = useState<Date | null>(null)
  const [justUpdated, setJustUpdated] = useState(false)
  const [localClock, setLocalClock]   = useState('')

  const [activeTournament, setActiveTournament] = useState<string | null>(null)
  const [selectedRound, setSelectedRound] = useState<string | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'men' | 'women'>('all')

  const { isBookmarked, toggle: toggleBookmark } = useBookmarks()

  // ── Clock ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setLocalClock(now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }))
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])

  // ── Fetch ─────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    const { data, error } = await supabase
      .from('matches')
      .select(`
        *,
        tournament:tournaments(id, name, starts_at, ends_at, country, timezone, level),
        pair1_player1:players!matches_pair1_player1_id_fkey(id, name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
        pair1_player2:players!matches_pair1_player2_id_fkey(id, name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
        pair2_player1:players!matches_pair2_player1_id_fkey(id, name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
        pair2_player2:players!matches_pair2_player2_id_fkey(id, name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
        sets(*, games(*))
      `)
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
  }, [])

  const fetchTournaments = useCallback(async () => {
    const { data } = await supabase
      .from('tournaments')
      .select('id, name, starts_at, ends_at, country, timezone, level, status, logo_url, venue, prize_money')
      .order('starts_at', { ascending: false })
    if (data) setTournaments(data)
  }, [])

  useEffect(() => { fetchAll(); fetchTournaments() }, [fetchAll, fetchTournaments])

  // ── Realtime ──────────────────────────────────────────────────────────
  useEffect(() => {
    const ch = supabase
      .channel('v2-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sets' }, fetchAll)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
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

  // ── Tournament helpers ────────────────────────────────────────────────
  const isLiveTournament = (t: any) => {
    if (!t.starts_at || !t.ends_at) return false
    const now = new Date()
    const end = new Date(t.ends_at); end.setHours(23, 59, 59)
    return now >= new Date(t.starts_at) && now <= end
  }

  // Auto-select live tournament on load
  useEffect(() => {
    if (tournaments.length === 0) return
    const live = tournaments.find(isLiveTournament)
    const upcoming = tournaments.find(t => t.starts_at && new Date(t.starts_at) > new Date())
    setActiveTournament(live?.id ?? upcoming?.id ?? tournaments[0]?.id ?? null)
  }, [tournaments]) // eslint-disable-line

  const activeTournamentObj = tournaments.find(t => t.id === activeTournament) ?? null

  // ── Available rounds for active tournament (ordered R64 → Finals) ─────
  const availableRounds = useMemo(() => {
    const seen = new Set<string>()
    for (const m of allMatches) {
      if (activeTournament && (m as any).tournament?.id !== activeTournament) continue
      const r = m.round as string | null
      if (r) seen.add(normalizeRoundFull(r))
    }
    // Sort ascending by round number: early rounds first (R64, R32 … Finals)
    return [...seen].sort((a, b) => (ROUND_ORDER[b] ?? 0) - (ROUND_ORDER[a] ?? 0))
  }, [allMatches, activeTournament]) // eslint-disable-line

  // ── Dates per round (for stage pill sub-label) ────────────────────────
  const roundDates = useMemo(() => {
    const map: Record<string, string> = {}
    for (const round of availableRounds) {
      const dates = new Set<string>()
      for (const m of allMatches) {
        if (activeTournament && (m as any).tournament?.id !== activeTournament) continue
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
      // Don't override a user selection that's still valid
      if (prev && availableRounds.includes(prev)) return prev
      return hasLive ?? hasToday ?? availableRounds[0] ?? null
    })
  }, [availableRounds, activeTournament]) // eslint-disable-line

  // Active stage label for header (live matches stage)
  const activeTournamentStage = useMemo(() => {
    const rounds = allMatches
      .filter(m => m.status === 'live' && (m as any).tournament?.id === activeTournament)
      .map(m => normalizeRoundFull(m.round as string))
      .filter(Boolean)
    return rounds.sort((a, b) => (ROUND_ORDER[a] ?? 99) - (ROUND_ORDER[b] ?? 99))[0] ?? selectedRound ?? null
  }, [allMatches, activeTournament, selectedRound]) // eslint-disable-line

  // ── Filtered matches — by round + category ───────────────────────────
  const filtered = useMemo(() => {
    return allMatches.filter(m => {
      if (activeTournament && (m as any).tournament?.id !== activeTournament) return false
      if (selectedRound && normalizeRoundFull(m.round as string) !== selectedRound) return false
      if (selectedCategory !== 'all') {
        const cat = (m as any).category as string | null
        if (!cat || cat !== selectedCategory) return false
      }
      return true
    })
  }, [allMatches, activeTournament, selectedRound, selectedCategory]) // eslint-disable-line

  const liveMatches      = filtered.filter(m => m.status === 'live' && !isWarmingUp(m))
  const warmingUpMatches = filtered.filter(m => m.status === 'live' && isWarmingUp(m))
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
  const estimatedLabels = useMemo(() => {
    const map: Record<string, string> = {}
    for (let i = 0; i < scheduledMatches.length; i++) {
      const m = scheduledMatches[i] as any
      const sl = m.schedule_label as string | null

      // Hard start time — exact, no estimation needed
      if (sl && /starting at/i.test(sl)) continue

      // "Not before X:XX" — a minimum time constraint, not a guaranteed start.
      // If the previous match was also "Not before", apply the +90min rule to keep
      // consistent spacing (the second "Not before" just raised the floor arbitrarily).
      // Otherwise use the own label as the floor for the start of a new time block.
      if (sl && /not before/i.test(sl)) {
        const prev = scheduledMatches[i - 1] as any | undefined
        const prevSl = prev?.schedule_label as string | null
        if (prev && prevSl && /not before/i.test(prevSl)) {
          // Chain: previous was also "Not before" — estimate +90 from it
          const prevLabel = map[prev.id] ?? prevSl
          const parsed = parseAmPm(prevLabel)
          if (parsed) {
            const totalMins = parsed.h * 60 + parsed.m + 90
            map[m.id] = toAmPmLabel(Math.floor(totalMins / 60) % 24, totalMins % 60)
            continue
          }
        }
        // First "Not before" in the block — use own label as the time floor
        map[m.id] = sl
        continue
      }

      // null / "Followed by" / other — estimate from previous match + 90 min
      const prev = scheduledMatches[i - 1] as any | undefined
      if (!prev) continue

      // Use prev's hard label or whatever estimate we already computed for it
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
  }, [scheduledMatches]) // eslint-disable-line
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

        {/* ── Sticky header ── */}
        <div style={{
          background: 'var(--bg-base)', borderBottom: '0.5px solid var(--border-base)',
          padding: '8px 14px 0', position: 'sticky', top: 0, zIndex: 10,
        }}>

          {/* ROW 1: Wordmark + clock + live count */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <img src="/padel-nacho-logo.png" alt="Padel Nacho" style={{ height: 32, width: 'auto', objectFit: 'contain' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {localClock && (
                <div style={{
                  border: '1px solid var(--border-strong)', borderRadius: 8,
                  padding: '3px 10px', textAlign: 'center',
                  background: 'var(--bg-card)',
                }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', lineHeight: 1.2, letterSpacing: '-0.3px' }}>{localClock}</div>
                  <div style={{ fontSize: 8, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.3px', textTransform: 'uppercase' }}>
                    {Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, ' ').split('/').pop()}
                  </div>
                </div>
              )}
              {liveCount > 0 && (
                <div style={{
                  background: 'var(--color-live-bg)', border: '1px solid var(--color-live-border)',
                  borderRadius: 8, padding: '3px 9px', display: 'flex', alignItems: 'center', gap: 5,
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--color-live)', display: 'inline-block', animation: 'blink 1.4s ease-in-out infinite' }} />
                  <span style={{ fontSize: 10, color: 'var(--color-live)', fontWeight: 800, letterSpacing: '0.3px', textTransform: 'uppercase' }}>{liveCount} live</span>
                </div>
              )}
            </div>
          </div>

          {/* ROW 2: Tournament row — logo + name + stage + chevron to switch */}
          {activeTournamentObj && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 0', borderTop: '0.5px solid var(--border-base)',
              borderBottom: '0.5px solid var(--border-base)',
            }}>
              {/* Logo — prefer logo_url, fall back to flag emoji */}
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

              {/* Name · venue · dates · status */}
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {activeTournamentObj.name}
                </div>

                {/* Venue — location pin icon + name */}
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

                {/* Dates + prize money + status */}
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

              {/* Chevron */}
              <span style={{ fontSize: 16, color: 'var(--text-faint)', flexShrink: 0, lineHeight: 1 }}>›</span>
            </div>
          )}

          {/* ROW 3: Gender segmented control */}
          <div style={{ display: 'flex', padding: '8px 0 0', gap: 0 }}>
            {(['all', 'men', 'women'] as const).map((cat, i) => {
              const active = selectedCategory === cat
              const catColor = cat === 'men' ? 'var(--color-men)' : cat === 'women' ? 'var(--color-women)' : 'var(--text-secondary)'
              const catBg = cat === 'men' ? 'var(--color-men-bg)' : cat === 'women' ? 'var(--color-women-bg)' : 'rgba(255,255,255,0.05)'
              const catBorder = cat === 'men' ? 'var(--color-men-border)' : cat === 'women' ? 'var(--color-women-border)' : 'var(--border-strong)'
              const label = cat === 'all' ? 'All' : cat === 'men' ? '♂ Men' : '♀ Women'
              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  style={{
                    flex: 1, padding: '6px 0',
                    border: `1px solid ${active ? catBorder : 'var(--border-strong)'}`,
                    borderRadius: i === 0 ? '7px 0 0 7px' : i === 2 ? '0 7px 7px 0' : '0',
                    borderLeft: i > 0 ? 'none' : undefined,
                    background: active ? catBg : 'var(--bg-card)',
                    cursor: 'pointer',
                    fontSize: 11, fontWeight: 700, letterSpacing: '0.4px', textTransform: 'uppercase',
                    color: active ? catColor : 'var(--text-muted)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>

          {/* ROW 4: Stage selector strip */}
          {availableRounds.length > 0 && (
            <div style={{
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

        {/* ── Feed ── */}
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
      </main>
    </div>
  )
}

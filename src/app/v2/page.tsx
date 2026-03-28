'use client'
// src/app/v2/page.tsx
// V2 homepage — separate route, zero changes to existing app/page.tsx
// Layout: Logo | League tabs | Sub-tier tabs | Tournament row | Date strip | Filters | Feed

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Match, countryFlag, isWarmingUp } from '@/types/match'
import MatchCard from '../components/MatchCard'

// ── League / tier mapping ─────────────────────────────────────────────────
type LeagueId = 'premier' | 'fip'
type TierId = 'finals' | 'major' | 'p1' | 'p2' | 'fip_platinum' | 'fip_gold' | 'fip_other'

interface TierDef {
  id: TierId
  label: string
  levels: string[]     // DB level values that belong to this tier
}

const LEAGUES: { id: LeagueId; label1: string; label2: string; tiers: TierDef[] }[] = [
  {
    id: 'premier',
    label1: 'Premier',
    label2: 'Padel',
    tiers: [
      { id: 'finals',  label: 'Finals',  levels: ['finals'] },
      { id: 'major',   label: 'Major',   levels: ['major'] },
      { id: 'p1',      label: 'P1',      levels: ['p1'] },
      { id: 'p2',      label: 'P2',      levels: ['p2'] },
    ],
  },
  {
    id: 'fip',
    label1: 'Cupra FIP',
    label2: 'Tour',
    tiers: [
      { id: 'fip_platinum', label: 'Platinum', levels: ['fip_platinum'] },
      { id: 'fip_gold',     label: 'Gold',     levels: ['fip_gold'] },
      { id: 'fip_other',    label: 'Other',    levels: ['fip_other'] },
    ],
  },
]

// ── Date helpers ──────────────────────────────────────────────────────────
// Returns YYYY-MM-DD in the user's *local* timezone (not UTC)
function localDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getDateStrip(): { date: Date; label: string; key: string }[] {
  const today = new Date()
  const days = []
  for (let i = -2; i <= 2; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    const key = localDateKey(d)
    const label = i === 0 ? 'Today'
      : i === -1 ? 'Yesterday'
      : d.toLocaleDateString('en-GB', { weekday: 'short' })
    days.push({ date: d, label, key })
  }
  return days
}

function matchDay(m: Match): string {
  const src = (m as any).started_at ?? (m as any).scheduled_at ?? (m as any).finished_at
  if (!src) return 'Unknown'
  try { return localDateKey(new Date(src)) } catch { return src.slice(0, 10) }
}

type StatusFilter = 'all' | 'live' | 'scheduled' | 'finished'
type GenderFilter = 'all' | 'men' | 'women'

// ── Pill helpers ──────────────────────────────────────────────────────────
const pillBase: React.CSSProperties = {
  border: '0.5px solid #222',
  borderRadius: 20,
  padding: '3px 10px',
  fontSize: 10,
  color: '#444',
  fontWeight: 600,
  background: 'transparent',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  fontFamily: 'var(--font-sans)',
}

export default function V2Page() {
  const router = useRouter()

  // ── State ─────────────────────────────────────────────────────────────
  const [allMatches, setAllMatches]     = useState<Match[]>([])
  const [tournaments, setTournaments]   = useState<any[]>([])
  const [loading, setLoading]           = useState(true)
  const [liveCount, setLiveCount]       = useState(0)
  const [syncAgo, setSyncAgo]           = useState('')
  const [lastSynced, setLastSynced]     = useState<Date | null>(null)
  const [justUpdated, setJustUpdated]   = useState(false)
  const [localClock, setLocalClock]     = useState('')

  const [activeLeague, setActiveLeague] = useState<LeagueId>('premier')
  const [activeTier, setActiveTier]     = useState<TierId>('p1')
  const [activeTournament, setActiveTournament] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().slice(0, 10))
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [genderFilter, setGenderFilter] = useState<GenderFilter>('all')

  // ── Clock ────────────────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setLocalClock(now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }))
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])

  // ── Fetch ────────────────────────────────────────────────────────────
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
      .select('id, name, starts_at, ends_at, country, timezone, level')
      .order('starts_at', { ascending: false })
    if (data) setTournaments(data)
  }, [])

  useEffect(() => { fetchAll(); fetchTournaments() }, [fetchAll, fetchTournaments])

  // ── Realtime ─────────────────────────────────────────────────────────
  useEffect(() => {
    const ch = supabase
      .channel('v2-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sets' }, fetchAll)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [fetchAll])

  // ── Sync ago ─────────────────────────────────────────────────────────
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

  // ── Derived data ──────────────────────────────────────────────────────
  const currentLeague   = LEAGUES.find(l => l.id === activeLeague)!
  const currentTierDef  = currentLeague.tiers.find(t => t.id === activeTier) ?? currentLeague.tiers[0]
  const activeLevels    = currentTierDef.levels

  const today = localDateKey(new Date())
  const dateStrip = useMemo(() => getDateStrip(), [])

  // Tournaments belonging to current tier
  const tierTournaments = useMemo(() =>
    tournaments.filter(t => activeLevels.includes(t.level ?? ''))
  , [tournaments, activeLevels])

  // Active tournament = selected, or first live one, or first upcoming
  const isLiveTournament = (t: any) => {
    if (!t.starts_at || !t.ends_at) return false
    const now = new Date()
    const end = new Date(t.ends_at); end.setHours(23, 59, 59)
    return now >= new Date(t.starts_at) && now <= end
  }

  const isUpcomingTournament = (t: any) => {
    if (!t.starts_at) return false
    return new Date(t.starts_at) > new Date()
  }

  const liveTierTournaments     = tierTournaments.filter(isLiveTournament)
  const upcomingTierTournaments = tierTournaments.filter(isUpcomingTournament)

  // Auto-select live tier when league changes or tournaments load
  useEffect(() => {
    if (tournaments.length === 0) return
    const league = LEAGUES.find(l => l.id === activeLeague)!
    const now = new Date()
    const liveTier = league.tiers.find(tier =>
      tournaments.some(t => {
        if (!t.starts_at || !t.ends_at || !tier.levels.includes(t.level ?? '')) return false
        const end = new Date(t.ends_at); end.setHours(23, 59, 59)
        return now >= new Date(t.starts_at) && now <= end
      })
    )
    const upcomingTier = league.tiers.find(tier =>
      tournaments.some(t => t.starts_at && tier.levels.includes(t.level ?? '') && new Date(t.starts_at) > now)
    )
    setActiveTier(liveTier?.id ?? upcomingTier?.id ?? league.tiers[0].id)
  }, [activeLeague, tournaments]) // eslint-disable-line

  // Auto-select active tournament when tier changes
  useEffect(() => {
    if (liveTierTournaments.length > 0) {
      setActiveTournament(liveTierTournaments[0].id)
    } else if (upcomingTierTournaments.length > 0) {
      setActiveTournament(upcomingTierTournaments[0].id)
    } else {
      setActiveTournament(tierTournaments[0]?.id ?? null)
    }
  }, [activeTier, activeLeague]) // eslint-disable-line

  const activeTournamentObj = tierTournaments.find(t => t.id === activeTournament) ?? null

  // Live counts per league/tier for badges
  const liveMatchTournamentIds = useMemo(() => {
    const ids = new Set<string>()
    allMatches.filter(m => m.status === 'live').forEach(m => {
      const tid = (m as any).tournament?.id
      if (tid) ids.add(tid)
    })
    return ids
  }, [allMatches])

  function liveCountForLevels(levels: string[]): number {
    return allMatches.filter(m => {
      if (m.status !== 'live') return false
      const t = (m as any).tournament
      return t && levels.includes(t.level ?? '')
    }).length
  }

  // Filter matches
  const filtered = useMemo(() => {
    return allMatches
      .filter(m => !activeTournament || (m as any).tournament?.id === activeTournament)
      .filter(m => genderFilter === 'all' || (m as any).category === genderFilter)
      .filter(m => {
        if (statusFilter !== 'all') {
          if (statusFilter === 'finished') return ['finished', 'retired', 'walkover', 'ended'].includes(m.status as string)
          return m.status === statusFilter
        }
        return true
      })
      .filter(m => {
        const day = matchDay(m)
        if (['finished', 'retired', 'ended', 'walkover'].includes(m.status as string)) {
          return day === selectedDate
        }
        if (m.status === 'scheduled') {
          const src = (m as any).scheduled_at ?? (m as any).started_at
          if (!src) return selectedDate === today
          return src.slice(0, 10) === selectedDate
        }
        // live: always show on today
        return selectedDate === today
      })
  }, [allMatches, activeTournament, genderFilter, statusFilter, selectedDate, today])

  const liveMatches      = filtered.filter(m => m.status === 'live' && !isWarmingUp(m))
  const warmingUpMatches = filtered.filter(m => m.status === 'live' && isWarmingUp(m))
  const scheduledMatches = filtered
    .filter(m => m.status === 'scheduled')
    .sort((a: any, b: any) => {
      const da = a.scheduled_at ?? a.started_at ?? ''
      const db = b.scheduled_at ?? b.started_at ?? ''
      if (da !== db) return da.localeCompare(db)
      return (a.round ?? 99) - (b.round ?? 99)
    })
  const finishedMatches = filtered
    .filter(m => ['finished', 'retired', 'walkover', 'ended'].includes(m.status as string))
    .sort((a: any, b: any) => {
      const ta = a.started_at ?? a.updated_at ?? ''
      const tb = b.started_at ?? b.updated_at ?? ''
      return tb.localeCompare(ta) // newest first
    })

  // Stage label for tournament row
  const stageOrder: Record<string, number> = { 'Finals': 1, 'Semifinals': 2, 'Quarterfinals': 3, 'Round of 16': 4, 'Round of 32': 5 }
  const activeTournamentStage = useMemo(() => {
    const matches = allMatches.filter(m =>
      m.status === 'live' && (m as any).tournament?.id === activeTournament
    )
    if (!matches.length) return null
    const rounds = matches.map(m => m.round as string).filter(Boolean)
    const norm: Record<string, string> = { 'Quarter': 'Quarterfinals', 'Semi': 'Semifinals', 'Final': 'Finals' }
    const normalized = rounds.map(r => norm[r] ?? r)
    return normalized.sort((a, b) => (stageOrder[a] ?? 99) - (stageOrder[b] ?? 99))[0] ?? null
  }, [allMatches, activeTournament]) // eslint-disable-line

  // ── Styles ────────────────────────────────────────────────────────────
  const s = {
    page: { background: 'var(--bg-base)', minHeight: '100vh' } as React.CSSProperties,
    main: {
      background: 'var(--bg-base)', minHeight: '100vh',
      maxWidth: 500, margin: '0 auto',
      fontFamily: 'var(--font-sans)',
      borderLeft: '0.5px solid var(--border-base)',
      borderRight: '0.5px solid var(--border-base)',
    } as React.CSSProperties,
    sectionHeader: (right?: string) => ({
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '2px 2px 6px',
    } as React.CSSProperties),
  }

  // ── Render helpers ────────────────────────────────────────────────────
  const SectionHeader = ({ label, color, dot, right, rightColor }: {
    label: string; color?: string; dot?: boolean; right?: string; rightColor?: string
  }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 2px 6px' }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: color ?? '#aaa', flexShrink: 0 }} />}
      <span style={{ fontSize: 11, color: color ?? '#aaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.6px' }}>{label}</span>
      <div style={{ flex: 1, height: '0.5px', background: color ? `${color}25` : '#272727' }} />
      {right && <span style={{ fontSize: 10, color: rightColor ?? '#666', whiteSpace: 'nowrap', transition: 'color 0.4s ease' }}>{right}</span>}
    </div>
  )

  // ── JSX ───────────────────────────────────────────────────────────────
  return (
    <div style={s.page}>
      <main style={s.main}>

        {/* ── ROW 1: Logo + clock + live badge ── */}
        <div style={{
          background: 'var(--bg-base)', borderBottom: '0.5px solid var(--border-base)',
          padding: '6px 14px 0', position: 'sticky', top: 0, zIndex: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <img src="/padel-nacho-logo.png" alt="Padel Nacho" style={{ height: 36, width: 'auto', objectFit: 'contain' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Clock */}
              {localClock && (
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  background: 'transparent', border: '0.5px solid var(--border-strong)',
                  borderRadius: 20, padding: '4px 12px', gap: 1,
                }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', lineHeight: 1, letterSpacing: '0.5px' }}>{localClock}</span>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 500, letterSpacing: '0.2px' }}>
                    {Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, ' ').split('/').pop()}
                  </span>
                </div>
              )}
              {/* Live badge */}
              {liveCount > 0 && (
                <div style={{
                  background: 'var(--color-live-bg)', border: '0.5px solid var(--color-live-border)',
                  borderRadius: 20, padding: '3px 10px', display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--color-live)', display: 'inline-block', animation: 'blink 1.4s ease-in-out infinite' }} />
                  <span style={{ fontSize: 11, color: 'var(--color-live)', fontWeight: 600 }}>{liveCount} live</span>
                </div>
              )}
            </div>
          </div>

          {/* ── ROW 2: League tabs ── */}
          <div style={{ display: 'flex', gap: 0, borderBottom: '0.5px solid var(--border-base)', marginTop: 2 }}>
            {LEAGUES.map(league => {
              const isActive = activeLeague === league.id
              const allLevels = league.tiers.flatMap(t => t.levels)
              const liveCnt = liveCountForLevels(allLevels)
              return (
                <button
                  key={league.id}
                  onClick={() => {
                    setActiveLeague(league.id)
                    setActiveTier(league.tiers[0].id)
                  }}
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    gap: 8, padding: '8px 10px 7px',
                    borderBottom: isActive ? '2px solid var(--color-live)' : '2px solid transparent',
                    background: 'transparent',
                    borderTop: 'none', borderLeft: 'none',
                    borderRight: league.id === 'premier' ? '0.5px solid var(--border-base)' : 'none',
                    cursor: 'pointer',
                  } as React.CSSProperties}
                >
                  {/* League logo — SVG icon */}
                  {league.id === 'premier' ? (
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <rect x="3" y="3" width="10" height="10" rx="2"
                        fill={isActive ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.03)'}
                        stroke={isActive ? '#ef4444' : '#333'} strokeWidth="1"/>
                      <path d="M5 8 L8 5 L11 8 L8 11 Z" fill={isActive ? '#ef4444' : '#333'}/>
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <circle cx="8" cy="8" r="5.5" stroke={isActive ? '#f5a623' : '#333'} strokeWidth="1"/>
                      <path d="M4.5 8.5 Q8 4.5 11.5 8.5" stroke={isActive ? '#f5a623' : '#333'} strokeWidth="1.5" fill="none" strokeLinecap="round"/>
                      <circle cx="8" cy="8" r="1.5" fill={isActive ? '#f5a623' : '#333'}/>
                    </svg>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
                    <span style={{ fontSize: 9, fontWeight: 800, color: isActive ? (league.id === 'premier' ? '#ef4444' : '#f5a623') : '#444', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                      {league.label1}
                    </span>
                    <span style={{ fontSize: 9, fontWeight: 700, color: isActive ? '#fff' : '#333', letterSpacing: '0.3px', textTransform: 'uppercase' }}>
                      {league.label2}
                    </span>
                  </div>
                  {liveCnt > 0 && (
                    <span style={{
                      fontSize: 8, color: '#ef4444',
                      background: 'rgba(239,68,68,0.1)', border: '0.5px solid rgba(239,68,68,0.25)',
                      borderRadius: 10, padding: '1px 5px', marginLeft: 2,
                    }}>{liveCnt} live</span>
                  )}
                </button>
              )
            })}
          </div>

          {/* ── ROW 3: Tournament row ── */}
          {activeTournamentObj && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '9px 14px', background: 'var(--bg-card)',
              borderBottom: '0.5px solid var(--border-base)',
            }}>
              {/* Flag */}
              {activeTournamentObj.country && (
                <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }}>
                  {countryFlag(activeTournamentObj.country)}
                </span>
              )}
              {/* Name + meta */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {activeTournamentObj.name}
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>
                  {activeTournamentObj.starts_at && activeTournamentObj.ends_at
                    ? `${new Date(activeTournamentObj.starts_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${new Date(activeTournamentObj.ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
                    : ''
                  }
                  {activeTournamentStage && ` · ${activeTournamentStage}`}
                </div>
              </div>
              {/* Live indicator */}
              {isLiveTournament(activeTournamentObj) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                  <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--color-live)', display: 'inline-block', animation: 'blink 1.4s ease-in-out infinite' }} />
                  <span style={{ fontSize: 9, color: 'var(--color-live)', fontWeight: 600 }}>
                    {liveCountForLevels(activeLevels)} live
                  </span>
                </div>
              )}
              {/* Upcoming button */}
              {upcomingTierTournaments.length > 0 && (
                <button
                  onClick={() => router.push('/tournaments')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    background: 'var(--bg-input)', border: '0.5px solid var(--border-strong)',
                    borderRadius: 6, padding: '5px 8px', cursor: 'pointer', flexShrink: 0,
                  }}
                >
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    Upcoming
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>›</span>
                </button>
              )}
            </div>
          )}

          {/* ── Date strip ── */}
          <div style={{ borderBottom: '0.5px solid var(--border-base)' }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '0 14px' }}>
              <span style={{ fontSize: 14, color: '#333', padding: '5px 2px', flexShrink: 0 }}>‹</span>
              {dateStrip.map(({ key, label, date }) => {
                const isActive = key === selectedDate
                return (
                  <button
                    key={key}
                    onClick={() => setSelectedDate(key)}
                    style={{
                      flex: 1, textAlign: 'center', padding: '5px 2px',
                      background: 'transparent', border: 'none',
                      borderBottom: isActive ? '2px solid var(--color-live)' : '2px solid transparent',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontSize: 8, color: isActive ? 'var(--color-live)' : '#333', fontWeight: 500 }}>{label}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: isActive ? '#fff' : '#444' }}>
                      {date.getDate()}
                    </div>
                  </button>
                )
              })}
              <span style={{ fontSize: 14, color: '#333', padding: '5px 2px', flexShrink: 0 }}>›</span>
            </div>
            <div style={{ textAlign: 'right', padding: '0 16px 3px' }}>
              <span style={{ fontSize: 8, color: 'var(--text-dim)' }}>
                Local time · {Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, ' ').split('/').pop()}
              </span>
            </div>
          </div>

          {/* ── Status + gender filters ── */}
          <div style={{ display: 'flex', gap: 6, padding: '6px 14px 6px', alignItems: 'center', overflowX: 'auto', scrollbarWidth: 'none' } as any}>
            {/* Live filter */}
            <button
              onClick={() => setStatusFilter(statusFilter === 'live' ? 'all' : 'live')}
              style={{
                ...pillBase,
                background: statusFilter === 'live' ? 'var(--color-live-bg)' : 'transparent',
                border: statusFilter === 'live' ? '0.5px solid var(--color-live-border)' : '0.5px solid #222',
                color: statusFilter === 'live' ? 'var(--color-live)' : '#444',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              {liveCount > 0 && <span style={{ width: 4, height: 4, borderRadius: '50%', background: statusFilter === 'live' ? 'var(--color-live)' : '#444', display: 'inline-block' }} />}
              Live {liveCount > 0 ? `(${liveCount})` : ''}
            </button>
            {/* Gender */}
            <div style={{ display: 'flex', background: 'var(--bg-card)', borderRadius: 20, border: '0.5px solid var(--border-strong)', overflow: 'hidden' }}>
              {(['all', 'men', 'women'] as GenderFilter[]).map(g => (
                <button key={g} onClick={() => setGenderFilter(g)} style={{
                  fontSize: 11, padding: '3px 12px',
                  background: genderFilter === g ? 'rgba(255,255,255,0.08)' : 'transparent',
                  border: 'none',
                  borderLeft: g !== 'all' ? '0.5px solid var(--border-strong)' : 'none',
                  color: genderFilter === g ? (g === 'men' ? 'var(--color-men)' : g === 'women' ? 'var(--color-women)' : '#aaa') : 'var(--text-dim)',
                  cursor: 'pointer', fontWeight: genderFilter === g ? 600 : 400, fontFamily: 'var(--font-sans)',
                }}>
                  {g === 'all' ? 'All' : g === 'men' ? 'Men' : 'Women'}
                </button>
              ))}
            </div>
            {/* Finished */}
            <button
              onClick={() => setStatusFilter(statusFilter === 'finished' ? 'all' : 'finished')}
              style={{
                ...pillBase,
                background: statusFilter === 'finished' ? 'rgba(255,255,255,0.06)' : 'transparent',
                border: statusFilter === 'finished' ? '0.5px solid rgba(255,255,255,0.15)' : '0.5px solid #222',
                color: statusFilter === 'finished' ? 'var(--text-secondary)' : '#444',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              Finished {statusFilter === 'finished' && <span style={{ opacity: 0.7 }}>✕</span>}
            </button>
          </div>
        </div>

        {/* ── Feed ── */}
        <div style={{ padding: '6px 10px 40px' }}>
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{ background: 'var(--bg-card)', borderRadius: 12, height: 88, marginBottom: 6, opacity: 0.4 }} />
            ))
          ) : (
            <>
              {/* Live */}
              {liveMatches.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <SectionHeader
                    color="var(--color-live)" dot label="Live now"
                    right={syncAgo}
                    rightColor={justUpdated ? 'var(--color-success)' : undefined}
                  />
                  {liveMatches.map(m => <MatchCard key={m.id} match={m} viewerCount={0} expanded={false} onToggle={() => {}} />)}
                </div>
              )}

              {/* Warming up */}
              {warmingUpMatches.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <SectionHeader color="var(--color-live)" label="Warming up" />
                  {warmingUpMatches.map(m => <MatchCard key={m.id} match={m} viewerCount={0} expanded={false} onToggle={() => {}} />)}
                </div>
              )}

              {/* Scheduled */}
              {scheduledMatches.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <SectionHeader label="Up next" />
                  {scheduledMatches.map(m => <MatchCard key={m.id} match={m} viewerCount={0} expanded={false} onToggle={() => {}} />)}
                </div>
              )}

              {/* Finished */}
              {finishedMatches.length > 0 && (
                <div>
                  <SectionHeader label={`Results · ${selectedDate === today ? 'Today' : new Date(selectedDate).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`} />
                  {finishedMatches.map(m => <MatchCard key={m.id} match={m} viewerCount={0} expanded={false} onToggle={() => {}} />)}
                </div>
              )}

              {/* Empty */}
              {liveMatches.length === 0 && warmingUpMatches.length === 0 && scheduledMatches.length === 0 && finishedMatches.length === 0 && (
                <div style={{ textAlign: 'center', paddingTop: 80 }}>
                  <p style={{ fontSize: 36, marginBottom: 12 }}>🎾</p>
                  <p style={{ color: 'var(--text-muted)', fontWeight: 500 }}>No matches on this day</p>
                  <p style={{ color: 'var(--text-dim)', fontSize: 14, marginTop: 4 }}>Try selecting a different date</p>
                </div>
              )}
            </>
          )}
        </div>

      </main>
    </div>
  )
}

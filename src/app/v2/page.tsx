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

// ── Date helpers ──────────────────────────────────────────────────────────
function localDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getDateStrip(): { date: Date; label: string; key: string }[] {
  const today = new Date()
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(today)
    d.setDate(today.getDate() + i - 2)
    const key = localDateKey(d)
    const label = i === 2 ? 'Today'
      : i === 1 ? 'Yesterday'
      : d.toLocaleDateString('en-GB', { weekday: 'short' })
    return { date: d, label, key }
  })
}

function matchDay(m: Match): string {
  const src = (m as any).started_at ?? (m as any).scheduled_at ?? (m as any).finished_at
  if (!src) return 'unknown'
  // For pure date strings (YYYY-MM-DD) skip the Date constructor to avoid UTC→local shift
  if (typeof src === 'string' && src.length === 10) return src
  try { return localDateKey(new Date(src)) } catch { return src.slice(0, 10) }
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
  const [selectedDate, setSelectedDate] = useState<string>(localDateKey(new Date()))

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
      .select('id, name, starts_at, ends_at, country, timezone, level')
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

  // ── Date strip ────────────────────────────────────────────────────────
  const today = localDateKey(new Date())
  const dateStrip = useMemo(() => getDateStrip(), [])

  // ── Stage label ───────────────────────────────────────────────────────
  const stageOrder: Record<string, number> = { Finals: 1, Semifinals: 2, Quarterfinals: 3, 'Round of 16': 4, 'Round of 32': 5 }
  const activeTournamentStage = useMemo(() => {
    const norm: Record<string, string> = { Quarter: 'Quarterfinals', Semi: 'Semifinals', Final: 'Finals' }
    const rounds = allMatches
      .filter(m => m.status === 'live' && (m as any).tournament?.id === activeTournament)
      .map(m => norm[m.round as string] ?? m.round as string)
      .filter(Boolean)
    return rounds.sort((a, b) => (stageOrder[a] ?? 99) - (stageOrder[b] ?? 99))[0] ?? null
  }, [allMatches, activeTournament]) // eslint-disable-line

  // ── Filtered matches ──────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return allMatches
      .filter(m => !activeTournament || (m as any).tournament?.id === activeTournament)
      .filter(m => {
        if (['finished', 'retired', 'ended', 'walkover'].includes(m.status as string)) {
          return matchDay(m) === selectedDate
        }
        if (m.status === 'scheduled') {
          const src = (m as any).scheduled_at ?? (m as any).started_at
          if (!src) return selectedDate === today
          // scheduled_at is stored as UTC midnight ("2026-03-28T00:00:00+00:00").
          // Running it through the Date constructor + localDateKey() shifts it back one day
          // in any UTC− timezone (e.g. Miami UTC-4 → March 27).
          // Take the ISO date prefix directly — it always equals the intended match day.
          if (typeof src === 'string') return src.slice(0, 10) === selectedDate
          try { return localDateKey(new Date(src)) === selectedDate } catch { return src.slice(0, 10) === selectedDate }
        }
        return selectedDate === today // live always on today
      })
  }, [allMatches, activeTournament, selectedDate, today])

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
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 2px 7px' }}>
      {dot && <span style={{ width: 5, height: 5, borderRadius: '50%', background: color ?? 'var(--text-muted)', flexShrink: 0, animation: 'blink 1.4s ease-in-out infinite' }} />}
      <span style={{ fontSize: 10, color: color ?? 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px' }}>{label}</span>
      <div style={{ flex: 1, height: '0.5px', background: color ? `${color}22` : 'var(--border-base)' }} />
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
                  border: '0.5px solid var(--border-strong)', borderRadius: 20,
                  padding: '3px 10px', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', lineHeight: 1.2 }}>{localClock}</div>
                  <div style={{ fontSize: 8, color: 'var(--text-muted)' }}>
                    {Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, ' ').split('/').pop()}
                  </div>
                </div>
              )}
              {liveCount > 0 && (
                <div style={{
                  background: 'var(--color-live-bg)', border: '0.5px solid var(--color-live-border)',
                  borderRadius: 20, padding: '3px 9px', display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--color-live)', display: 'inline-block', animation: 'blink 1.4s ease-in-out infinite' }} />
                  <span style={{ fontSize: 10, color: 'var(--color-live)', fontWeight: 700 }}>{liveCount} live</span>
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
                  style={{ width: 56, height: 56, objectFit: 'contain', borderRadius: 12, background: 'var(--bg-card-alt)', padding: 4, flexShrink: 0, boxShadow: '0 0 0 1px var(--color-accent-border), 0 4px 12px rgba(0,0,0,0.4)' }}
                />
              ) : activeTournamentObj.country ? (
                <div style={{ width: 56, height: 56, borderRadius: 12, background: 'var(--bg-card-alt)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, flexShrink: 0, boxShadow: '0 0 0 1px var(--color-accent-border)' }}>
                  {countryFlag(activeTournamentObj.country)}
                </div>
              ) : null}

              {/* Name + dates + stage */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {activeTournamentObj.name}
                </div>
                <div style={{ fontSize: 8, color: 'var(--text-muted)', marginTop: 2 }}>
                  {activeTournamentObj.starts_at && activeTournamentObj.ends_at && (
                    `${new Date(activeTournamentObj.starts_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${new Date(activeTournamentObj.ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
                  )}
                  {activeTournamentStage && ` · ${activeTournamentStage}`}
                </div>
              </div>

              {/* Chevron — tapping it will navigate to Tournaments tab in future */}
              <span style={{ fontSize: 16, color: 'var(--text-faint)', flexShrink: 0, lineHeight: 1 }}>›</span>
            </div>
          )}

          {/* ROW 3: Date strip */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '0 12px' }}>
            <span style={{ fontSize: 13, color: 'var(--text-ghost)', padding: '0 2px', flexShrink: 0 }}>‹</span>
            {dateStrip.map(({ key, label, date }) => {
              const active = key === selectedDate
              return (
                <button
                  key={key}
                  onClick={() => setSelectedDate(key)}
                  style={{
                    flex: 1, textAlign: 'center', padding: '10px 2px 9px',
                    background: 'transparent', border: 'none',
                    borderBottom: active ? '2px solid var(--color-accent)' : '2px solid transparent',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontSize: 8, color: active ? 'var(--color-accent)' : 'var(--text-faint)', fontWeight: 500 }}>{label}</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: active ? 'var(--text-primary)' : 'var(--text-ghost)', marginTop: 3 }}>
                    {date.getDate()}
                  </div>
                </button>
              )
            })}
            <span style={{ fontSize: 13, color: 'var(--text-ghost)', padding: '0 2px', flexShrink: 0 }}>›</span>
          </div>
          {/* No "Local time" label — clock in header already shows the timezone */}
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
                    />
                  ))}
                </div>
              )}

              {finishedMatches.length > 0 && (
                <div>
                  <SectionHeader label={selectedDate === today
                    ? 'Results · Today'
                    : `Results · ${new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`
                  } />
                  {finishedMatches.map(m => <MatchCard key={m.id} match={m} viewerCount={0} expanded={false} onToggle={() => {}} />)}
                </div>
              )}

              {liveMatches.length === 0 && warmingUpMatches.length === 0 && scheduledMatches.length === 0 && finishedMatches.length === 0 && (
                <div style={{ textAlign: 'center', paddingTop: 80 }}>
                  <p style={{ fontSize: 36, marginBottom: 12 }}>🎾</p>
                  <p style={{ color: 'var(--text-muted)', fontWeight: 500 }}>No matches on this day</p>
                  <p style={{ color: 'var(--text-faint)', fontSize: 13, marginTop: 4 }}>Try selecting a different date</p>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  )
}

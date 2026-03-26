'use client'
// src/app/page.tsx

import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { Match, countryFlag, isWarmingUp } from '@/types/match'
import MatchCard from './components/MatchCard'

type Gender = 'all' | 'men' | 'women'
type StatusFilter = 'all' | 'live' | 'scheduled' | 'finished'

const STAGE_ORDER: Record<string, number> = {
  'Finals': 1, 'Semifinals': 2, 'Quarter': 3,
  'Round of 16': 4, 'Round of 32': 5, 'Round of 64': 6,
}
function stageOrder(r: string) { return STAGE_ORDER[r] ?? 99 }

function isLiveTournament(starts?: string | null, ends?: string | null) {
  if (!starts || !ends) return false
  const today = new Date()
  const end = new Date(ends); end.setHours(23, 59, 59)
  return today >= new Date(starts) && today <= end
}

function matchDay(m: Match): string {
  const src = (m as any).started_at ?? (m as any).scheduled_at ?? (m as any).played_at
  if (!src) return 'Unknown'
  return src.slice(0, 10)
}

function dayLabel(dateStr: string): string {
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  if (dateStr === today) return 'Today'
  if (dateStr === yesterday) return 'Yesterday'
  return new Date(dateStr).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

export default function HomePage() {
  const [allMatches, setAllMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)
  const [tournaments, setTournaments] = useState<{ id: string; name: string; starts_at?: string; ends_at?: string; country?: string; timezone?: string }[]>([])
  const [activeTournament, setActiveTournament] = useState<string>('all')
  const [activeGender, setActiveGender] = useState<Gender>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [dateFilter, setDateFilter] = useState<string | null>(null)
  const [showDateStrip, setShowDateStrip] = useState(false)
  const [pastExpanded, setPastExpanded] = useState(false)
  const [liveCount, setLiveCount] = useState(0)
  const [lastSynced, setLastSynced] = useState<Date | null>(null)
  const [syncAgo, setSyncAgo] = useState<string>('')
  const [justUpdated, setJustUpdated] = useState(false)
  const [localClock, setLocalClock] = useState('')

  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setLocalClock(now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }))
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])

  const fetchAll = useCallback(async () => {
    const { data, error } = await supabase
      .from('matches')
      .select(`
        *,
        tournament:tournaments(id, name, starts_at, ends_at, country, timezone),
        pair1_player1:players!matches_pair1_player1_id_fkey(id, name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
        pair1_player2:players!matches_pair1_player2_id_fkey(id, name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
        pair2_player1:players!matches_pair2_player1_id_fkey(id, name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
        pair2_player2:players!matches_pair2_player2_id_fkey(id, name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
        sets(*, games(*))
      `)
      // ── Added 'walkover' to the status filter ──
      .in('status', ['live', 'scheduled', 'finished', 'retired', 'walkover', 'ended', 'bye'])
      .order('court_order', { ascending: true, nullsFirst: false })
      .order('started_at', { ascending: false })

    if (error) { console.error('fetchAll error:', error); return }

    const sorted = (data as any[]).map(m => ({
      ...m,
      sets: (m.sets ?? []).sort((a: any, b: any) => a.set_number - b.set_number),
    }))
    setAllMatches(sorted)
    // ── Live count: only count matches that are truly live (not warming up) ──
    setLiveCount(sorted.filter((m: any) => m.status === 'live' && !isWarmingUp(m as Match)).length)
    setLastSynced(new Date())
    setJustUpdated(true)
    setTimeout(() => setJustUpdated(false), 1500)
    setLoading(false)
  }, [])

  const fetchTournaments = useCallback(async () => {
    const { data } = await supabase.from('tournaments').select('id, name, starts_at, ends_at, country, timezone').order('starts_at', { ascending: false })
    if (data) {
      setTournaments(data)
      const live = data.find((t: any) => isLiveTournament(t.starts_at, t.ends_at))
      if (live) setActiveTournament(live.id)
    }
  }, [])

  useEffect(() => {
    fetchAll()
    fetchTournaments()
  }, [fetchAll, fetchTournaments])

  useEffect(() => {
    const channel = supabase
      .channel('feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sets' }, fetchAll)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchAll])

  const matchDays = useMemo(() => {
    const days = new Set(allMatches.filter(m => ['finished', 'retired', 'ended'].includes(m.status as string)).map(matchDay))
    return [...days].sort((a, b) => a.localeCompare(b))
  }, [allMatches])

  // Update "updated X ago" every 5 seconds
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

  const filtered = useMemo(() => {
    return allMatches
      .filter(m => activeTournament === 'all' || (m as any).tournament?.id === activeTournament)
      .filter(m => activeGender === 'all' || (m as any).category === activeGender)
      .filter(m => statusFilter === 'all' || m.status === statusFilter)
      .filter(m => !dateFilter || matchDay(m) === dateFilter)
  }, [allMatches, activeTournament, activeGender, statusFilter, dateFilter])

  // ── Live: exclude warming up matches from the live feed ──
  const liveMatches = filtered.filter(m => m.status === 'live' && !isWarmingUp(m))

  // ── Warming up: shown separately below live if any ──
  const warmingUpMatches = filtered.filter(m => m.status === 'live' && isWarmingUp(m))

  const scheduledMatches = filtered.filter(m => m.status === 'scheduled' && ((m as any).pair1_player1 || (m as any).pair2_player1)).sort((a: any, b: any) => (a.court_order ?? 99) - (b.court_order ?? 99))

  // ── Finished: includes retired and walkover ──
  // ended = transitional (score being confirmed) — show in results with CONFIRMING badge
  // bye = no match played — hide from feed
  const finishedMatches = filtered.filter(m => ['finished', 'retired', 'walkover', 'ended'].includes(m.status as string))

  const finishedByDay = useMemo(() => {
    const map: Record<string, Match[]> = {}
    finishedMatches.forEach(m => {
      const d = matchDay(m)
      if (!map[d]) map[d] = []
      map[d].push(m)
    })
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a))
  }, [finishedMatches])

  const liveTournaments = tournaments.filter(t => isLiveTournament(t.starts_at, t.ends_at))
  const pastTournaments = tournaments.filter(t => !isLiveTournament(t.starts_at, t.ends_at))
  const activeTz = tournaments.find(t => t.id === activeTournament)?.timezone
  const localTime = activeTz ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: activeTz }).format(new Date()) : null

  const TournamentPill = ({ t, isActive }: { t: typeof tournaments[0]; isActive: boolean }) => {
    const live = isLiveTournament(t.starts_at, t.ends_at)
    return (
      <button onClick={() => setActiveTournament(t.id)} style={{
        flexShrink: 0, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8,
        fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 20,
        background: isActive ? 'var(--color-success-bg)' : 'transparent',
        border: isActive ? '0.5px solid var(--color-success-border)' : '0.5px solid var(--border-strong)',
        color: isActive ? 'var(--color-success)' : 'var(--text-muted)', cursor: 'pointer', whiteSpace: 'nowrap',
      }}>
        {live && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--color-live)', display: 'inline-block', flexShrink: 0, animation: 'blink 1.4s ease-in-out infinite' }} />}
        {t.country && <span style={{ fontSize: 14 }}>{countryFlag(t.country)}</span>}
        {t.name}
        {t.starts_at && t.ends_at && (
          <span style={{ fontSize: 10, fontWeight: 400, color: isActive ? 'rgba(16,185,129,0.6)' : 'var(--text-faint)', marginTop: 1 }}>
            {new Date(t.starts_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – {new Date(t.ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
          </span>
        )}
      </button>
    )
  }

  return (
    <div style={{ background: 'var(--bg-base)', minHeight: '100vh' }}>
      <main style={{ background: 'var(--bg-base)', minHeight: '100vh', maxWidth: 500, margin: '0 auto', fontFamily: 'var(--font-sans)', borderLeft: '0.5px solid var(--border-base)', borderRight: '0.5px solid var(--border-base)' }}>

        {/* ── Sticky header ── */}
        <div style={{ background: 'var(--bg-base)', borderBottom: '0.5px solid var(--border-base)', padding: '6px 14px 0', position: 'sticky', top: 0, zIndex: 10 }}>

          {/* Logo + clock + live badge */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <img src="/padel-nacho-logo.png" alt="Padel Nacho" style={{ height: 36, width: 'auto', objectFit: 'contain' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {localClock && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'transparent', border: '0.5px solid var(--border-strong)', borderRadius: 20, padding: '4px 12px', gap: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', lineHeight: 1, letterSpacing: '0.5px' }}>{localClock}</span>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 500, letterSpacing: '0.2px' }}>
                    {Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, ' ').split('/').pop()}
                  </span>
                </div>
              )}
              {liveCount > 0 && (
                <div style={{ background: 'var(--color-live-bg)', border: '0.5px solid var(--color-live-border)', borderRadius: 20, padding: '3px 10px', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--color-live)', display: 'inline-block', animation: 'blink 1.4s ease-in-out infinite' }} />
                  <span style={{ fontSize: 11, color: 'var(--color-live)', fontWeight: 600 }}>{liveCount} live</span>
                </div>
              )}
            </div>
          </div>

          {/* Tournament pills */}
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6, scrollbarWidth: 'none' } as any}>
            {liveTournaments.map(t => <TournamentPill key={t.id} t={t} isActive={activeTournament === t.id} />)}
            {pastTournaments.length > 0 && (
              <>
                <button onClick={() => setPastExpanded(p => !p)} style={{ flexShrink: 0, fontSize: 11, color: 'var(--text-dim)', background: 'transparent', border: '0.5px solid var(--border-strong)', borderRadius: 20, padding: '5px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                  Completed <span style={{ fontSize: 10 }}>{pastExpanded ? '‹' : '›'}</span>
                </button>
                {pastExpanded && pastTournaments.map(t => <TournamentPill key={t.id} t={t} isActive={activeTournament === t.id} />)}
              </>
            )}
          </div>
        </div>

        {/* ── Sticky filter strip ── */}
        <div style={{ background: 'var(--bg-base)', borderBottom: '0.5px solid var(--border-base)', position: 'sticky', top: 72, zIndex: 9 }}>

          {/* Row 1 — Gender */}
          <div style={{ display: 'flex', gap: 6, padding: '6px 14px 4px', alignItems: 'center' }}>
            <div style={{ display: 'flex', background: 'var(--bg-card)', borderRadius: 20, border: '0.5px solid var(--border-strong)', overflow: 'hidden' }}>
              {(['all', 'men', 'women'] as Gender[]).map(g => (
                <button key={g} onClick={() => setActiveGender(g)} style={{
                  fontSize: 11, padding: '3px 12px',
                  background: activeGender === g ? 'rgba(255,255,255,0.08)' : 'transparent',
                  border: 'none', borderLeft: g !== 'all' ? '0.5px solid var(--border-strong)' : 'none',
                  color: activeGender === g ? (g === 'men' ? 'var(--color-men)' : g === 'women' ? 'var(--color-women)' : '#aaa') : 'var(--text-dim)',
                  cursor: 'pointer', fontWeight: activeGender === g ? 600 : 400, fontFamily: 'var(--font-sans)',
                }}>
                  {g === 'all' ? 'All' : g === 'men' ? 'Men' : 'Women'}
                </button>
              ))}
            </div>
          </div>

          {/* Row 2 — Status + Date */}
          <div style={{ display: 'flex', gap: 6, padding: '2px 14px 6px', alignItems: 'center' }}>
            {(['live', 'scheduled', 'finished'] as StatusFilter[]).map(s => {
              const isActive = statusFilter === s
              const colors: Record<string, string> = { live: 'var(--color-live)', scheduled: 'var(--color-success)', finished: 'var(--text-secondary)' }
              const bgs: Record<string, string> = { live: 'var(--color-live-bg)', scheduled: 'var(--color-success-bg)', finished: 'rgba(255,255,255,0.06)' }
              const borders: Record<string, string> = { live: 'var(--color-live-border)', scheduled: 'var(--color-success-border)', finished: 'rgba(255,255,255,0.15)' }
              return (
                <button key={s} onClick={() => setStatusFilter(isActive ? 'all' : s)} style={{
                  fontSize: 11, padding: '3px 10px', borderRadius: 20, flexShrink: 0, cursor: 'pointer', fontFamily: 'var(--font-sans)',
                  border: isActive ? `0.5px solid ${borders[s]}` : '0.5px solid var(--border-strong)',
                  background: isActive ? bgs[s] : 'transparent',
                  color: isActive ? colors[s] : 'var(--text-dim)',
                  fontWeight: isActive ? 600 : 400,
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  {s === 'live' && <span style={{ width: 5, height: 5, borderRadius: '50%', background: isActive ? 'var(--color-live)' : 'var(--text-dim)', display: 'inline-block' }} />}
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                  {isActive && <span style={{ opacity: 0.7 }}>✕</span>}
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Feed ── */}
        <div style={{ padding: '6px 10px 40px' }}>
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{ background: 'var(--bg-card)', borderRadius: 12, height: 88, marginBottom: 6, opacity: 0.4 }} />
            ))
          ) : (
            <div style={{ display: 'block' }}>

              {/* ── LIVE SECTION ── */}
              {liveMatches.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <SectionHeader
                    color="var(--color-live)"
                    dot
                    label="Live now"
                    badge={liveMatches[0] ? (liveMatches[0] as any).round ?? '' : ''}
                    right={syncAgo || (localTime ? `Local ${localTime}` : undefined)}
                    rightColor={justUpdated ? 'var(--color-success)' : undefined}
                  />
                  <div style={{ display: 'block' }}>
                    {(() => {
                      const hasCategories = liveMatches.some((m: any) => m.category === 'men' || m.category === 'women')
                      if (!hasCategories || liveMatches.length <= 4) {
                        return liveMatches.map(m => <MatchCard key={m.id} match={m} viewerCount={0} expanded={false} onToggle={() => {}} />)
                      }
                      return ['men', 'women'].map(gender => {
                        const gMatches = liveMatches.filter((m: any) => m.category === gender)
                        if (!gMatches.length) return null
                        return (
                          <div key={gender} style={{ marginBottom: 10 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                              <span style={{ fontSize: 9, color: gender === 'men' ? 'var(--color-men)' : 'var(--color-women)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                                {gender === 'men' ? 'Men' : 'Women'} · {gMatches.length} live
                              </span>
                              <div style={{ flex: 1, height: '0.5px', background: gender === 'men' ? 'rgba(96,165,250,0.2)' : 'rgba(248,113,113,0.2)' }} />
                            </div>
                            {gMatches.map(m => <MatchCard key={m.id} match={m} viewerCount={0} expanded={false} onToggle={() => {}} />)}
                          </div>
                        )
                      })
                    })()}
                  </div>
                </div>
              )}

              {/* ── WARMING UP SECTION ── */}
              {warmingUpMatches.length > 0 && (statusFilter === 'all' || statusFilter === 'live') && (
                <div style={{ marginBottom: 16 }}>
                  <SectionHeader
                    color="var(--color-live)"
                    label="Warming up"
                  />
                  <div style={{ display: 'block' }}>
                    {warmingUpMatches.map(m => (
                      <MatchCard key={m.id} match={m} viewerCount={0} expanded={false} onToggle={() => {}} />
                    ))}
                  </div>
                </div>
              )}

              {/* ── UP NEXT SECTION ── */}
              {scheduledMatches.length > 0 && (statusFilter === 'all' || statusFilter === 'scheduled') && (
                <div style={{ marginBottom: 16 }}>
                  <SectionHeader label="Up next" />
                  <div style={{ display: 'block' }}>
                    {scheduledMatches.map(m => (
                      <MatchCard key={m.id} match={m} viewerCount={0} expanded={false} onToggle={() => {}} />
                    ))}
                  </div>
                </div>
              )}

              {/* ── RESULTS SECTION ── */}
              {finishedMatches.length > 0 && (statusFilter === 'all' || statusFilter === 'finished') && (
                <div>
                  {finishedByDay.map(([day, dayMatches]) => (
                    <div key={day} style={{ marginBottom: 12 }}>
                      <SectionHeader
                        label={dayLabel(day)}
                        right={new Date(day).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                      />
                      {dayMatches.map(m => <MatchCard key={m.id} match={m} viewerCount={0} expanded={false} onToggle={() => {}} />)}
                    </div>
                  ))}
                </div>
              )}

              {/* Empty state */}
              {liveMatches.length === 0 && warmingUpMatches.length === 0 && scheduledMatches.length === 0 && finishedMatches.length === 0 && (
                <div style={{ textAlign: 'center', paddingTop: 80 }}>
                  <p style={{ fontSize: 36, marginBottom: 12 }}>🎾</p>
                  <p style={{ color: 'var(--text-muted)', fontWeight: 500 }}>No matches found</p>
                  <p style={{ color: 'var(--text-dim)', fontSize: 14, marginTop: 4 }}>Try changing your filters</p>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

function SectionHeader({ label, color, dot, badge, right, rightColor }: { label: string; color?: string; dot?: boolean; badge?: string; right?: string; rightColor?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 2px 6px' }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: color ?? '#aaa', flexShrink: 0 }} />}
      <span style={{ fontSize: 11, color: color ?? '#aaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.6px' }}>{label}</span>
      {badge && <span style={{ fontSize: 9, color: 'var(--text-dim)', background: 'var(--bg-input)', borderRadius: 8, padding: '1px 6px' }}>{badge}</span>}
      <div style={{ flex: 1, height: '0.5px', background: color ? `${color}25` : '#272727' }} />
      {right && <span style={{ fontSize: 10, color: rightColor ?? '#666', whiteSpace: 'nowrap', transition: 'color 0.4s ease' }}>{right}</span>}
    </div>
  )
}

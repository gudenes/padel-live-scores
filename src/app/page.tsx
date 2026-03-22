'use client'
// src/app/page.tsx

import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { Match, countryFlag } from '@/types/match'
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

  // Fetch all matches in one query
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
        sets(*)
      `)
      .in('status', ['live', 'scheduled', 'finished'])
      .order('court_order', { ascending: true, nullsFirst: false })
      .order('started_at', { ascending: false })

    if (error) { console.error('fetchAll error:', error); return }

    const sorted = (data as any[]).map(m => ({
      ...m,
      sets: (m.sets ?? []).sort((a: any, b: any) => a.set_number - b.set_number),
    }))
    setAllMatches(sorted)
    setLiveCount(sorted.filter((m: any) => m.status === 'live').length)
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

  // All unique match days
  const matchDays = useMemo(() => {
    const days = new Set(allMatches.filter(m => m.status === 'finished').map(matchDay))
    return [...days].sort((a, b) => a.localeCompare(b)) // oldest left, newest right
  }, [allMatches])

  // Filtered matches
  const filtered = useMemo(() => {
    return allMatches
      .filter(m => activeTournament === 'all' || (m as any).tournament?.id === activeTournament)
      .filter(m => activeGender === 'all' || (m as any).category === activeGender)
      .filter(m => statusFilter === 'all' || m.status === statusFilter)
      .filter(m => !dateFilter || matchDay(m) === dateFilter)
  }, [allMatches, activeTournament, activeGender, statusFilter, dateFilter])

  const liveMatches = filtered.filter(m => m.status === 'live')
  const scheduledMatches = filtered.filter(m => m.status === 'scheduled').sort((a: any, b: any) => (a.court_order ?? 99) - (b.court_order ?? 99))
  const finishedMatches = filtered.filter(m => m.status === 'finished')

  // Group finished by day
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

  const activeFiltersCount = [statusFilter !== 'all', dateFilter !== null].filter(Boolean).length

  const TournamentPill = ({ t, isActive }: { t: typeof tournaments[0]; isActive: boolean }) => {
    const live = isLiveTournament(t.starts_at, t.ends_at)
    return (
      <button onClick={() => setActiveTournament(t.id)} style={{
        flexShrink: 0, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8,
        fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 20,
        background: isActive ? 'rgba(16,185,129,0.1)' : 'transparent',
        border: isActive ? '0.5px solid rgba(16,185,129,0.3)' : '0.5px solid #2a2a2a',
        color: isActive ? '#10b981' : '#555', cursor: 'pointer', whiteSpace: 'nowrap',
      }}>
        {live && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#ef4444', display: 'inline-block', flexShrink: 0 }} />}
        {t.country && <span style={{ fontSize: 14 }}>{countryFlag(t.country)}</span>}
        {t.name}
        {t.starts_at && t.ends_at && (
          <span style={{ fontSize: 10, fontWeight: 400, color: isActive ? 'rgba(16,185,129,0.6)' : '#3a3a3a', marginTop: 1 }}>
            {new Date(t.starts_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – {new Date(t.ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
          </span>
        )}
      </button>
    )
  }

  return (
    <div style={{ background: '#111', minHeight: '100vh' }}>
    <main style={{ background: '#111', minHeight: '100vh', maxWidth: 500, margin: '0 auto', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', borderLeft: '0.5px solid #1e1e1e', borderRight: '0.5px solid #1e1e1e' }}>

      <div style={{ background: '#111', borderBottom: '0.5px solid #1e1e1e', padding: '6px 14px 0', position: 'sticky', top: 0, zIndex: 10 }}>

        {/* Logo + live badge */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <img src="/padel-nacho-logo.png" alt="Padel Nacho" style={{ height: 36, width: 'auto', objectFit: 'contain' }} />
          {liveCount > 0 && (
            <div style={{ background: 'rgba(239,68,68,0.12)', border: '0.5px solid rgba(239,68,68,0.3)', borderRadius: 20, padding: '3px 10px', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#ef4444', display: 'inline-block', animation: 'blink 1.4s ease-in-out infinite' }} />
              <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 600 }}>{liveCount} live</span>
            </div>
          )}
        </div>

        {/* Tournament pills */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6, scrollbarWidth: 'none' } as any}>
          {liveTournaments.map(t => <TournamentPill key={t.id} t={t} isActive={activeTournament === t.id} />)}
          {pastTournaments.length > 0 && (
            <>
              <button onClick={() => setPastExpanded(p => !p)} style={{ flexShrink: 0, fontSize: 11, color: '#444', background: 'transparent', border: '0.5px solid #2a2a2a', borderRadius: 20, padding: '5px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                Completed <span style={{ fontSize: 10 }}>{pastExpanded ? '‹' : '›'}</span>
              </button>
              {pastExpanded && pastTournaments.map(t => <TournamentPill key={t.id} t={t} isActive={activeTournament === t.id} />)}
            </>
          )}
        </div>
      </div>

      <div style={{ background: '#111', borderBottom: '0.5px solid #1e1e1e', position: 'sticky', top: 72, zIndex: 9 }}>
        {/* Row 1 — Gender */}
        <div style={{ display: 'flex', gap: 6, padding: '6px 14px 4px', alignItems: 'center' }}>
          <div style={{ display: 'flex', background: '#1a1a1a', borderRadius: 20, border: '0.5px solid #2a2a2a', overflow: 'hidden' }}>
            {(['all', 'men', 'women'] as Gender[]).map(g => (
              <button key={g} onClick={() => setActiveGender(g)} style={{
                fontSize: 11, padding: '3px 12px', background: activeGender === g ? 'rgba(255,255,255,0.08)' : 'transparent',
                border: 'none', borderLeft: g !== 'all' ? '0.5px solid #2a2a2a' : 'none',
                color: activeGender === g ? (g === 'men' ? '#60a5fa' : g === 'women' ? '#f87171' : '#aaa') : '#444',
                cursor: 'pointer', fontWeight: activeGender === g ? 600 : 400, fontFamily: 'inherit',
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
            const colors: Record<string, string> = { live: '#ef4444', scheduled: '#10b981', finished: '#888' }
            const bgs: Record<string, string> = { live: 'rgba(239,68,68,0.08)', scheduled: 'rgba(16,185,129,0.08)', finished: 'rgba(255,255,255,0.06)' }
            const borders: Record<string, string> = { live: 'rgba(239,68,68,0.3)', scheduled: 'rgba(16,185,129,0.3)', finished: 'rgba(255,255,255,0.15)' }
            return (
              <button key={s} onClick={() => setStatusFilter(isActive ? 'all' : s)} style={{
                fontSize: 11, padding: '3px 10px', borderRadius: 20, flexShrink: 0, cursor: 'pointer', fontFamily: 'inherit',
                border: isActive ? `0.5px solid ${borders[s]}` : '0.5px solid #2a2a2a',
                background: isActive ? bgs[s] : 'transparent',
                color: isActive ? colors[s] : '#444',
                fontWeight: isActive ? 600 : 400,
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                {s === 'live' && <span style={{ width: 5, height: 5, borderRadius: '50%', background: isActive ? '#ef4444' : '#444', display: 'inline-block' }} />}
                {s.charAt(0).toUpperCase() + s.slice(1)}
                {isActive && <span style={{ opacity: 0.7 }}>✕</span>}
              </button>
            )
          })}
          <div style={{ width: 4 }} />
          <button onClick={() => setShowDateStrip(p => !p)} style={{
            fontSize: 11, padding: '3px 10px', borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit',
            border: dateFilter ? '0.5px solid rgba(16,185,129,0.4)' : '0.5px solid #2a2a2a',
            background: dateFilter ? 'rgba(16,185,129,0.1)' : 'transparent',
            color: dateFilter ? '#10b981' : '#444', fontWeight: dateFilter ? 600 : 400,
            display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
          }}>
            {dateFilter ? (
              <>{dayLabel(dateFilter)} <span onClick={(e) => { e.stopPropagation(); setDateFilter(null) }} style={{ opacity: 0.7 }}>✕</span></>
            ) : 'By date'}
          </button>
        </div>

        {/* Date strip */}
        {showDateStrip && (
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '0 14px 8px', scrollbarWidth: 'none' } as any}>
            {matchDays.map(day => {
              const isSelected = dateFilter === day
              const count = allMatches.filter(m => m.status === 'finished' && matchDay(m) === day).length
              const d = new Date(day)
              return (
                <button key={day} onClick={() => { setDateFilter(isSelected ? null : day); setShowDateStrip(false) }} style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flexShrink: 0,
                  padding: '6px 10px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
                  background: isSelected ? 'rgba(16,185,129,0.12)' : '#1a1a1a',
                  border: isSelected ? '0.5px solid rgba(16,185,129,0.4)' : '0.5px solid #272727',
                }}>
                  <span style={{ fontSize: 9, color: isSelected ? '#10b981' : '#555', fontWeight: 700 }}>
                    {d.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase()}
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 800, color: isSelected ? '#10b981' : '#666' }}>
                    {d.getDate()}
                  </span>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: isSelected ? '#10b981' : count > 4 ? '#444' : '#2a2a2a' }} />
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Feed ── */}
      <div style={{ padding: '6px 10px 40px' }}>
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={{ background: '#1a1a1a', borderRadius: 12, height: 88, marginBottom: 6, opacity: 0.4 }} />
          ))
        ) : (
          <div style={{ display: 'block' }}>
            {/* ── LIVE SECTION ── */}
            {liveMatches.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <SectionHeader
                  color="#ef4444"
                  dot
                  label="Live now"
                  badge={liveMatches[0] ? (liveMatches[0] as any).round ?? '' : ''}
                  right={localTime ? `Local ${localTime}` : undefined}
                />
                <div style={{ display: 'block' }}>
                  {liveMatches.length <= 4 ? (
                    liveMatches.map(m => <MatchCard key={m.id} match={m} viewerCount={0} expanded={false} onToggle={() => {}} />)
                  ) : (
                    ['men', 'women'].map(gender => {
                      const gMatches = liveMatches.filter((m: any) => m.category === gender)
                      if (!gMatches.length) return null
                      return (
                        <div key={gender} style={{ marginBottom: 10 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                            <span style={{ fontSize: 9, color: gender === 'men' ? '#60a5fa' : '#f87171', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                              {gender === 'men' ? 'Men' : 'Women'} · {gMatches.length} live
                            </span>
                            <div style={{ flex: 1, height: '0.5px', background: gender === 'men' ? 'rgba(96,165,250,0.15)' : 'rgba(248,113,113,0.15)' }} />
                          </div>
                          {gMatches.map(m => <MatchCard key={m.id} match={m} viewerCount={0} expanded={false} onToggle={() => {}} />)}
                        </div>
                      )
                    })
                  )}
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
            {liveMatches.length === 0 && scheduledMatches.length === 0 && finishedMatches.length === 0 && (
              <div style={{ textAlign: 'center', paddingTop: 80 }}>
                <p style={{ fontSize: 36, marginBottom: 12 }}>🎾</p>
                <p style={{ color: '#555', fontWeight: 500 }}>No matches found</p>
                <p style={{ color: '#444', fontSize: 14, marginTop: 4 }}>Try changing your filters</p>
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
        button:focus { outline: none; }
        ::-webkit-scrollbar { display: none; }
      `}</style>
    </main>
    </div>
  )
}

function SectionHeader({ label, color, dot, badge, right }: { label: string; color?: string; dot?: boolean; badge?: string; right?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 2px 6px' }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: color ?? '#555', flexShrink: 0 }} />}
      <span style={{ fontSize: 11, color: color ?? '#555', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</span>
      {badge && <span style={{ fontSize: 9, color: '#444', background: '#1e1e1e', borderRadius: 8, padding: '1px 6px' }}>{badge}</span>}
      <div style={{ flex: 1, height: '0.5px', background: color ? `${color}25` : '#1e1e1e' }} />
      {right && <span style={{ fontSize: 10, color: '#3a3a3a', whiteSpace: 'nowrap' }}>{right}</span>}
    </div>
  )
}

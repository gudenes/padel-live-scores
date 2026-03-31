'use client'
// src/app/v2/matches/page.tsx
// Scores tab — Live / Upcoming / Results toggle with tournament-grouped matches.
// Consistent design with the home page: collapsible TournamentGroups with logos.

import { useEffect, useState, useCallback, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Match, countryFlag, isWarmingUp } from '@/types/match'
import MatchCard from '../../components/MatchCard'
import SearchOverlay from '../SearchOverlay'
import Link from 'next/link'
import Spinner from '../../components/Spinner'

// ── Level helpers ─────────────────────────────────────────────────────────

const LEVEL_PRIORITY: Record<string, number> = {
  finals: 0, major: 1, p1: 2, p2: 3,
  fip_platinum: 4, fip_gold: 5, fip_other: 6,
}

function tournamentSortKey(t: any): number {
  return LEVEL_PRIORITY[t?.level ?? ''] ?? 99
}

function levelLabel(level: string | null): string {
  const map: Record<string, string> = {
    finals: 'Finals', major: 'Major', p1: 'P1', p2: 'P2',
    fip_platinum: 'FIP Platinum', fip_gold: 'FIP Gold', fip_other: 'FIP Tour',
  }
  return level ? (map[level] ?? level) : ''
}

function hasPlayers(m: Match): boolean {
  const a = m as any
  return !!(a.pair1_player1 || a.pair1_player2 || a.pair2_player1 || a.pair2_player2)
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
    // Live tournaments first, then by most recent date
    const aHasLive = a.matches.some(m => m.status === 'live')
    const bHasLive = b.matches.some(m => m.status === 'live')
    if (aHasLive !== bHasLive) return aHasLive ? -1 : 1
    const aDate = a.tournament?.starts_at ?? ''
    const bDate = b.tournament?.starts_at ?? ''
    return bDate.localeCompare(aDate)
  })
  return groups
}

// ── Components ────────────────────────────────────────────────────────────

function tournamentStatus(matches: Match[]): 'live' | 'finished' | 'upcoming' | null {
  if (matches.length === 0) return null
  const hasLive = matches.some(m => m.status === 'live')
  if (hasLive) return 'live'
  const allDone = matches.every(m => ['finished', 'retired', 'walkover'].includes(m.status))
  if (allDone) return 'finished'
  const allScheduled = matches.every(m => m.status === 'scheduled')
  if (allScheduled) return 'upcoming'
  return null // mixed state
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  live: { label: 'LIVE', color: '#fff', bg: 'var(--color-live)' },
  finished: { label: 'FINISHED', color: 'var(--text-dim)', bg: 'rgba(255,255,255,0.06)' },
  upcoming: { label: 'UPCOMING', color: 'var(--color-accent)', bg: 'rgba(56,200,255,0.1)' },
}

function TournamentGroup({ tournament, matches, defaultOpen = true }: { tournament: any; matches: Match[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const badge = tournament?.level ? levelLabel(tournament.level) : null
  const status = tournamentStatus(matches)
  const statusCfg = status ? STATUS_CONFIG[status] : null
  return (
    <div style={{
      borderRadius: 12, overflow: 'hidden',
      border: '1px solid var(--border-card)',
      background: 'var(--bg-card)',
    }}>
      {tournament && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 0, width: '100%',
          borderBottom: open ? '1px solid var(--border-card)' : 'none',
        }}>
          <Link
            href={`/v2/tournaments/${tournament.id}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0,
              padding: '9px 0 9px 12px',
              textDecoration: 'none', color: 'inherit',
            }}
          >
            {tournament.logo_url ? (
              <img src={tournament.logo_url} alt="" style={{ width: 28, height: 28, objectFit: 'contain', borderRadius: 4, flexShrink: 0 }} />
            ) : tournament.country ? (
              <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0 }}>{countryFlag(tournament.country)}</span>
            ) : null}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {tournament.name}
                </span>
                {statusCfg && (
                  <span style={{
                    fontSize: 8, fontWeight: 800, letterSpacing: '0.5px',
                    padding: '2px 5px', borderRadius: 4,
                    color: statusCfg.color, background: statusCfg.bg,
                    flexShrink: 0, lineHeight: '12px',
                    animation: status === 'live' ? 'pulse 2s infinite' : undefined,
                  }}>
                    {statusCfg.label}
                  </span>
                )}
              </div>
              {(badge || tournament.starts_at) && (
                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-dim)', letterSpacing: '0.5px', textTransform: 'uppercase', marginTop: 1 }}>
                  {badge}{badge && tournament.starts_at ? ' · ' : ''}
                  {tournament.starts_at && new Date(tournament.starts_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  {tournament.ends_at && ` – ${new Date(tournament.ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}
                </div>
              )}
            </div>
          </Link>
          <button
            onClick={() => setOpen(o => !o)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '9px 12px 9px 8px',
              background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 600 }}>{matches.length}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
            >
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        </div>
      )}
      {open && (
        <div style={{ padding: '4px 10px 6px' }}>
          {matches.map(m => (
            <MatchCard key={m.id} match={m} embedded />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────

const TAB_STYLES = `
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
`

export default function ScoresPageWrapper() {
  return (
    <Suspense fallback={<Spinner fullHeight />}>
      <ScoresPage />
    </Suspense>
  )
}

function ScoresPage() {
  const searchParams = useSearchParams()
  const router = useRouter()

  // Legacy redirect: ?tournament=X → /v2/tournaments/X
  useEffect(() => {
    const tid = searchParams.get('tournament')
    if (tid) {
      const round = searchParams.get('round')
      router.replace(`/v2/tournaments/${tid}${round ? `?round=${round}` : ''}`)
    }
  }, [searchParams, router])

  const [liveMatches, setLiveMatches] = useState<Match[]>([])
  const [scheduledMatches, setScheduledMatches] = useState<Match[]>([])
  const [recentMatches, setRecentMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [searchOpen, setSearchOpen] = useState(false)
  const [tab, setTab] = useState<'live' | 'all' | 'results' | 'next'>('all')
  const [genderFilter, setGenderFilter] = useState<'men' | 'women'>('men')
  const pageRef = useRef(0)

  const matchSelect = `
    *,
    tournament:tournaments(id, name, starts_at, ends_at, country, timezone, level, logo_url),
    pair1_player1:players!matches_pair1_player1_id_fkey(id, name, country, external_id, ranking, avatar_url, side),
    pair1_player2:players!matches_pair1_player2_id_fkey(id, name, country, external_id, ranking, avatar_url, side),
    pair2_player1:players!matches_pair2_player1_id_fkey(id, name, country, external_id, ranking, avatar_url, side),
    pair2_player2:players!matches_pair2_player2_id_fkey(id, name, country, external_id, ranking, avatar_url, side),
    sets(*, games(*))
  `

  const sortSets = (data: any[]) =>
    data.map(m => ({ ...m, sets: (m.sets ?? []).sort((a: any, b: any) => a.set_number - b.set_number) }))

  const fetchData = useCallback(async () => {
    setLoading(true)

    const [liveRes, scheduledRes, recentRes] = await Promise.all([
      supabase.from('matches').select(matchSelect)
        .eq('status', 'live')
        .order('court_order', { ascending: true }),

      supabase.from('matches').select(matchSelect)
        .eq('status', 'scheduled')
        .order('scheduled_at', { ascending: true })
        .limit(50),

      supabase.from('matches').select(matchSelect)
        .in('status', ['finished', 'retired', 'walkover'])
        .not('finished_at', 'is', null)
        .order('finished_at', { ascending: false })
        .limit(30),
    ])

    setLiveMatches(sortSets((liveRes.data as any) ?? []))
    setScheduledMatches(sortSets((scheduledRes.data as any) ?? []))
    setRecentMatches(sortSets((recentRes.data as any) ?? []))
    setHasMore((recentRes.data?.length ?? 0) >= 30)
    pageRef.current = 0
    setLoading(false)

    // Auto-select tab: live if matches are happening, otherwise all
    if ((liveRes.data?.length ?? 0) > 0) setTab('live')
    else setTab('all')
  }, [])

  const fetchMoreResults = useCallback(async () => {
    setLoadingMore(true)
    const nextPage = pageRef.current + 1
    const from = nextPage * 30
    const to = from + 29

    const { data } = await supabase.from('matches').select(matchSelect)
      .in('status', ['finished', 'retired', 'walkover'])
      .not('finished_at', 'is', null)
      .order('finished_at', { ascending: false })
      .range(from, to)

    const sorted = sortSets((data as any) ?? [])
    setRecentMatches(prev => [...prev, ...sorted])
    setHasMore(sorted.length >= 30)
    pageRef.current = nextPage
    setLoadingMore(false)
  }, [])

  useEffect(() => {
    if (searchParams.get('tournament')) return
    fetchData()
  }, [fetchData, searchParams])

  // Realtime updates
  const realtimeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const handleChange = () => {
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current)
      realtimeDebounceRef.current = setTimeout(() => fetchData(), 500)
    }
    const ch = supabase
      .channel('scores-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, handleChange)
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current)
    }
  }, [fetchData])

  // Auto-switch gender if no matches for current filter
  const allLoaded = [...liveMatches, ...scheduledMatches, ...recentMatches]
  const hasMen = allLoaded.some(m => (m as any).category === 'men')
  const hasWomen = allLoaded.some(m => (m as any).category === 'women')
  useEffect(() => {
    if (loading || allLoaded.length === 0) return
    if (genderFilter === 'men' && !hasMen && hasWomen) setGenderFilter('women')
    else if (genderFilter === 'women' && !hasWomen && hasMen) setGenderFilter('men')
  }, [loading, hasMen, hasWomen, genderFilter]) // eslint-disable-line

  // Filter by gender
  const gf = (matches: Match[]) => matches.filter(m => (m as any).category === genderFilter)

  // Current tab data
  const currentMatches = tab === 'live' ? gf(liveMatches)
    : tab === 'all' ? gf([...liveMatches, ...scheduledMatches.filter(hasPlayers), ...recentMatches])
    : tab === 'next' ? gf(scheduledMatches.filter(hasPlayers))
    : gf(recentMatches)
  const grouped = groupByTournament(currentMatches)

  const liveCount = gf(liveMatches).filter(m => !isWarmingUp(m)).length
  const nextCount = gf(scheduledMatches).filter(hasPlayers).length

  return (
    <main style={{
      background: 'var(--bg-base)', minHeight: '100vh',
      maxWidth: 500, margin: '0 auto',
      fontFamily: 'var(--font-sans)',
      borderLeft: '0.5px solid var(--border-base)',
      borderRight: '0.5px solid var(--border-base)',
    }}>
      <style dangerouslySetInnerHTML={{ __html: TAB_STYLES }} />
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px',
        borderBottom: '0.5px solid rgba(255,255,255,0.06)',
        position: 'sticky', top: 0, zIndex: 10,
        background: 'rgba(17, 17, 17, 0.85)',
        backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
      }}>
        <button
          onClick={() => setSearchOpen(true)}
          style={{
            width: 36, height: 36, borderRadius: '50%', border: 'none', cursor: 'pointer',
            background: 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)',
          }}
          aria-label="Search"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
        </button>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <img src="/padel-nacho-logo.png" alt="Padel Nachos" style={{ height: 28, width: 'auto', objectFit: 'contain' }} />
        </div>
        <button style={{
          width: 34, height: 34, borderRadius: '50%', border: '1.5px solid var(--border-strong)',
          cursor: 'pointer', background: 'var(--bg-card-alt)', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-muted)',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
        </button>
      </div>

      {loading ? (
        <Spinner fullHeight />
      ) : (
        <>
          {/* Toggle tabs + gender selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
            {([
              { key: 'live' as const, label: 'Live', isLive: true },
              { key: 'all' as const, label: 'All', isLive: false },
              { key: 'results' as const, label: 'Results', isLive: false },
              { key: 'next' as const, label: 'Upcoming', isLive: false },
            ]).map(t => {
              const active = tab === t.key
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 14px', borderRadius: 20,
                    border: active ? 'none' : '1px solid var(--border-strong)',
                    background: active
                      ? (t.isLive ? 'var(--color-live)' : 'var(--color-accent)')
                      : 'transparent',
                    color: active ? '#000' : 'var(--text-muted)',
                    fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                >
                  {t.isLive && (
                    <span style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: active ? '#000' : 'var(--color-live)',
                      flexShrink: 0,
                      animation: liveCount > 0 ? 'pulse 2s infinite' : undefined,
                    }} />
                  )}
                  {t.label}
                </button>
              )
            })}
            </div>
            {/* Gender toggle */}
            <div
              onClick={() => setGenderFilter(g => g === 'men' ? 'women' : 'men')}
              style={{
                display: 'inline-flex', alignItems: 'center', cursor: 'pointer',
                background: 'var(--bg-card-alt)', borderRadius: 14,
                padding: 2, position: 'relative', width: 52, height: 26, flexShrink: 0,
                border: `1px solid ${genderFilter === 'women' ? 'rgba(244,114,182,0.3)' : 'rgba(255,255,255,0.08)'}`,
                transition: 'border-color 0.2s',
              }}
            >
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
          </div>

          {/* Grouped matches */}
          <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {grouped.length > 0 ? grouped.map((group, idx) => (
              <TournamentGroup
                key={group.tournament?.id ?? idx}
                tournament={group.tournament}
                matches={group.matches}
                defaultOpen={tab === 'live'}
              />
            )) : (
              <div style={{
                borderRadius: 14, background: 'var(--bg-card)',
                border: '1px solid var(--border-card)', padding: '20px 18px', textAlign: 'center',
              }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>&#127934;</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                  {tab === 'live' ? 'No live matches right now' : tab === 'next' ? 'No upcoming matches' : 'No recent results'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {tab === 'live' ? 'Check back during tournament days' : tab === 'all' ? 'No matches available' : tab === 'next' ? 'Scheduled matches will appear here' : 'Results will appear after matches finish'}
                </div>
              </div>
            )}
          </div>

          {/* Load more — only for results tab */}
          {(tab === 'results' || tab === 'all') && hasMore && (
            <div style={{ padding: '16px 16px 24px', textAlign: 'center' }}>
              <button
                onClick={fetchMoreResults}
                disabled={loadingMore}
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-card)',
                  borderRadius: 10,
                  padding: '10px 24px',
                  fontSize: 12, fontWeight: 700,
                  color: loadingMore ? 'var(--text-dim)' : 'var(--color-accent)',
                  cursor: loadingMore ? 'default' : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {loadingMore ? <Spinner size={16} /> : 'Load more results'}
              </button>
            </div>
          )}
        </>
      )}
    </main>
  )
}

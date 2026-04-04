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
import ProfileButton from '@/components/ProfileButton'

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

function tournamentStatus(matches: Match[], tournament?: any): 'live' | 'finished' | 'upcoming' | 'qualifying' | null {
  if (matches.length === 0) return null
  const hasLive = matches.some(m => m.status === 'live')
  if (hasLive) return 'live'
  const allDone = matches.every(m => ['finished', 'retired', 'walkover'].includes(m.status))
  if (allDone) return 'finished'
  const hasScheduled = matches.some(m => m.status === 'scheduled')
  // Tournament has started but all matches still scheduled
  if (hasScheduled && tournament?.starts_at) {
    const now = new Date()
    const start = new Date(tournament.starts_at)
    if (start <= now) {
      // FIP tournaments: qualifying runs before main draw
      if (tournament.source === 'fip' && matches.every((m: any) => m.status === 'scheduled')) {
        return 'qualifying'
      }
      return 'live'
    }
  }
  if (hasScheduled && matches.every(m => m.status === 'scheduled')) return 'upcoming'
  return null // mixed state
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  live: { label: 'LIVE', color: '#fff', bg: 'var(--color-live)' },
  finished: { label: 'FINISHED', color: 'var(--text-dim)', bg: 'rgba(255,255,255,0.06)' },
  upcoming: { label: 'UPCOMING', color: 'var(--color-accent)', bg: 'rgba(56,200,255,0.1)' },
  qualifying: { label: 'QUALIFYING', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
}

function getChampions(matches: Match[], category: string): { player1: string | null; player2: string | null; avatar1: string | null; avatar2: string | null } | null {
  const finals = matches.filter(m => {
    const a = m as any
    const r = (a.round ?? '').toLowerCase()
    const isFinal = r === 'f' || r === 'final' || r === 'finals'
    return a.category === category && isFinal && a.winner_pair
  })
  if (finals.length === 0) return null
  const f = finals[0] as any
  const isP1 = f.winner_pair === 1
  return {
    player1: isP1 ? f.pair1_player1?.name : f.pair2_player1?.name,
    player2: isP1 ? f.pair1_player2?.name : f.pair2_player2?.name,
    avatar1: isP1 ? f.pair1_player1?.avatar_url : f.pair2_player1?.avatar_url,
    avatar2: isP1 ? f.pair1_player2?.avatar_url : f.pair2_player2?.avatar_url,
  }
}

function shortName(fullName: string | null): string {
  if (!fullName) return '—'
  const parts = fullName.trim().split(' ')
  return parts[parts.length - 1]
}

function ChampionRow({ champions, color }: { champions: { player1: string | null; player2: string | null; avatar1: string | null; avatar2: string | null }; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 3, height: 22, borderRadius: 2, background: color, flexShrink: 0 }} />
      <div style={{ display: 'flex', flexShrink: 0 }}>
        {champions.avatar1 && (
          <img src={champions.avatar1} alt="" style={{
            width: 22, height: 22, borderRadius: '50%', objectFit: 'cover',
            border: '1.5px solid var(--bg-base)', background: 'var(--bg-card-alt)',
          }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
        )}
        {champions.avatar2 && (
          <img src={champions.avatar2} alt="" style={{
            width: 22, height: 22, borderRadius: '50%', objectFit: 'cover',
            border: '1.5px solid var(--bg-base)', background: 'var(--bg-card-alt)',
            marginLeft: -6,
          }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
        )}
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-primary)', fontWeight: 600 }}>
        {shortName(champions.player1)} / {shortName(champions.player2)}
      </span>
    </div>
  )
}

function TournamentGroup({ tournament, matches, defaultOpen = true, genderFilter }: { tournament: any; matches: Match[]; defaultOpen?: boolean; genderFilter: string }) {
  const [open, setOpen] = useState(defaultOpen)
  const badge = tournament?.level ? levelLabel(tournament.level) : null
  const status = tournamentStatus(matches, tournament)
  const statusCfg = status ? STATUS_CONFIG[status] : null
  const isFinished = status === 'finished'

  // For finished tournaments, extract champions from finals matches
  const menChampions = isFinished ? getChampions(matches, 'men') : null
  const womenChampions = isFinished ? getChampions(matches, 'women') : null
  const showMen = genderFilter === 'all' || genderFilter === 'men'
  const showWomen = genderFilter === 'all' || genderFilter === 'women'
  const hasChampions = (showMen && menChampions) || (showWomen && womenChampions)
  const totalMatches = matches.length

  if (isFinished) {
    return (
      <Link href={`/v2/tournaments/${tournament?.id}?tab=recap`} style={{ textDecoration: 'none', color: 'inherit' }}>
        <div style={{
          borderRadius: 12, overflow: 'hidden',
          border: '1px solid var(--border-card)',
          background: 'var(--bg-card)',
        }}>
          <div style={{ padding: '12px 14px' }}>
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: hasChampions ? 10 : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                {tournament?.logo_url ? (
                  <img src={tournament.logo_url} alt="" style={{ width: 28, height: 28, objectFit: 'contain', borderRadius: 4, flexShrink: 0 }} />
                ) : tournament?.country ? (
                  <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0 }}>{countryFlag(tournament.country)}</span>
                ) : null}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {tournament?.name}
                    </span>
                    {statusCfg && (
                      <span style={{
                        fontSize: 8, fontWeight: 800, letterSpacing: '0.5px',
                        padding: '2px 5px', borderRadius: 4,
                        color: statusCfg.color, background: statusCfg.bg,
                        flexShrink: 0, lineHeight: '12px',
                      }}>
                        {statusCfg.label}
                      </span>
                    )}
                  </div>
                  {(badge || tournament?.starts_at) && (
                    <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-dim)', letterSpacing: '0.5px', textTransform: 'uppercase', marginTop: 1 }}>
                      {badge}{badge && tournament?.starts_at ? ' · ' : ''}
                      {tournament?.starts_at && new Date(tournament.starts_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      {tournament?.ends_at && ` – ${new Date(tournament.ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}
                    </div>
                  )}
                </div>
              </div>
              <span style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 600, flexShrink: 0 }}>{totalMatches}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                style={{ flexShrink: 0, marginLeft: 8 }}
              >
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </div>

            {/* Champions section */}
            {hasChampions && (
              <div style={{
                borderTop: '1px solid rgba(255,255,255,0.06)',
                paddingTop: 10,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{
                    fontSize: 8, fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.08em', color: '#F59E0B',
                  }}>
                    Champions
                  </div>
                  {showMen && menChampions && <ChampionRow champions={menChampions} color="#5BA8FF" />}
                  {showWomen && womenChampions && <ChampionRow champions={womenChampions} color="#F472B6" />}
                </div>
                <div style={{
                  fontSize: 10, fontWeight: 700, color: 'var(--color-accent)',
                  display: 'flex', alignItems: 'center', gap: 4,
                  flexShrink: 0,
                }}>
                  View
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </div>
              </div>
            )}
          </div>
        </div>
      </Link>
    )
  }

  // Live / upcoming / mixed — show full match cards
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
            <span style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 600 }}>{matches.length}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
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
  const [tab, setTab] = useState<'live' | 'all' | 'results'>('all')
  const [genderFilter, setGenderFilter] = useState<'all' | 'men' | 'women'>('all')
  const pageRef = useRef(0)

  const matchSelect = `
    *,
    tournament:tournaments(id, name, starts_at, ends_at, country, timezone, level, logo_url, source),
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
    try {
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
        .gte('finished_at', `${new Date().getFullYear()}-01-01`)
        .order('finished_at', { ascending: false }),
    ])

    setLiveMatches(sortSets((liveRes.data as any) ?? []))
    setScheduledMatches(sortSets((scheduledRes.data as any) ?? []))
    setRecentMatches(sortSets((recentRes.data as any) ?? []))
    setHasMore(true) // Can still load previous seasons
    pageRef.current = 0

    // Auto-select tab: live if matches are happening (including started tournaments with scheduled matches)
    const hasLive = (liveRes.data?.length ?? 0) > 0
    const hasLiveScheduled = (scheduledRes.data ?? []).some((m: any) =>
      m.tournament?.starts_at && new Date(m.tournament.starts_at) <= new Date()
    )
    if (hasLive || hasLiveScheduled) setTab('live')
    else setTab('all')
    } catch (e) {
      console.error('[Matches] fetchData error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchMoreResults = useCallback(async () => {
    setLoadingMore(true)
    const nextPage = pageRef.current + 1
    const from = nextPage * 50
    const to = from + 49

    const { data } = await supabase.from('matches').select(matchSelect)
      .in('status', ['finished', 'retired', 'walkover'])
      .not('finished_at', 'is', null)
      .lt('finished_at', `${new Date().getFullYear()}-01-01`)
      .order('finished_at', { ascending: false })
      .range(from, to)

    const sorted = sortSets((data as any) ?? [])
    setRecentMatches(prev => [...prev, ...sorted])
    setHasMore(sorted.length >= 50)
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

  // Filter by gender
  const gf = (matches: Match[]) =>
    genderFilter === 'all' ? matches : matches.filter(m => (m as any).category === genderFilter)

  // Scheduled matches from tournaments that have already started → treat as live
  const now = new Date()
  const liveScheduled = scheduledMatches.filter(m => {
    const t = (m as any).tournament
    return t?.starts_at && new Date(t.starts_at) <= now
  })

  // Current tab data
  const currentMatches = tab === 'live' ? gf([...liveMatches, ...liveScheduled.filter(hasPlayers)])
    : tab === 'all' ? gf([...liveMatches, ...scheduledMatches.filter(hasPlayers), ...recentMatches])
    : gf(recentMatches)
  const grouped = groupByTournament(currentMatches)

  const liveCount = gf([...liveMatches, ...liveScheduled]).filter(m => !isWarmingUp(m)).length


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
          <img src="/padelnachos-logo-v2.png" alt="Padel Nachos" style={{ height: 28, width: 'auto', objectFit: 'contain' }} />
        </div>
        <ProfileButton />
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
            {/* Gender toggle — cycles: M → All → F → M */}
            <div
              onClick={() => setGenderFilter(g => g === 'men' ? 'all' : g === 'all' ? 'women' : 'men')}
              style={{
                display: 'inline-flex', alignItems: 'center', cursor: 'pointer',
                background: 'var(--bg-card-alt)', borderRadius: 14,
                padding: 2, position: 'relative', flexShrink: 0,
                border: `1px solid ${genderFilter === 'women' ? 'rgba(244,114,182,0.3)' : 'rgba(255,255,255,0.08)'}`,
                transition: 'border-color 0.2s',
              }}
            >
              <div style={{
                position: 'absolute', top: 2,
                left: genderFilter === 'men' ? 2 : genderFilter === 'all' ? 26 : 50,
                width: 22, height: 22, borderRadius: 11,
                background: genderFilter === 'women' ? 'var(--color-women)' : 'var(--color-accent)',
                transition: 'left 0.2s ease, background 0.2s ease',
              }} />
              {(['men', 'all', 'women'] as const).map(g => (
                <span
                  key={g}
                  style={{
                    width: 24, textAlign: 'center', fontSize: 10, fontWeight: 700,
                    position: 'relative', zIndex: 1,
                    color: genderFilter === g ? '#000' : 'var(--text-faint)',
                    transition: 'color 0.2s',
                    lineHeight: '22px',
                  }}
                >{g === 'all' ? 'All' : g === 'men' ? 'M' : 'F'}</span>
              ))}
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
                genderFilter={genderFilter}
              />
            )) : (
              <div style={{
                borderRadius: 14, background: 'var(--bg-card)',
                border: '1px solid var(--border-card)', padding: '20px 18px', textAlign: 'center',
              }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>&#127934;</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                  {tab === 'live' ? 'No live matches right now' : 'No recent results'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {tab === 'live' ? 'Check back during tournament days' : tab === 'all' ? 'No matches available' : 'Results will appear after matches finish'}
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
                {loadingMore ? <Spinner size={16} /> : 'Load previous seasons'}
              </button>
            </div>
          )}
        </>
      )}
    </main>
  )
}

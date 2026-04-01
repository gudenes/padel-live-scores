'use client'
// src/app/v2/tournaments/page.tsx
// Tournament browser — Premier Padel (default) & FIP Tour tabs
// Sections: Live hero → Upcoming (2-col grid) → Completed (cards with winners)

import { useEffect, useState, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { countryFlag } from '@/types/match'
import SearchOverlay from '../SearchOverlay'
import Spinner from '../../components/Spinner'

// ── Helpers ───────────────────────────────────────────────────────────────

const COUNTRY_NAMES: Record<string, string> = {
  ES: 'Spain', AR: 'Argentina', BR: 'Brazil', PT: 'Portugal',
  FR: 'France', IT: 'Italy', BE: 'Belgium', NL: 'Netherlands',
  DE: 'Germany', GB: 'Great Britain', DK: 'Denmark', SE: 'Sweden',
  UY: 'Uruguay', PY: 'Paraguay', CL: 'Chile', MX: 'Mexico',
  US: 'United States', AU: 'Australia', QA: 'Qatar', AE: 'UAE',
  KW: 'Kuwait', BH: 'Bahrain', SA: 'Saudi Arabia', JP: 'Japan',
}

function countryName(code: string | null): string {
  if (!code) return ''
  return COUNTRY_NAMES[code.toUpperCase()] ?? code
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(start)
  const e = new Date(end)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  return `${s.toLocaleDateString('en-US', opts)} - ${e.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`
}

function formatDateShort(start: string, end: string): string {
  const s = new Date(start)
  const e = new Date(end)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  return `${s.toLocaleDateString('en-US', opts)} - ${e.toLocaleDateString('en-US', opts)}`
}

function levelLabel(level: string | null): string {
  const map: Record<string, string> = {
    finals: 'Finals', major: 'Major', p1: 'P1', p2: 'P2',
    fip_platinum: 'FIP Platinum', fip_gold: 'FIP Gold',
    fip_silver: 'FIP Silver', fip_bronze: 'FIP Bronze', fip_other: 'FIP Tour',
  }
  return level ? (map[level] ?? level) : ''
}

// Coverage levels per padelapi.org documentation
const FULL_COVERAGE_LEVELS = new Set(['major', 'p1', 'p2', 'finals', 'fip_platinum'])
function hasLiveCoverage(level: string | null): boolean {
  return FULL_COVERAGE_LEVELS.has(level ?? '')
}

function daysUntil(dateStr: string): number {
  const now = new Date()
  const target = new Date(dateStr)
  return Math.max(0, Math.ceil((target.getTime() - now.getTime()) / 86400000))
}

function isLiveTournament(startsAt: string | null, endsAt: string | null): boolean {
  if (!startsAt || !endsAt) return false
  const now = new Date()
  const end = new Date(endsAt); end.setHours(23, 59, 59)
  return now >= new Date(startsAt) && now <= end
}

function getCurrentRound(matches: any[]): string | null {
  const liveMatch = matches.find((m: any) => m.status === 'live')
  if (liveMatch) return liveMatch.round ?? null
  const latest = matches
    .filter((m: any) => m.status === 'finished')
    .sort((a: any, b: any) => new Date(b.scheduled_at ?? 0).getTime() - new Date(a.scheduled_at ?? 0).getTime())
  return latest[0]?.round ?? null
}

// ── Types ─────────────────────────────────────────────────────────────────

interface Tournament {
  id: string
  name: string
  starts_at: string
  ends_at: string
  country: string | null
  level: string | null
  location: string | null
  prize_money: string | null
}

interface Winner {
  category: string
  player1_name: string | null
  player1_avatar: string | null
  player2_name: string | null
  player2_avatar: string | null
}

interface TournamentWithWinners extends Tournament {
  winners: Winner[]
}

type Tab = 'premier' | 'fip'
type FipFilter = 'all' | 'fip_platinum' | 'fip_gold' | 'fip_other'

const PREMIER_LEVELS = ['finals', 'major', 'p1', 'p2']
const FIP_LEVELS = ['fip_platinum', 'fip_gold', 'fip_silver', 'fip_bronze', 'fip_other']

// ── Main Page ─────────────────────────────────────────────────────────────

export default function TournamentsPageWrapper() {
  return (
    <Suspense fallback={<Spinner fullHeight />}>
      <TournamentsPage />
    </Suspense>
  )
}

function TournamentsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const scrollToId = searchParams.get('scrollTo')
  const scrollDoneRef = useRef(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('premier')
  const [switching, setSwitching] = useState(false)
  const [fipFilter, setFipFilter] = useState<FipFilter>('all')
  const [tournaments, setTournaments] = useState<TournamentWithWinners[]>([])
  const [loading, setLoading] = useState(true)
  const [liveMatches, setLiveMatches] = useState<Record<string, any[]>>({})
  const [liveTournamentIds, setLiveTournamentIds] = useState<Set<string>>(new Set())

  // ── Scroll to tournament when returning from detail page ─────────────
  useEffect(() => {
    if (!scrollToId || loading || scrollDoneRef.current) return
    scrollDoneRef.current = true
    setTimeout(() => {
      const el = document.querySelector(`[data-tournament-id="${scrollToId}"]`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 100)
  }, [scrollToId, loading])

  // ── Fetch tournaments + winners ──────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true)

    // Get all tournaments for current season
    const { data: tournamentsData } = await supabase
      .from('tournaments')
      .select('id, name, starts_at, ends_at, country, level, location, prize_money')
      .not('level', 'is', null)
      .order('starts_at', { ascending: false })
      .limit(500)

    if (!tournamentsData) { setLoading(false); return }

    const now = new Date()

    // Step 1: Determine which tournaments are truly "live"
    // A tournament is live if it has started and still has unfinished matches
    // (stays live even past end_date until all matches finish)
    const candidateLive = tournamentsData.filter(t => {
      const start = new Date(t.starts_at)
      const end = new Date(t.ends_at); end.setDate(end.getDate() + 3) // grace period
      return start <= now && now <= end
    })

    let liveMatchesMap: Record<string, any[]> = {}
    const confirmedLiveIds = new Set<string>()

    if (candidateLive.length > 0) {
      const { data: matchData } = await supabase
        .from('matches')
        .select('id, round, status, tournament:tournaments!inner(id)')
        .in('tournament.id', candidateLive.map(t => t.id))

      for (const m of (matchData ?? []) as any[]) {
        const tid = m.tournament?.id
        if (!tid) continue
        if (!liveMatchesMap[tid]) liveMatchesMap[tid] = []
        liveMatchesMap[tid].push(m)
      }

      const doneStatuses = new Set(['finished', 'bye', 'retired', 'walkover', 'cancelled'])
      for (const t of candidateLive) {
        const matches = liveMatchesMap[t.id] ?? []
        const hasLiveMatch = matches.some((m: any) => m.status === 'live')
        const hasScheduled = matches.some((m: any) => m.status === 'scheduled')
        const hasFinished = matches.some((m: any) => m.status === 'finished')
        // Tournament is live if it has an active match, has started and still has scheduled matches,
        // or is within its date range and has only scheduled matches (not yet kicked off today)
        if (hasLiveMatch || hasScheduled) confirmedLiveIds.add(t.id)
      }
    }

    // Step 2: Fetch winners for completed tournaments (not live)
    const completedTournaments = tournamentsData.filter(t => {
      if (confirmedLiveIds.has(t.id)) return false
      if (new Date(t.starts_at) > now) return false
      return true
    })
    const completedIds = completedTournaments.map(t => t.id)
    let winnersMap: Record<string, Winner[]> = {}

    if (completedIds.length > 0) {
      const { data: finals } = await supabase
        .from('matches')
        .select(`
          id, round, category, winner_pair, status,
          tournament:tournaments!inner(id),
          pair1_player1:players!matches_pair1_player1_id_fkey(name, avatar_url),
          pair1_player2:players!matches_pair1_player2_id_fkey(name, avatar_url),
          pair2_player1:players!matches_pair2_player1_id_fkey(name, avatar_url),
          pair2_player2:players!matches_pair2_player2_id_fkey(name, avatar_url)
        `)
        .in('tournament.id', completedIds)
        .in('round', ['Finals', 'Final', 'FINAL', 'finals', 'final', 'F'])
        .eq('status', 'finished')
        .not('winner_pair', 'is', null)

      for (const m of (finals ?? []) as any[]) {
        const tid = m.tournament?.id
        if (!tid) continue
        const isP1 = m.winner_pair === 1
        const w: Winner = {
          category: m.category ?? 'men',
          player1_name: isP1 ? m.pair1_player1?.name : m.pair2_player1?.name,
          player1_avatar: isP1 ? m.pair1_player1?.avatar_url : m.pair2_player1?.avatar_url,
          player2_name: isP1 ? m.pair1_player2?.name : m.pair2_player2?.name,
          player2_avatar: isP1 ? m.pair1_player2?.avatar_url : m.pair2_player2?.avatar_url,
        }
        if (!winnersMap[tid]) winnersMap[tid] = []
        winnersMap[tid].push(w)
      }
    }

    setLiveTournamentIds(confirmedLiveIds)
    setLiveMatches(liveMatchesMap)
    setTournaments(tournamentsData.map(t => ({
      ...t,
      winners: winnersMap[t.id] ?? [],
    })))
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // ── Categorize tournaments ───────────────────────────────────────────
  const now = new Date()
  const levels = tab === 'premier' ? PREMIER_LEVELS : FIP_LEVELS
  const filtered = tournaments.filter(t => {
    if (!levels.includes(t.level ?? '')) return false
    if (tab === 'fip' && fipFilter !== 'all' && t.level !== fipFilter) return false
    return true
  })

  const live = filtered.filter(t => liveTournamentIds.has(t.id))
  const upcoming = filtered
    .filter(t => !liveTournamentIds.has(t.id) && new Date(t.starts_at) > now)
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
  const completed = filtered
    .filter(t => !liveTournamentIds.has(t.id) && new Date(t.starts_at) <= now)
    .sort((a, b) => new Date(b.ends_at).getTime() - new Date(a.ends_at).getTime())

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 500, margin: '0 auto', paddingBottom: 20 }}>

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px',
        borderBottom: '0.5px solid rgba(255,255,255,0.06)',
        position: 'sticky', top: 0, zIndex: 10,
        background: 'var(--bg-base)',
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

      {/* Hero label + circuit chip — logo morph animation on switch */}
      <div style={{ padding: '16px 16px 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img
            src={tab === 'premier' ? '/premier-padel-logo.svg' : '/fip-tour-logo.svg'}
            alt={tab === 'premier' ? 'Premier Padel' : 'FIP Tour'}
            style={{
              height: 32, width: 'auto', objectFit: 'contain',
              transition: 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease',
              transform: switching ? 'translateX(40px) scale(0.6)' : 'translateX(0) scale(1)',
              opacity: switching ? 0 : 1,
            }}
          />
        </div>
        <button
          onClick={() => {
            if (switching) return
            setSwitching(true)
            setTimeout(() => {
              setTab(t => t === 'premier' ? 'fip' : 'premier')
              setFipFilter('all')
              setTimeout(() => setSwitching(false), 50)
            }, 350)
          }}
          style={{
            padding: '6px 14px', borderRadius: 20, fontSize: 11, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
            background: 'var(--bg-card-alt)', color: 'var(--text-muted)',
            border: '1px solid var(--border-card)',
            transition: 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease',
            transform: switching ? 'translateX(-40px) scale(1.4)' : 'translateX(0) scale(1)',
            opacity: switching ? 0 : 1,
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <img
            src={tab === 'premier' ? '/fip-tour-logo.svg' : '/premier-padel-logo.svg'}
            alt=""
            style={{ height: 14, width: 'auto', objectFit: 'contain', opacity: 0.7 }}
          />
        </button>
      </div>

      {/* FIP filter chips — only when FIP Tour is active */}
      {tab === 'fip' && (
        <div style={{ display: 'flex', gap: 6, padding: '10px 16px 4px', overflowX: 'auto' }}>
          {([
            ['all', 'All'],
            ['fip_platinum', 'Platinum'],
            ['fip_gold', 'Gold'],
            ['fip_other', 'Other'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setFipFilter(value as FipFilter)}
              style={{
                padding: '5px 12px', borderRadius: 20, whiteSpace: 'nowrap',
                fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                background: fipFilter === value ? 'var(--color-accent)' : 'var(--bg-card-alt)',
                color: fipFilter === value ? '#000' : 'var(--text-muted)',
                border: `1px solid ${fipFilter === value ? 'var(--color-accent)' : 'var(--border-card)'}`,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <Spinner fullHeight />
      ) : (
        <div style={{
          transition: 'opacity 0.3s ease, transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
          opacity: switching ? 0 : 1,
          transform: switching ? 'scale(0.97)' : 'scale(1)',
          transformOrigin: 'center top',
        }}>
          {/* Upcoming — live tournament as hero, or next upcoming */}
          {(live.length > 0 || upcoming.length > 0) && (
            <>
              <SectionHeader
                icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>}
                title={live.length > 0 ? 'Live' : 'Upcoming'}
                count={`${live.length + upcoming.length} events`}
              />
              <UpcomingStack
                tournaments={upcoming}
                liveTournament={live[0] ?? null}
                liveRound={live[0] ? getCurrentRound(liveMatches[live[0].id] ?? []) : null}
              />
            </>
          )}

          {/* Completed — carousel + collapsible previous seasons */}
          {completed.length > 0 && (
            <>
              {(() => {
                const currentYear = new Date().getFullYear()
                const currentSeason = completed.filter(t => new Date(t.starts_at).getFullYear() === currentYear)
                const previousSeasons = completed.filter(t => new Date(t.starts_at).getFullYear() < currentYear)

                const prevByYear: Record<number, TournamentWithWinners[]> = {}
                for (const t of previousSeasons) {
                  const yr = new Date(t.starts_at).getFullYear()
                  if (!prevByYear[yr]) prevByYear[yr] = []
                  prevByYear[yr].push(t)
                }

                return (
                  <>
                    {currentSeason.length > 0 && (
                      <>
                        <SectionHeader
                          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>}
                          title="Completed"
                          count={`${currentYear} Season`}
                        />
                        <CompletedCarousel tournaments={currentSeason} />
                      </>
                    )}

                    {Object.entries(prevByYear)
                      .sort(([a], [b]) => Number(b) - Number(a))
                      .map(([year, items]) => (
                        <CollapsibleSeason key={year} year={Number(year)} tournaments={items} />
                      ))
                    }
                  </>
                )
              })()}
            </>
          )}

          {filtered.length === 0 && (
            <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              No tournaments found
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
      `}</style>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────

function SectionHeader({ icon, title, count }: { icon: React.ReactNode; title: string; count?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 16px 10px' }}>
      {icon}
      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
        {title}
      </span>
      {count && (
        <span style={{
          fontSize: 10, fontWeight: 600, color: 'var(--text-dim)',
          background: 'var(--bg-card-alt)', borderRadius: 10, padding: '2px 8px',
        }}>
          {count}
        </span>
      )}
    </div>
  )
}

function UpcomingStack({ tournaments, liveTournament, liveRound }: {
  tournaments: Tournament[]
  liveTournament: Tournament | null
  liveRound: string | null
}) {
  // Hero is the live tournament if available, otherwise the first upcoming
  const hero = liveTournament ?? tournaments[0] ?? null
  const isLive = !!liveTournament
  const rest = liveTournament ? tournaments : tournaments.slice(1)

  if (!hero) return null

  const days = isLive ? null : daysUntil(hero.starts_at)

  // Color scheme: red for live, cyan for upcoming
  const accent = isLive ? '255,70,85' : '56,200,255'
  const accentVar = isLive ? 'var(--color-live)' : 'var(--color-accent)'

  return (
    <div style={{ paddingBottom: 8 }}>
      {/* Stacked hero card */}
      <div style={{ position: 'relative', padding: '0 16px', marginBottom: rest.length > 0 ? 16 : 8 }}>
        {/* Peek cards behind */}
        {rest.length >= 2 && (
          <div style={{
            position: 'absolute', top: 8, left: 28, right: 28, height: 160,
            borderRadius: 14, background: 'var(--bg-card-alt)',
            border: '1px solid rgba(255,255,255,0.04)', opacity: 0.4,
          }} />
        )}
        {rest.length >= 1 && (
          <div style={{
            position: 'absolute', top: 4, left: 22, right: 22, height: 160,
            borderRadius: 14, background: 'var(--bg-card)',
            border: '1px solid rgba(255,255,255,0.06)', opacity: 0.6,
          }} />
        )}

        {/* Front card — live or next event */}
        <Link href={`/v2/tournaments/${hero.id}`} data-tournament-id={hero.id} style={{ textDecoration: 'none', color: 'inherit' }}>
          <div style={{
            position: 'relative', borderRadius: 16, padding: 20, cursor: 'pointer',
            background: `linear-gradient(135deg, rgba(${accent},0.10) 0%, var(--bg-card) 60%, rgba(245,158,11,0.06) 100%)`,
            border: `1.5px solid rgba(${accent},0.25)`, overflow: 'hidden', zIndex: 2,
          }}>
            <div style={{
              position: 'absolute', top: -30, right: -30, width: 100, height: 100,
              borderRadius: '50%', background: `rgba(${accent},0.06)`, filter: 'blur(30px)',
            }} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative' }}>
              <div>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  background: `rgba(${accent},0.15)`, border: `1px solid rgba(${accent},0.3)`,
                  borderRadius: 6, padding: '3px 10px', fontSize: 9, fontWeight: 800,
                  color: accentVar, letterSpacing: '0.08em', marginBottom: 10,
                }}>
                  {isLive && (
                    <span style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: accentVar,
                      animation: 'pulse 1.5s infinite',
                    }} />
                  )}
                  {isLive ? 'LIVE NOW' : 'NEXT UP'}
                </div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>
                  {countryFlag(hero.country)} {hero.name}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 2 }}>
                  {hero.location ?? countryName(hero.country)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {formatDateRange(hero.starts_at, hero.ends_at)}
                </div>
              </div>
              {/* Countdown or round badge */}
              {isLive ? (
                liveRound && (
                  <div style={{
                    fontSize: 10, fontWeight: 700, color: accentVar,
                    background: `rgba(${accent},0.12)`, borderRadius: 6, padding: '4px 8px',
                  }}>
                    {liveRound}
                  </div>
                )
              ) : (
                <div style={{
                  textAlign: 'center', padding: '8px 12px', borderRadius: 12,
                  background: `rgba(${accent},0.08)`, border: `1px solid rgba(${accent},0.15)`,
                  flexShrink: 0,
                }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: accentVar, fontFamily: 'monospace', lineHeight: 1 }}>
                    {days}
                  </div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>
                    DAYS
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, position: 'relative' }}>
              {hero.prize_money && hero.prize_money !== 'EUR 0' && (
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{hero.prize_money}</div>
              )}
              {!hasLiveCoverage(hero.level) && (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  fontSize: 9, fontWeight: 600, color: 'var(--text-muted)',
                  background: 'rgba(255,255,255,0.05)', borderRadius: 4,
                  padding: '2px 6px',
                }}>
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
                  Results only
                </div>
              )}
              <div style={{ flex: 1 }} />
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '6px 14px', borderRadius: 8,
                background: `rgba(${accent},0.12)`, border: `1px solid rgba(${accent},0.25)`,
                fontSize: 11, fontWeight: 700, color: accentVar,
              }}>
                {isLive ? 'View Matches' : 'View'}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
              </div>
            </div>
          </div>
        </Link>
      </div>

      {/* Compact horizontal strip for remaining upcoming */}
      {rest.length > 0 && (
        <div style={{
          display: 'flex', gap: 8, padding: '0 16px', overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}>
          {rest.map(t => {
            const d = daysUntil(t.starts_at)
            const startDate = new Date(t.starts_at)
            const dateLabel = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()
            return (
              <Link key={t.id} href={`/v2/tournaments/${t.id}`} data-tournament-id={t.id} style={{ textDecoration: 'none', color: 'inherit', flexShrink: 0 }}>
                <div style={{
                  padding: '10px 14px', borderRadius: 10,
                  background: 'var(--bg-card)', border: '1px solid var(--border-card)',
                  minWidth: 150, cursor: 'pointer',
                }}>
                  <div style={{ fontSize: 9, color: 'var(--text-dim)', fontWeight: 600, marginBottom: 4 }}>
                    {dateLabel}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                    {countryFlag(t.country)} {t.name}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {d} days
                    {!hasLiveCoverage(t.level) && (
                      <span style={{ fontSize: 8, color: 'var(--text-dim)' }}>· Results only</span>
                    )}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CompletedCarousel({ tournaments }: { tournaments: TournamentWithWinners[] }) {
  function shortName(fullName: string | null): string {
    if (!fullName) return '—'
    const parts = fullName.trim().split(' ')
    return parts[parts.length - 1]
  }

  return (
    <div style={{
      display: 'flex', gap: 12, padding: '0 16px 16px', overflowX: 'auto',
      WebkitOverflowScrolling: 'touch',
    }}>
      {tournaments.map((t, i) => {
        const menWinners = t.winners.find(w => w.category === 'men')
        const womenWinners = t.winners.find(w => w.category === 'women')
        const isFirst = i === 0

        return (
          <Link key={t.id} href={`/v2/tournaments/${t.id}?round=Finals`} data-tournament-id={t.id} style={{ textDecoration: 'none', color: 'inherit', flexShrink: 0 }}>
            <div style={{
              minWidth: isFirst ? 300 : 260, borderRadius: 14,
              background: 'var(--bg-card)', border: '1px solid var(--border-card)',
              overflow: 'hidden', cursor: 'pointer',
            }}>
              {/* Header */}
              <div style={{
                padding: '12px 14px', display: 'flex', alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: (menWinners || womenWinners) ? '1px solid rgba(255,255,255,0.06)' : 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 20 }}>{countryFlag(t.country)}</span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{t.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      {formatDateShort(t.starts_at, t.ends_at)} · {t.location ?? countryName(t.country)}
                    </div>
                  </div>
                </div>
                {t.level && (
                  <div style={{
                    fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 4,
                    background: t.level === 'major' || t.level === 'finals'
                      ? 'rgba(245,158,11,0.1)' : 'rgba(56,200,255,0.1)',
                    color: t.level === 'major' || t.level === 'finals'
                      ? '#F59E0B' : 'var(--color-accent)',
                    flexShrink: 0,
                  }}>
                    {levelLabel(t.level).toUpperCase()}
                  </div>
                )}
              </div>

              {/* Champions */}
              {(menWinners || womenWinners) && (
                <div style={{ padding: '12px 14px' }}>
                  <div style={{
                    fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.06em', color: '#F59E0B', marginBottom: 8,
                  }}>
                    Champions
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {menWinners && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 4, height: 24, borderRadius: 2, background: '#5BA8FF', flexShrink: 0 }} />
                        <div style={{ display: 'flex', flexShrink: 0, marginRight: 4 }}>
                          {menWinners.player1_avatar && (
                            <img src={menWinners.player1_avatar} alt="" style={{
                              width: 24, height: 24, borderRadius: '50%', objectFit: 'cover',
                              border: '1.5px solid var(--bg-base)', background: 'var(--bg-card-alt)',
                            }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                          )}
                          {menWinners.player2_avatar && (
                            <img src={menWinners.player2_avatar} alt="" style={{
                              width: 24, height: 24, borderRadius: '50%', objectFit: 'cover',
                              border: '1.5px solid var(--bg-base)', background: 'var(--bg-card-alt)',
                              marginLeft: -8,
                            }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 600 }}>
                          {shortName(menWinners.player1_name)} / {shortName(menWinners.player2_name)}
                        </div>
                      </div>
                    )}
                    {womenWinners && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 4, height: 24, borderRadius: 2, background: '#F472B6', flexShrink: 0 }} />
                        <div style={{ display: 'flex', flexShrink: 0, marginRight: 4 }}>
                          {womenWinners.player1_avatar && (
                            <img src={womenWinners.player1_avatar} alt="" style={{
                              width: 24, height: 24, borderRadius: '50%', objectFit: 'cover',
                              border: '1.5px solid var(--bg-base)', background: 'var(--bg-card-alt)',
                            }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                          )}
                          {womenWinners.player2_avatar && (
                            <img src={womenWinners.player2_avatar} alt="" style={{
                              width: 24, height: 24, borderRadius: '50%', objectFit: 'cover',
                              border: '1.5px solid var(--bg-base)', background: 'var(--bg-card-alt)',
                              marginLeft: -8,
                            }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 600 }}>
                          {shortName(womenWinners.player1_name)} / {shortName(womenWinners.player2_name)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </Link>
        )
      })}
    </div>
  )
}

function CollapsibleSeason({ year, tournaments }: { year: number; tournaments: TournamentWithWinners[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          width: '100%', padding: '14px 16px 10px',
          background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round"
          style={{ transition: 'transform 0.2s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          <polyline points="9 18 15 12 9 6"/>
        </svg>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          {year} Season
        </span>
        <span style={{
          fontSize: 10, fontWeight: 600, color: 'var(--text-dim)',
          background: 'var(--bg-card-alt)', borderRadius: 10, padding: '2px 8px',
        }}>
          {tournaments.length} events
        </span>
      </button>
      {open && (
        <CompletedCarousel tournaments={tournaments} />
      )}
    </div>
  )
}


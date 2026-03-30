'use client'
// src/app/v2/tournaments/page.tsx
// Tournament browser — Premier Padel (default) & FIP Tour tabs
// Sections: Live hero → Upcoming (2-col grid) → Completed (cards with winners)

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { countryFlag } from '@/types/match'
import SearchOverlay from '../SearchOverlay'

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
    fip_platinum: 'FIP Platinum', fip_gold: 'FIP Gold', fip_other: 'FIP Tour',
  }
  return level ? (map[level] ?? level) : ''
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
const FIP_LEVELS = ['fip_platinum', 'fip_gold', 'fip_other']

// ── Main Page ─────────────────────────────────────────────────────────────

export default function TournamentsPage() {
  const router = useRouter()
  const [searchOpen, setSearchOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('premier')
  const [fipFilter, setFipFilter] = useState<FipFilter>('all')
  const [tournaments, setTournaments] = useState<TournamentWithWinners[]>([])
  const [loading, setLoading] = useState(true)
  const [liveMatches, setLiveMatches] = useState<Record<string, any[]>>({})
  const [liveTournamentIds, setLiveTournamentIds] = useState<Set<string>>(new Set())

  // ── Fetch tournaments + winners ──────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true)

    // Get all tournaments for current season
    const { data: tournamentsData } = await supabase
      .from('tournaments')
      .select('id, name, starts_at, ends_at, country, level, location, prize_money')
      .not('level', 'is', null)
      .order('starts_at', { ascending: false })
      .limit(100)

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
        // Tournament is live if it has an active match, or has started and still has scheduled matches
        if (hasLiveMatch || (hasFinished && hasScheduled)) confirmedLiveIds.add(t.id)
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
        .in('round', ['Finals', 'Final', 'FINAL', 'finals', 'final'])
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

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, padding: '12px 16px 4px' }}>
        {(['premier', 'fip'] as const).map(t => (
          <button
            key={t}
            onClick={() => { setTab(t); if (t === 'premier') setFipFilter('all') }}
            style={{
              flex: 1, padding: '8px 0', textAlign: 'center',
              fontSize: 12, fontWeight: 700, letterSpacing: '0.03em',
              borderRadius: 8, cursor: 'pointer', border: 'none',
              fontFamily: 'inherit', transition: 'all 0.15s',
              background: tab === t ? 'var(--color-accent)' : 'var(--bg-card-alt)',
              color: tab === t ? '#000' : 'var(--text-muted)',
              ...(tab !== t ? { border: '1px solid var(--border-card)' } : {}),
            }}
          >
            {t === 'premier' ? 'Premier Padel' : 'FIP Tour'}
          </button>
        ))}
      </div>

      {/* FIP filter chips */}
      {tab === 'fip' && (
        <div style={{ display: 'flex', gap: 6, padding: '12px 16px 8px', overflowX: 'auto' }}>
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
        <div style={{ padding: '60px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading tournaments...</div>
        </div>
      ) : (
        <>
          {/* Live hero */}
          {live.map(t => {
            const round = getCurrentRound(liveMatches[t.id] ?? [])
            return (
              <div key={t.id} style={{ padding: '12px 16px 0' }}>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  background: 'var(--color-live-bg)', borderRadius: 6,
                  padding: '3px 10px', fontSize: 10, fontWeight: 700,
                  color: 'var(--color-live)', letterSpacing: '0.04em',
                  marginBottom: 10,
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: 'var(--color-live)',
                    animation: 'pulse 1.5s infinite',
                  }} />
                  LIVE
                </div>

                <Link href={`/v2/matches?tournament=${t.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div style={{
                    borderRadius: 14, padding: '16px 18px',
                    background: 'linear-gradient(135deg, var(--bg-card) 0%, rgba(255,70,85,0.06) 100%)',
                    border: '1px solid var(--color-live-border)',
                    position: 'relative', overflow: 'hidden', cursor: 'pointer',
                  }}>
                    <div style={{
                      position: 'absolute', top: -30, right: -30, width: 100, height: 100,
                      borderRadius: '50%', background: 'rgba(255,70,85,0.08)', filter: 'blur(30px)',
                    }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative' }}>
                      <div>
                        <h3 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px' }}>
                          {countryFlag(t.country)} {t.name}
                        </h3>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          {t.location ?? countryName(t.country)}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span>{formatDateRange(t.starts_at, t.ends_at)}</span>
                          {t.prize_money && t.prize_money !== 'EUR 0' && (
                            <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>· {t.prize_money}</span>
                          )}
                        </div>
                      </div>
                      {round && (
                        <div style={{
                          fontSize: 10, fontWeight: 700, color: 'var(--color-live)',
                          background: 'var(--color-live-bg)', borderRadius: 4, padding: '2px 6px',
                        }}>
                          {round}
                        </div>
                      )}
                    </div>
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      marginTop: 12, padding: '6px 14px', borderRadius: 8,
                      background: 'rgba(255,70,85,0.12)', border: '1px solid rgba(255,70,85,0.25)',
                      fontSize: 11, fontWeight: 700, color: 'var(--color-live)',
                      position: 'relative',
                    }}>
                      View Matches
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
                    </div>
                  </div>
                </Link>
              </div>
            )
          })}

          {/* Upcoming — grouped by month */}
          {upcoming.length > 0 && (
            <>
              <SectionHeader
                icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>}
                title="Upcoming"
                count={`${upcoming.length} events`}
              />
              {(() => {
                const byMonth: Record<string, TournamentWithWinners[]> = {}
                for (const t of upcoming) {
                  const d = new Date(t.starts_at)
                  const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`
                  const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
                  if (!byMonth[key]) byMonth[key] = []
                  byMonth[key].push({ ...t, _monthLabel: label } as any)
                }
                return Object.entries(byMonth).map(([key, items]) => (
                  <div key={key}>
                    <div style={{
                      padding: '10px 16px 6px', fontSize: 10, fontWeight: 700,
                      color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em',
                    }}>
                      {(items[0] as any)._monthLabel}
                    </div>
                    <div style={{
                      display: 'grid', gridTemplateColumns: '1fr 1fr',
                      gap: 10, padding: '0 16px',
                    }}>
                      {items.map(t => (
                        <UpcomingCard key={t.id} tournament={t} />
                      ))}
                    </div>
                  </div>
                ))
              })()}
            </>
          )}

          {/* Completed — current season + collapsible previous seasons */}
          {completed.length > 0 && (
            <>
              {(() => {
                const currentYear = new Date().getFullYear()
                const currentSeason = completed.filter(t => new Date(t.starts_at).getFullYear() === currentYear)
                const previousSeasons = completed.filter(t => new Date(t.starts_at).getFullYear() < currentYear)

                // Group previous by year
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
                        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {currentSeason.map(t => (
                            <CompletedCard key={t.id} tournament={t} />
                          ))}
                        </div>
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
        </>
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
          fontSize: 10, fontWeight: 600, color: 'var(--text-faint)',
          background: 'var(--bg-card-alt)', borderRadius: 10, padding: '2px 8px',
        }}>
          {count}
        </span>
      )}
    </div>
  )
}

function UpcomingCard({ tournament: t }: { tournament: Tournament }) {
  const days = daysUntil(t.starts_at)

  return (
    <Link href={`/v2/matches?tournament=${t.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div style={{
        borderRadius: 12, padding: 14,
        background: 'var(--bg-card)', border: '1px solid var(--border-card)',
        cursor: 'pointer', overflow: 'hidden',
        height: '100%', display: 'flex', flexDirection: 'column',
        minWidth: 0,
      }}>
        <span style={{ fontSize: 20, marginBottom: 8, display: 'block' }}>
          {countryFlag(t.country)}
        </span>
        <div style={{
          fontSize: 13, fontWeight: 700, color: 'var(--text-primary)',
          marginBottom: 2, lineHeight: 1.2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {t.name}
        </div>
        <div style={{
          fontSize: 11, color: 'var(--text-muted)', marginBottom: 8,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {t.location ?? countryName(t.country)}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 500, marginBottom: 8 }}>
          {formatDateShort(t.starts_at, t.ends_at)}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: 'auto' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}>
            {days}d
          </span>
        </div>
      </div>
    </Link>
  )
}

function CompletedCard({ tournament: t }: { tournament: TournamentWithWinners }) {
  const menWinners = t.winners.find(w => w.category === 'men')
  const womenWinners = t.winners.find(w => w.category === 'women')

  function shortName(fullName: string | null): string {
    if (!fullName) return '—'
    const parts = fullName.trim().split(' ')
    return parts[parts.length - 1] // last name
  }

  return (
    <Link href={`/v2/matches?tournament=${t.id}&round=Finals`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div style={{
        padding: 14, background: 'var(--bg-card)',
        border: '1px solid var(--border-card)', borderRadius: 12, cursor: 'pointer',
      }}>
        {/* Top row: flag + name + date + chevron */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20, flexShrink: 0, width: 28, textAlign: 'center' }}>
            {countryFlag(t.country)}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
              {t.name}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>{formatDateShort(t.starts_at, t.ends_at)}</span>
              <span>· {t.location ?? countryName(t.country)}</span>
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2" strokeLinecap="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </div>

        {/* Winners section */}
        {(menWinners || womenWinners) && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-base)' }}>
            <div style={{
              fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.06em', color: 'var(--text-faint)', marginBottom: 6,
            }}>
              Winners
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              {menWinners && (
                <WinnerEntry category="men" winner={menWinners} shortName={shortName} />
              )}
              {womenWinners && (
                <WinnerEntry category="women" winner={womenWinners} shortName={shortName} />
              )}
            </div>
          </div>
        )}
      </div>
    </Link>
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
          fontSize: 10, fontWeight: 600, color: 'var(--text-faint)',
          background: 'var(--bg-card-alt)', borderRadius: 10, padding: '2px 8px',
        }}>
          {tournaments.length} events
        </span>
      </button>
      {open && (
        <div style={{ padding: '0 16px 8px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {tournaments.map(t => (
            <CompletedCard key={t.id} tournament={t} />
          ))}
        </div>
      )}
    </div>
  )
}

function WinnerEntry({ category, winner, shortName }: {
  category: 'men' | 'women'
  winner: Winner
  shortName: (name: string | null) => string
}) {
  const catColor = category === 'men' ? '#5BA8FF' : '#F472B6'
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'flex', flexShrink: 0 }}>
        <img
          src={winner.player1_avatar ?? ''}
          alt=""
          style={{
            width: 24, height: 24, borderRadius: '50%', objectFit: 'cover',
            border: '1.5px solid var(--bg-base)', background: 'var(--bg-card-alt)',
          }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
        <img
          src={winner.player2_avatar ?? ''}
          alt=""
          style={{
            width: 24, height: 24, borderRadius: '50%', objectFit: 'cover',
            border: '1.5px solid var(--bg-base)', background: 'var(--bg-card-alt)',
            marginLeft: -8,
          }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
      </div>
      <div style={{ minWidth: 0 }}>
        <span style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: catColor }}>
          {category === 'men' ? 'Men' : 'Women'}
        </span>
        <div style={{
          fontSize: 10, color: 'var(--text-secondary)', fontWeight: 500,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {shortName(winner.player1_name)} / {shortName(winner.player2_name)}
        </div>
      </div>
    </div>
  )
}

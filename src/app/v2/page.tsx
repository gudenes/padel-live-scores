'use client'
// src/app/v2/page.tsx
// Home / landing page — always has content regardless of live match state.
// Sections: Live Now (conditional) → Upcoming Tournament → Rankings → Recent Results

import { useEffect, useState, useCallback, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Match, countryFlag } from '@/types/match'
import MatchCard from '../components/MatchCard'
import Link from 'next/link'

// ── Country names ──────────────────────────────────────────────────────────

const COUNTRY_NAMES: Record<string, string> = {
  ES: 'Spain', AR: 'Argentina', BR: 'Brazil', PT: 'Portugal',
  FR: 'France', IT: 'Italy', BE: 'Belgium', NL: 'Netherlands',
  DE: 'Germany', GB: 'Great Britain', DK: 'Denmark', SE: 'Sweden',
  UY: 'Uruguay', PY: 'Paraguay', CL: 'Chile', MX: 'Mexico',
  US: 'United States', AU: 'Australia', QA: 'Qatar', AE: 'UAE',
}

function countryName(code: string | null): string {
  if (!code) return ''
  return COUNTRY_NAMES[code.toUpperCase()] ?? code
}

// ── Types ──────────────────────────────────────────────────────────────────

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


interface Highlight {
  id: string
  youtube_id: string
  title: string
  channel_name: string
  thumbnail_url: string
  duration: string | null
  view_count: number
  published_at: string
  category: string | null
}

interface RankedPlayer {
  id: string
  name: string
  country: string | null
  ranking: number | null
  points: number | null
  avatar_url: string | null
  category: string | null
}

// ── Helpers ────────────────────────────────────────────────────────────────

function daysUntil(dateStr: string): number {
  const now = new Date()
  const target = new Date(dateStr)
  const diff = target.getTime() - now.getTime()
  return Math.max(0, Math.ceil(diff / 86400000))
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(start)
  const e = new Date(end)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  return `${s.toLocaleDateString('en-US', opts)} - ${e.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`
}

function levelLabel(level: string | null): string {
  const map: Record<string, string> = {
    finals: 'Finals', major: 'Major', p1: 'P1', p2: 'P2',
    fip_platinum: 'FIP Platinum', fip_gold: 'FIP Gold', fip_other: 'FIP Tour',
  }
  return level ? (map[level] ?? level) : ''
}

// ── Sub-components ─────────────────────────────────────────────────────────

function CollapsibleSection({ title, action, href, children, defaultOpen = true }: {
  title: string; action?: string; href?: string; children: ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 16px 8px' }}>
        <button
          onClick={() => setOpen(o => !o)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
            padding: 0, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            {title}
          </span>
        </button>
        {action && href && (
          <Link href={href} style={{ color: 'var(--color-accent)', fontSize: 12, fontWeight: 600, textDecoration: 'none', fontFamily: 'var(--font-sans)' }}>
            {action} ›
          </Link>
        )}
      </div>
      {open && children}
    </div>
  )
}

function UpcomingTournamentCard({ tournament }: { tournament: Tournament }) {
  const days = daysUntil(tournament.starts_at)
  const isLive = days === 0
  return (
    <div style={{
      margin: '0 16px', borderRadius: 14,
      background: isLive
        ? 'linear-gradient(135deg, var(--bg-card) 0%, rgba(255,70,85,0.06) 100%)'
        : 'linear-gradient(135deg, var(--bg-card) 0%, rgba(56,200,255,0.06) 100%)',
      border: `1px solid ${isLive ? 'var(--color-live-border)' : 'var(--color-accent-border)'}`,
      padding: '16px 18px', position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', top: -30, right: -30, width: 100, height: 100,
        borderRadius: '50%', background: isLive ? 'rgba(255,70,85,0.06)' : 'rgba(56,200,255,0.06)', filter: 'blur(30px)',
      }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative' }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px' }}>
            {tournament.name}
          </h3>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>{countryFlag(tournament.country)}</span>
            <span>{tournament.location ?? countryName(tournament.country)}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{formatDateRange(tournament.starts_at, tournament.ends_at)}</span>
            {tournament.prize_money && tournament.prize_money !== 'EUR 0' && (
              <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>· {tournament.prize_money}</span>
            )}
          </div>
        </div>

        {!isLive && (
          <div style={{
            background: 'var(--bg-card-alt)', borderRadius: 10,
            padding: '8px 12px', textAlign: 'center',
            border: '1px solid var(--border-card)',
          }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--color-accent)', fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
              {days}
            </div>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', marginTop: 3 }}>
              {days === 1 ? 'DAY' : 'DAYS'}
            </div>
          </div>
        )}
      </div>

      {tournament.level && (
        <div style={{
          display: 'inline-block', marginTop: 10,
          padding: '3px 10px', borderRadius: 6,
          background: isLive ? 'var(--color-live-bg)' : 'var(--color-accent-bg)',
          fontSize: 10, fontWeight: 700, color: isLive ? 'var(--color-live)' : 'var(--color-accent)',
          letterSpacing: '0.04em', textTransform: 'uppercase',
        }}>
          {levelLabel(tournament.level)}
        </div>
      )}
    </div>
  )
}

function RankingsWidget({ men, women }: { men: RankedPlayer[]; women: RankedPlayer[] }) {
  const [tab, setTab] = useState<'men' | 'women'>('men')
  const players = tab === 'men' ? men : women
  const medalColors = ['#F59E0B', '#94A3B8', '#CD7F32']

  return (
    <div style={{ margin: '0 16px', borderRadius: 14, background: 'var(--bg-card)', border: '1px solid var(--border-card)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>FIP Ranking</span>
        <div style={{ display: 'flex', gap: 0, background: 'var(--bg-card-alt)', borderRadius: 8, padding: 2 }}>
          {(['men', 'women'] as const).map(g => (
            <button key={g} onClick={() => setTab(g)} style={{
              padding: '4px 12px', borderRadius: 6, border: 'none',
              fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
              background: tab === g ? (g === 'women' ? 'var(--color-women)' : 'var(--color-accent)') : 'transparent',
              color: tab === g ? '#000' : 'var(--text-muted)',
              transition: 'all 0.15s',
            }}>
              {g === 'men' ? 'M' : 'F'}
            </button>
          ))}
        </div>
      </div>

      {players.map((p, i) => {
        const initials = p.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
        const borderColor = tab === 'women' ? 'var(--color-women-border)' : 'var(--color-men-border)'
        const textColor = tab === 'women' ? 'var(--color-women)' : 'var(--color-men)'
        return (
          <div key={p.id} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 14px', borderTop: '1px solid var(--border-inner)',
          }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: medalColors[i] ?? 'var(--color-accent)', width: 24, textAlign: 'right' }}>
              {p.ranking}
            </span>
            {p.avatar_url ? (
              <img src={p.avatar_url} alt={p.name} style={{
                width: 34, height: 34, borderRadius: '50%', objectFit: 'cover',
                border: `2px solid ${borderColor}`, flexShrink: 0,
              }} />
            ) : (
              <div style={{
                width: 34, height: 34, borderRadius: '50%', background: 'var(--bg-card-alt)',
                border: `2px solid ${borderColor}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, color: textColor, flexShrink: 0,
              }}>
                {initials}
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {p.name}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {countryFlag(p.country)} {countryName(p.country)}
              </div>
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}>
              {(p.points ?? 0).toLocaleString()}
            </span>
          </div>
        )
      })}

      <Link href="/v2/ranking" style={{ display: 'block', padding: '10px 14px', borderTop: '1px solid var(--border-inner)', textAlign: 'center', textDecoration: 'none' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-accent)' }}>See full ranking ›</span>
      </Link>
    </div>
  )
}



function RecentResultsWidget({ matches }: { matches: Match[] }) {
  const [tab, setTab] = useState<'men' | 'women'>('men')
  const filtered = matches
    .filter(m => (m as any).category === tab)
    .sort((a, b) => {
      const aDate = a.finished_at ? new Date(a.finished_at).getTime() : 0
      const bDate = b.finished_at ? new Date(b.finished_at).getTime() : 0
      return bDate - aDate
    })
    .slice(0, 10)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 16px 8px' }}>
        <div style={{ display: 'flex', gap: 0, background: 'var(--bg-card-alt)', borderRadius: 8, padding: 2 }}>
          {(['men', 'women'] as const).map(g => (
            <button key={g} onClick={() => setTab(g)} style={{
              padding: '4px 12px', borderRadius: 6, border: 'none',
              fontSize: 11, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
              background: tab === g
                ? (g === 'women' ? 'var(--color-women)' : 'var(--color-accent)')
                : 'transparent',
              color: tab === g ? '#000' : 'var(--text-muted)',
              transition: 'all 0.15s',
            }}>
              {g === 'men' ? 'M' : 'F'}
            </button>
          ))}
        </div>
      </div>
      <div style={{ padding: '0 16px' }}>
        {filtered.map(m => (
          <MatchCard key={m.id} match={m} viewerCount={0} expanded={false} onToggle={() => {}} />
        ))}
        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)', fontSize: 13 }}>
            No recent results
          </div>
        )}
      </div>
    </div>
  )
}

function HighlightsCarousel({ highlights }: { highlights: Highlight[] }) {
  const [playing, setPlaying] = useState<Highlight | null>(null)

  if (highlights.length === 0) return null

  function formatViews(count: number): string {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`
    if (count >= 1000) return `${Math.round(count / 1000)}K`
    return String(count)
  }

  return (
    <>
      <div style={{
        display: 'flex', gap: 12, padding: '0 16px 4px',
        overflowX: 'auto', scrollSnapType: 'x mandatory',
        WebkitOverflowScrolling: 'touch',
        msOverflowStyle: 'none', scrollbarWidth: 'none',
      }}>
        {highlights.map(v => (
          <button
            key={v.id}
            onClick={() => setPlaying(v)}
            style={{
              textDecoration: 'none', color: 'inherit', flexShrink: 0, width: 220,
              scrollSnapAlign: 'start', background: 'none', border: 'none',
              padding: 0, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
            }}
          >
            <div style={{
              borderRadius: 12, overflow: 'hidden',
              background: 'var(--bg-card)', border: '1px solid var(--border-card)',
            }}>
              <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#1a1a2e' }}>
                <img
                  src={v.thumbnail_url}
                  alt={v.title}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'rgba(0,0,0,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%',
                    background: 'rgba(255,255,255,0.9)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                  }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="#111" stroke="none">
                      <polygon points="6,3 20,12 6,21" />
                    </svg>
                  </div>
                </div>
                {v.duration && (
                  <div style={{
                    position: 'absolute', bottom: 6, right: 6,
                    background: 'rgba(0,0,0,0.8)', borderRadius: 4,
                    padding: '2px 6px', fontSize: 10, fontWeight: 700,
                    color: '#fff', fontFamily: 'var(--font-mono)',
                  }}>
                    {v.duration}
                  </div>
                )}
              </div>
              <div style={{ padding: '10px 12px' }}>
                <div style={{
                  fontSize: 12, fontWeight: 600, color: 'var(--text-primary)',
                  lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical' as any, overflow: 'hidden',
                }}>
                  {v.title}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{v.channel_name}</span>
                  {v.view_count > 0 && (
                    <>
                      <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>·</span>
                      <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{formatViews(v.view_count)} views</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Inline YouTube player modal */}
      {playing && (
        <div
          onClick={() => setPlaying(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(0,0,0,0.92)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: '16px',
          }}
        >
          {/* Close button */}
          <button
            onClick={() => setPlaying(null)}
            style={{
              position: 'absolute', top: 16, right: 16,
              width: 36, height: 36, borderRadius: '50%',
              background: 'rgba(255,255,255,0.15)', border: 'none',
              color: '#fff', fontSize: 20, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ✕
          </button>

          {/* Video player */}
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 500, aspectRatio: '16/9', borderRadius: 12, overflow: 'hidden' }}
          >
            <iframe
              src={`https://www.youtube.com/embed/${playing.youtube_id}?autoplay=1&rel=0`}
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              style={{ width: '100%', height: '100%', border: 'none' }}
            />
          </div>

          {/* Title below player */}
          <div style={{ maxWidth: 500, width: '100%', marginTop: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', lineHeight: 1.3 }}>
              {playing.title}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>
              {playing.channel_name}{playing.view_count > 0 ? ` · ${formatViews(playing.view_count)} views` : ''}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function NoLiveBanner() {
  return (
    <div style={{
      margin: '0 16px', borderRadius: 14, background: 'var(--bg-card)',
      border: '1px solid var(--border-card)', padding: '20px 18px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>&#127934;</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>No live matches right now</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Check back during tournament days for live scores</div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function HomePage() {
  const router = useRouter()
  const [liveMatches, setLiveMatches] = useState<Match[]>([])
  const [scheduledMatches, setScheduledMatches] = useState<Match[]>([])
  const [upcomingTournaments, setUpcomingTournaments] = useState<Tournament[]>([])
  const [topMen, setTopMen] = useState<RankedPlayer[]>([])
  const [topWomen, setTopWomen] = useState<RankedPlayer[]>([])
  const [recentMatches, setRecentMatches] = useState<Match[]>([])
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    // Run all queries in parallel
    const [liveRes, scheduledRes, tournamentRes, menRes, womenRes, recentRes, highlightsRes] = await Promise.all([
      // Live matches (full data for MatchCard)
      supabase
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
        .eq('status', 'live')
        .order('court_order', { ascending: true }),

      // Next scheduled matches (for when tournament is live but no matches are)
      (() => {
        const todayStart = new Date()
        todayStart.setHours(0, 0, 0, 0)
        return supabase
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
          .eq('status', 'scheduled')
          .gte('scheduled_at', todayStart.toISOString())
          .order('scheduled_at', { ascending: true })
          .limit(4)
      })(),

      // Upcoming or current Premier Padel tournament
      supabase
        .from('tournaments')
        .select('id, name, starts_at, ends_at, country, level, location, prize_money')
        .in('level', ['finals', 'major', 'p1', 'p2'])
        .gte('ends_at', new Date().toISOString())
        .order('starts_at', { ascending: true })
        .limit(2),

      // Top 10 men
      supabase
        .from('players')
        .select('id, name, country, ranking, points, avatar_url, category')
        .eq('category', 'men')
        .not('ranking', 'is', null)
        .order('ranking', { ascending: true })
        .limit(10),

      // Top 10 women
      supabase
        .from('players')
        .select('id, name, country, ranking, points, avatar_url, category')
        .eq('category', 'women')
        .not('ranking', 'is', null)
        .order('ranking', { ascending: true })
        .limit(10),

      // Recent finished matches
      supabase
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
        .in('status', ['finished', 'retired', 'walkover'])
        .order('finished_at', { ascending: false })
        .limit(20),

      // Video highlights
      supabase
        .from('highlights')
        .select('id, youtube_id, title, channel_name, thumbnail_url, duration, view_count, published_at, category')
        .eq('status', 'active')
        .order('published_at', { ascending: false })
        .limit(10),
    ])

    setLiveMatches((liveRes.data as any) ?? [])
    setScheduledMatches((scheduledRes.data as any) ?? [])
    setUpcomingTournaments((tournamentRes.data as any) ?? [])
    setTopMen((menRes.data as any) ?? [])
    setTopWomen((womenRes.data as any) ?? [])
    setRecentMatches((recentRes.data as any) ?? [])
    setHighlights((highlightsRes.data as any) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Subscribe to live match changes
  useEffect(() => {
    const channel = supabase
      .channel('home-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: 'status=eq.live' }, () => {
        fetchData()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchData])

  if (loading) {
    return (
      <div style={{ maxWidth: 500, margin: '0 auto', padding: '60px 20px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 14 }}>
        Loading...
      </div>
    )
  }

  const liveCount = liveMatches.length

  return (
    <div style={{ maxWidth: 500, margin: '0 auto', paddingBottom: 20 }}>

      {/* Header — logo left, search center, profile right */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px',
        borderBottom: '0.5px solid rgba(255,255,255,0.06)',
        position: 'sticky', top: 0, zIndex: 10,
        background: 'var(--bg-base)',
      }}>
        <img src="/padel-nacho-logo.png" alt="Padel Nachos" style={{ height: 26, width: 'auto', objectFit: 'contain', flexShrink: 0 }} />

        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--bg-input)', borderRadius: 10,
          border: '1px solid var(--border-card)',
          padding: '7px 12px', cursor: 'pointer',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>Search players, tournaments...</span>
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

      {/* Live matches */}
      {liveCount > 0 ? (
        <CollapsibleSection title="Live Now" action={`See all ${liveCount} live`} href="/v2/matches">
          <div style={{ padding: '0 16px' }}>
            {liveMatches.slice(0, 6).map(m => (
              <MatchCard key={m.id} match={m} viewerCount={0} expanded={false} onToggle={() => {}} />
            ))}
          </div>
        </CollapsibleSection>
      ) : scheduledMatches.length > 0 ? (
        <CollapsibleSection title="Coming Up" action="All matches" href="/v2/matches">
          <div style={{ padding: '0 16px' }}>
            {scheduledMatches.map(m => (
              <MatchCard key={m.id} match={m} viewerCount={0} expanded={false} onToggle={() => {}} />
            ))}
          </div>
        </CollapsibleSection>
      ) : (
        <>
          <div style={{ height: 12 }} />
          <NoLiveBanner />
        </>
      )}

      {/* Video Highlights */}
      {highlights.length > 0 && (
        <CollapsibleSection title="Highlights" action="See all" href="/v2">
          <HighlightsCarousel highlights={highlights} />
        </CollapsibleSection>
      )}

      {/* Upcoming tournaments */}
      {upcomingTournaments.length > 0 && (
        <CollapsibleSection title="Upcoming Tournaments" action="See all" href="/v2/tournaments">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {upcomingTournaments.map(t => (
              <UpcomingTournamentCard key={t.id} tournament={t} />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Rankings */}
      {(topMen.length > 0 || topWomen.length > 0) && (
        <CollapsibleSection title="Rankings" action="Full ranking" href="/v2/ranking">
          <RankingsWidget men={topMen} women={topWomen} />
        </CollapsibleSection>
      )}

      {/* Recent results */}
      {recentMatches.length > 0 && (
        <CollapsibleSection title="Recent Results" action="All results" href="/v2/matches">
          <RecentResultsWidget matches={recentMatches} />
        </CollapsibleSection>
      )}

      <div style={{ height: 20 }} />
    </div>
  )
}

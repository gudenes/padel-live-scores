'use client'
// src/app/v2/page.tsx
// Home / landing page — always has content regardless of live match state.
// Sections: Live Now (conditional) → Upcoming Tournament → Rankings → Recent Results

import { useEffect, useState, useCallback, useRef, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Match, countryFlag, pairName, isWarmingUp } from '@/types/match'
import MatchCard from '../components/MatchCard'
import Link from 'next/link'
import SearchOverlay from './SearchOverlay'

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
  allowed_countries: string[] | null
  blocked_countries: string[] | null
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



function TournamentGroup({ tournament, matches, defaultOpen = true }: { tournament: any; matches: Match[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{
      borderRadius: 12, overflow: 'hidden',
      border: '1px solid var(--border-card)',
      background: 'var(--bg-card)',
    }}>
      {tournament && (
        <button
          onClick={() => setOpen(o => !o)}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%',
            padding: '8px 12px',
            borderBottom: open ? '1px solid var(--border-card)' : 'none',
            background: 'transparent', border: 'none', borderBottomStyle: open ? 'solid' : 'none',
            borderBottomWidth: open ? 1 : 0, borderBottomColor: 'var(--border-card)',
            cursor: 'pointer', fontFamily: 'inherit', color: 'inherit', textAlign: 'left',
          }}
        >
          {tournament.country && (
            <span style={{ fontSize: 16, lineHeight: 1 }}>{countryFlag(tournament.country)}</span>
          )}
          <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
            {tournament.name}
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 600 }}>
            {matches.length}
          </span>
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="var(--text-faint)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
          >
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
      )}
      {open && (
        <div style={{ padding: '4px 10px 6px' }}>
          {matches.map(m => (
            <MatchCard key={m.id} match={m} viewerCount={0} expanded={false} onToggle={() => {}} embedded />
          ))}
        </div>
      )}
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

  // Group by tournament
  const grouped: { tournament: any; matches: Match[] }[] = []
  for (const m of filtered) {
    const t = (m as any).tournament
    const tid = t?.id ?? 'unknown'
    let group = grouped.find(g => (g.tournament?.id ?? 'unknown') === tid)
    if (!group) {
      group = { tournament: t, matches: [] }
      grouped.push(group)
    }
    group.matches.push(m)
  }

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
      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {grouped.map((group, idx) => (
          <TournamentGroup key={group.tournament?.id ?? 'unknown'} tournament={group.tournament} matches={group.matches} defaultOpen={idx === 0} />
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

const SPOILER_STYLES = `
@keyframes spoiler-icon-pop {
  0%, 85% { transform: scale(1); }
  89% { transform: scale(1.2); }
  93% { transform: scale(0.92); }
  97% { transform: scale(1.05); }
  100% { transform: scale(1); }
}
@keyframes spoiler-bounce {
  0% { transform: scale(1); }
  40% { transform: scale(1.03); }
  100% { transform: scale(1); }
}
@keyframes winner-banner-in {
  0% { opacity: 0; transform: scale(0.7); }
  50% { opacity: 1; transform: scale(1.05); }
  70% { transform: scale(0.97); }
  100% { opacity: 1; transform: scale(1); }
}
@keyframes winner-banner-out {
  0% { opacity: 1; transform: translateX(0); }
  100% { opacity: 0; transform: translateX(120%); }
}
@keyframes winner-avatar-in {
  0% { opacity: 0; transform: scale(0.5); }
  60% { opacity: 1; transform: scale(1.1); }
  100% { opacity: 1; transform: scale(1); }
}
@keyframes winner-glow-pulse {
  0%, 100% { box-shadow: 0 0 8px rgba(52,211,153,0.2), 0 0 0 0 rgba(52,211,153,0); }
  50% { box-shadow: 0 0 16px rgba(52,211,153,0.4), 0 0 30px rgba(52,211,153,0.1); }
}
`

function SpoilerCard({ match, label, color, children }: { match: Match; label: string; color: string; children: ReactNode }) {
  const alreadyRevealed = typeof window !== 'undefined' && localStorage.getItem(`spoiler-${match.id}`) === '1'
  const [state, setState] = useState<'hidden' | 'revealing' | 'revealed'>(alreadyRevealed ? 'revealed' : 'hidden')
  const [pressed, setPressed] = useState(false)
  const [showBanner, setShowBanner] = useState(false)
  const [bannerOut, setBannerOut] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  const winnerPair = (match as any).winner_pair as number | null
  const winnerP1 = winnerPair === 1 ? (match as any).pair1_player1 : winnerPair === 2 ? (match as any).pair2_player1 : null
  const winnerP2 = winnerPair === 1 ? (match as any).pair1_player2 : winnerPair === 2 ? (match as any).pair2_player2 : null
  const winnerNames = winnerP1 ? pairName(winnerP1, winnerP2) : null

  const handleReveal = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    if (state !== 'hidden') return

    // Get tap coordinates relative to container
    const rect = containerRef.current!.getBoundingClientRect()
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    const tapX = ((clientX - rect.left) / rect.width) * 100
    const tapY = ((clientY - rect.top) / rect.height) * 100

    // Set clip-path origin for radial wipe
    if (overlayRef.current) {
      overlayRef.current.style.setProperty('--tap-x', `${tapX}%`)
      overlayRef.current.style.setProperty('--tap-y', `${tapY}%`)
    }

    setState('revealing')
    localStorage.setItem(`spoiler-${match.id}`, '1')

    // Show winner banner after radial wipe starts
    setTimeout(() => setShowBanner(true), 300)

    // Start swiping banner out
    setTimeout(() => setBannerOut(true), 4000)

    // Fully revealed
    setTimeout(() => setState('revealed'), 4700)
  }

  return (
    <div ref={containerRef} style={{
      position: 'relative', overflow: 'hidden',
      animation: state === 'revealing' ? 'spoiler-bounce 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)' : undefined,
    }}>
      {/* Category label */}
      <div style={{ padding: '6px 6px 2px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 8, fontWeight: 800, color, textTransform: 'uppercase', letterSpacing: '1px' }}>{label}</span>
        <div style={{ flex: 1, height: '0.5px', background: 'var(--border-card)' }} />
      </div>

      {/* Match content — always rendered, blurred when hidden */}
      <div style={{
        filter: state === 'revealed' ? 'none' : 'blur(8px)',
        transition: 'filter 0.4s ease-out',
        pointerEvents: state === 'revealed' ? 'auto' : 'none',
      }}>
        {children}
      </div>

      {/* Transparent blur overlay with radial wipe */}
      {state !== 'revealed' && (
        <div
          ref={overlayRef}
          onClick={handleReveal}
          style={{
            position: 'absolute', inset: 0, top: 26,
            cursor: state === 'hidden' ? 'pointer' : 'default',
            zIndex: 2, borderRadius: 8, overflow: 'hidden',
            clipPath: state === 'revealing'
              ? 'circle(0% at var(--tap-x, 50%) var(--tap-y, 50%))'
              : 'circle(150% at var(--tap-x, 50%) var(--tap-y, 50%))',
            transition: state === 'revealing' ? 'clip-path 0.5s cubic-bezier(0.4, 0, 0.2, 1)' : undefined,
          }}
        >
          {/* Transparent blurred glass layer */}
          <div style={{
            position: 'absolute', inset: 0,
            backdropFilter: 'blur(28px) saturate(0.3) brightness(0.6)', WebkitBackdropFilter: 'blur(28px) saturate(0.3) brightness(0.6)',
            background: 'rgba(10, 18, 30, 0.65)',
          }} />
          {/* Tap to reveal button */}
          {state === 'hidden' && (
            <div
              onPointerDown={() => setPressed(true)}
              onPointerUp={() => setPressed(false)}
              onPointerLeave={() => setPressed(false)}
              style={{
                position: 'absolute', inset: 0,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <div style={{
                width: 48, height: 48, borderRadius: 12,
                background: pressed ? 'rgba(56,200,255,0.2)' : 'rgba(56,200,255,0.08)',
                border: `1.5px solid ${pressed ? 'rgba(56,200,255,0.5)' : 'rgba(56,200,255,0.2)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: 8,
                transform: pressed ? 'scale(0.82)' : 'scale(1)',
                transition: pressed
                  ? 'transform 0.08s ease-in, background 0.08s, border-color 0.08s'
                  : 'all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)',
                animation: !pressed ? 'spoiler-icon-pop 3s ease-in-out infinite' : undefined,
              }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={pressed ? 'var(--color-accent)' : 'rgba(56,200,255,0.6)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </div>
              <span style={{
                fontSize: 10, fontWeight: 700,
                color: pressed ? 'var(--color-accent)' : 'rgba(56,200,255,0.6)',
                letterSpacing: '0.5px',
                transform: pressed ? 'scale(0.9)' : 'scale(1)',
                transition: pressed ? 'transform 0.08s ease-in' : 'all 0.2s ease',
              }}>
                Tap to reveal
              </span>
            </div>
          )}
        </div>
      )}

      {/* Winner announcement banner */}
      {showBanner && winnerNames && (
        <div style={{
          position: 'absolute', inset: 0, top: 26,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none', zIndex: 3,
        }}>
          <div style={{
            background: 'rgba(10,15,25,0.88)',
            backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
            borderRadius: 14, padding: '12px 18px',
            textAlign: 'center',
            border: '1px solid rgba(52,211,153,0.3)',
            animation: bannerOut
              ? 'winner-banner-out 0.6s cubic-bezier(0.4, 0, 0.6, 1) forwards'
              : 'winner-banner-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards, winner-glow-pulse 2s ease-in-out 0.4s',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              {/* Avatars stacked/overlapping on the left */}
              <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                {[winnerP1, winnerP2].filter(Boolean).map((p: any, i: number) => (
                  <div key={p.id} style={{
                    marginLeft: i > 0 ? -12 : 0,
                    zIndex: 2 - i,
                    animation: `winner-avatar-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) ${0.15 + i * 0.15}s both`,
                  }}>
                    {p.avatar_url ? (
                      <img
                        src={`/api/img?src=${encodeURIComponent(p.avatar_url)}`}
                        alt={p.name}
                        style={{
                          width: 64, height: 64, borderRadius: '50%', objectFit: 'cover',
                        }}
                      />
                    ) : (
                      <div style={{
                        width: 64, height: 64, borderRadius: '50%',
                        background: '#0D2540',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 22, fontWeight: 700, color: 'var(--text-secondary)',
                      }}>
                        {p.name?.[0]}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {/* Label on the right */}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 9, fontWeight: 600, color: '#34d399', letterSpacing: '1px', textTransform: 'uppercase' }}>Champions</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function LatestWinnersWidget({ matches, tournament }: { matches: Match[]; tournament: any }) {
  if (matches.length === 0) return <NoLiveBanner />

  const menFinal = matches.find(m => (m as any).category === 'men')
  const womenFinal = matches.find(m => (m as any).category === 'women')

  return (
    <>
    <style dangerouslySetInnerHTML={{ __html: SPOILER_STYLES }} />
    <div style={{
      margin: '0 16px', borderRadius: 14, overflow: 'hidden',
      background: 'var(--bg-card)', border: '1px solid var(--border-card)',
    }}>
      {/* Tournament header */}
      <Link
        href={tournament ? `/v2/tournaments/${tournament.id}` : '#'}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px',
          borderBottom: '1px solid var(--border-card)',
          textDecoration: 'none', color: 'inherit',
        }}
      >
        {tournament?.logo_url ? (
          <img
            src={tournament.logo_url}
            alt=""
            style={{ width: 36, height: 36, objectFit: 'contain', borderRadius: 6, flexShrink: 0 }}
          />
        ) : tournament?.country ? (
          <span style={{ fontSize: 22, width: 36, textAlign: 'center', flexShrink: 0 }}>
            {countryFlag(tournament.country)}
          </span>
        ) : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {tournament?.name ?? 'Latest Tournament'}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 1 }}>
            Tap to reveal final results
          </div>
        </div>
        <span style={{
          fontSize: 9, fontWeight: 700, color: 'var(--text-dim)',
          background: 'var(--bg-input)', border: '0.5px solid var(--border-strong)',
          borderRadius: 6, padding: '3px 8px', flexShrink: 0,
          textTransform: 'uppercase', letterSpacing: '0.5px',
        }}>
          Finished
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2.5" strokeLinecap="round">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </Link>

      {/* Finals */}
      <div style={{ padding: '4px 10px 6px' }}>
        {menFinal && (
          <SpoilerCard match={menFinal} label="Men&apos;s Final" color="var(--color-men)">
            <MatchCard match={menFinal} embedded />
          </SpoilerCard>
        )}
        {womenFinal && (
          <SpoilerCard match={womenFinal} label="Women&apos;s Final" color="var(--color-women)">
            <MatchCard match={womenFinal} embedded />
          </SpoilerCard>
        )}
      </div>
    </div>
    </>
  )
}

function NewsTickerWidget({ items }: { items: { id: string; title: string; source_icon: string; source_name: string; url: string; published_at: string; language: string | null }[] }) {
  if (items.length === 0) return null

  const LANG_FLAGS: Record<string, string> = { en: '🇬🇧', es: '🇪🇸', pt: '🇵🇹', fr: '🇫🇷' }

  function ago(dateStr: string): string {
    const h = Math.floor((Date.now() - new Date(dateStr).getTime()) / 3600000)
    if (h < 1) return 'Now'
    if (h < 24) return `${h}h`
    const d = Math.floor(h / 24)
    return d === 1 ? '1d' : `${d}d`
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {items.map((n, i) => (
        <a
          key={n.id}
          href={n.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            fetch('/api/feed/click', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: n.id }),
            }).catch(() => {})
          }}
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: '10px 16px',
            borderBottom: i < items.length - 1 ? '0.5px solid var(--border-base)' : 'none',
            textDecoration: 'none', color: 'inherit',
          }}
        >
          <span style={{ fontSize: 14, flexShrink: 0, lineHeight: 1.2 }}>
            {n.language ? (LANG_FLAGS[n.language] ?? '🌐') : '🌐'}
          </span>
          <span style={{
            flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--text-primary)',
            lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical' as any, overflow: 'hidden',
          }}>
            {n.title}
          </span>
          <span style={{
            fontSize: 10, color: 'var(--text-faint)', flexShrink: 0,
            fontWeight: 500, marginTop: 2,
          }}>
            {ago(n.published_at)}
          </span>
        </a>
      ))}
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
  const [latestFinals, setLatestFinals] = useState<Match[]>([])
  const [latestFinalsTournament, setLatestFinalsTournament] = useState<any>(null)
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [latestNews, setLatestNews] = useState<{ id: string; title: string; source_icon: string; source_name: string; url: string; published_at: string; language: string | null }[]>([])
  const [userCountry, setUserCountry] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [searchOpen, setSearchOpen] = useState(false)

  const fetchData = useCallback(async () => {
    // Run all queries in parallel
    const [liveRes, scheduledRes, tournamentRes, menRes, womenRes, recentRes, highlightsRes, newsRes] = await Promise.all([
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

      // Next scheduled matches — status=scheduled means not played yet, no date filter needed
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
        .eq('status', 'scheduled')
        .order('scheduled_at', { ascending: true })
        .limit(4),

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
        .select('id, youtube_id, title, channel_name, thumbnail_url, duration, view_count, published_at, category, allowed_countries, blocked_countries')
        .eq('status', 'active')
        .order('published_at', { ascending: false })
        .limit(10),

      // Latest news articles
      supabase
        .from('articles')
        .select('id, title, source_icon, source_name, url, published_at, language')
        .eq('status', 'active')
        .order('published_at', { ascending: false })
        .limit(6),
    ])

    setLiveMatches((liveRes.data as any) ?? [])
    setScheduledMatches((scheduledRes.data as any) ?? [])
    setUpcomingTournaments((tournamentRes.data as any) ?? [])
    setTopMen((menRes.data as any) ?? [])
    setTopWomen((womenRes.data as any) ?? [])
    setRecentMatches((recentRes.data as any) ?? [])
    setHighlights((highlightsRes.data as any) ?? [])
    setLatestNews((newsRes.data as any) ?? [])

    // Fetch latest completed Premier Padel tournament finals
    const { data: latestTournament } = await supabase
      .from('tournaments')
      .select('id, name, country, level, ends_at, logo_url')
      .in('level', ['finals', 'major', 'p1', 'p2'])
      .lt('ends_at', new Date().toISOString())
      .order('ends_at', { ascending: false })
      .limit(1)
      .single()

    if (latestTournament) {
      setLatestFinalsTournament(latestTournament)
      const { data: finals } = await supabase
        .from('matches')
        .select(`
          *,
          tournament:tournaments(id, name, country, timezone, level),
          pair1_player1:players!matches_pair1_player1_id_fkey(id, name, country, external_id, ranking, avatar_url, side),
          pair1_player2:players!matches_pair1_player2_id_fkey(id, name, country, external_id, ranking, avatar_url, side),
          pair2_player1:players!matches_pair2_player1_id_fkey(id, name, country, external_id, ranking, avatar_url, side),
          pair2_player2:players!matches_pair2_player2_id_fkey(id, name, country, external_id, ranking, avatar_url, side),
          sets(*, games(*))
        `)
        .eq('tournament_id', latestTournament.id)
        .ilike('round', '%final%')
        .not('round', 'ilike', '%semi%')
        .not('round', 'ilike', '%quarter%')
        .in('status', ['finished', 'retired', 'walkover'])
        .order('category', { ascending: true })
      setLatestFinals((finals as any) ?? [])
    }

    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Read geo-country cookie set by middleware (Vercel x-vercel-ip-country)
  useEffect(() => {
    const match = document.cookie.match(/(?:^|; )geo-country=([A-Z]{2})/)
    if (match) setUserCountry(match[1])
  }, [])

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

  const trulyLive = liveMatches.filter(m => !isWarmingUp(m))
  const warmingUp = liveMatches.filter(m => isWarmingUp(m))
  const liveCount = trulyLive.length

  return (
    <div style={{ maxWidth: 500, margin: '0 auto', paddingBottom: 20 }}>

      {/* Header — logo left, search center, profile right */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 14px',
        borderBottom: '0.5px solid rgba(255,255,255,0.08)',
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

      {/* Live matches */}
      {liveCount > 0 ? (
        <CollapsibleSection title="Live Now" action={`See all ${liveCount} live`} href="/v2/matches">
          <div style={{ padding: '0 16px' }}>
            {(() => {
              const t = (trulyLive[0] as any)?.tournament
              return (
                <div style={{
                  borderRadius: 12, overflow: 'hidden',
                  border: '1px solid var(--border-card)',
                  background: 'var(--bg-card)',
                }}>
                  {/* Tournament header row */}
                  {t && (
                    <Link
                      href="/v2/matches"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '9px 12px',
                        background: 'linear-gradient(135deg, var(--bg-card) 0%, rgba(56,200,255,0.06) 100%)',
                        borderBottom: '1px solid var(--border-card)',
                        textDecoration: 'none', color: 'inherit',
                      }}
                    >
                      {t.country && (
                        <span style={{ fontSize: 16, lineHeight: 1 }}>{countryFlag(t.country)}</span>
                      )}
                      <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
                        {t.name}
                      </span>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                    </Link>
                  )}
                  {/* Matches inside the card — no outer border on MatchCard */}
                  <div style={{ padding: '4px 10px 6px' }}>
                    {trulyLive.slice(0, 6).map(m => (
                      <MatchCard key={m.id} match={m} viewerCount={0} expanded={false} onToggle={() => {}} embedded />
                    ))}
                  </div>
                </div>
              )
            })()}
          </div>
        </CollapsibleSection>
      ) : null}

      {/* Warming up + Scheduled — shown when no truly live matches, or warming up below live */}
      {warmingUp.length > 0 || (liveCount === 0 && scheduledMatches.length > 0) ? (
        <CollapsibleSection
          title={warmingUp.length > 0 ? 'Warming Up' : 'Coming Up'}
          action="All matches"
          href="/v2/matches"
        >
          <div style={{ padding: '0 16px' }}>
            {(() => {
              const allUpcoming = [...warmingUp, ...scheduledMatches]
              const t = (allUpcoming[0] as any)?.tournament
              return (
                <div style={{
                  borderRadius: 12, overflow: 'hidden',
                  border: '1px solid var(--border-card)',
                  background: 'var(--bg-card)',
                }}>
                  {t && (
                    <Link
                      href="/v2/matches"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '9px 12px',
                        background: 'linear-gradient(135deg, var(--bg-card) 0%, rgba(56,200,255,0.06) 100%)',
                        borderBottom: '1px solid var(--border-card)',
                        textDecoration: 'none', color: 'inherit',
                      }}
                    >
                      {t.country && (
                        <span style={{ fontSize: 16, lineHeight: 1 }}>{countryFlag(t.country)}</span>
                      )}
                      <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
                        {t.name}
                      </span>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                    </Link>
                  )}
                  <div style={{ padding: '4px 10px 6px' }}>
                    {allUpcoming.map(m => (
                      <MatchCard key={m.id} match={m} viewerCount={0} expanded={false} onToggle={() => {}} embedded />
                    ))}
                  </div>
                </div>
              )
            })()}
          </div>
        </CollapsibleSection>
      ) : liveCount === 0 ? (
        <>
          <div style={{ height: 12 }} />
          <LatestWinnersWidget matches={latestFinals} tournament={latestFinalsTournament} />
        </>
      ) : null}

      {/* Video Highlights — filtered by user's country */}
      {highlights.length > 0 && (
        <CollapsibleSection title="Highlights" action="See all" href="/v2/feed">
          <HighlightsCarousel highlights={highlights.filter(h => {
            if (!userCountry) return true // no geo info → show all
            if (h.allowed_countries && h.allowed_countries.length > 0) return h.allowed_countries.includes(userCountry)
            if (h.blocked_countries && h.blocked_countries.length > 0) return !h.blocked_countries.includes(userCountry)
            return true
          })} />
        </CollapsibleSection>
      )}

      {/* Latest News — compact ticker */}
      {latestNews.length > 0 && (
        <CollapsibleSection title="News" action="See all" href="/v2/feed?filter=news">
          <NewsTickerWidget items={latestNews} />
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

      {/* Search overlay */}
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  )
}

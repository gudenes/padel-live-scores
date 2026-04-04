'use client'
// src/app/v2/ranking/page.tsx
// FIP player rankings — Official & Race tabs, Men/Women toggle, search overlay

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { countryFlag } from '@/types/match'

// ── Country code → full name ───────────────────────────────────────────────

const COUNTRY_NAMES: Record<string, string> = {
  ES: 'Spain', AR: 'Argentina', BR: 'Brazil', PT: 'Portugal',
  FR: 'France', IT: 'Italy', BE: 'Belgium', NL: 'Netherlands',
  DE: 'Germany', GB: 'Great Britain', DK: 'Denmark', SE: 'Sweden',
  UY: 'Uruguay', PY: 'Paraguay', CL: 'Chile', MX: 'Mexico',
  US: 'United States', AU: 'Australia', QA: 'Qatar',
  ESP: 'Spain', ARG: 'Argentina', BRA: 'Brazil', POR: 'Portugal',
  FRA: 'France', ITA: 'Italy', BEL: 'Belgium', NLD: 'Netherlands',
  GER: 'Germany', GBR: 'Great Britain', DEN: 'Denmark', SWE: 'Sweden',
  URU: 'Uruguay', PAR: 'Paraguay', CHI: 'Chile', MEX: 'Mexico',
  USA: 'United States', AUS: 'Australia',
}

function countryName(code: string | null): string {
  if (!code) return 'Unknown'
  return COUNTRY_NAMES[code.toUpperCase()] ?? code
}

// ── Types ─────────────────────────────────────────────────────────────────

type RankType = 'official' | 'race'
type Gender   = 'men' | 'women'

interface Player {
  id: string
  name: string
  country: string | null
  ranking: number | null
  points: number | null
  ranking_move: number | null
  race_ranking: number | null
  race_points: number | null
  race_move: number | null
  avatar_url: string | null
  category: string | null
  updated_at: string | null
  ranking_date: string | null
}

// ── Sub-components ────────────────────────────────────────────────────────

function RankBadge({ rank }: { rank: number | null }) {
  if (!rank) return <span style={{ color: 'var(--text-faint)', fontSize: 14 }}>—</span>
  const medalColor = rank === 1 ? '#F59E0B' : rank === 2 ? '#94A3B8' : '#CD7F32'
  const isTop3 = rank <= 3
  return (
    <span style={{
      fontWeight: 700, fontSize: isTop3 ? 16 : 15,
      color: isTop3 ? medalColor : 'var(--color-accent)',
      display: 'block', textAlign: 'right',
    }}>
      {rank}
    </span>
  )
}

function DeltaChip({ delta }: { delta: number }) {
  if (delta === 0) return (
    <span style={{ fontSize: 9, color: 'var(--text-faint)', fontWeight: 600, lineHeight: 1 }}>—</span>
  )
  const up = delta > 0
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, lineHeight: 1,
      color: up ? '#34D399' : '#F87171',
      display: 'flex', alignItems: 'center', gap: 1,
    }}>
      {up ? '▲' : '▼'}{Math.abs(delta)}
    </span>
  )
}

function Avatar({ player, size = 40 }: { player: Player; size?: number }) {
  const [err, setErr] = useState(false)
  const initials = player.name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()
  const borderColor = player.category === 'women' ? 'var(--color-women-border)' : 'var(--color-men-border)'
  const textColor   = player.category === 'women' ? 'var(--color-women)'        : 'var(--color-men)'

  if (!player.avatar_url || err) {
    return (
      <div style={{
        width: size, height: size, borderRadius: '50%',
        background: 'var(--bg-card-alt)',
        border: `2px solid ${borderColor}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.32, fontWeight: 700, color: textColor, flexShrink: 0,
      }}>
        {initials}
      </div>
    )
  }

  return (
    <img
      src={player.avatar_url}
      alt={player.name}
      onError={() => setErr(true)}
      style={{
        width: size, height: size, borderRadius: '50%',
        objectFit: 'cover', flexShrink: 0,
        border: `2px solid ${borderColor}`,
      }}
    />
  )
}

function PlayerRow({ player, rankType, onClick }: { player: Player; rankType: RankType; onClick: () => void }) {
  const rank   = rankType === 'official' ? player.ranking      : player.race_ranking
  const pts    = rankType === 'official' ? player.points        : player.race_points
  const move   = rankType === 'official' ? (player.ranking_move ?? 0) : (player.race_move ?? 0)
  const isTop3 = (rank ?? 999) <= 3

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 16px', cursor: 'pointer',
        background: isTop3 ? 'rgba(245,158,11,0.04)' : 'transparent',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(56,200,255,0.05)')}
      onMouseLeave={e => (e.currentTarget.style.background = isTop3 ? 'rgba(245,158,11,0.04)' : 'transparent')}
    >
      {/* Rank + delta */}
      <div style={{ width: 36, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
        <RankBadge rank={rank} />
        <DeltaChip delta={move} />
      </div>

      <Avatar player={player} size={40} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontWeight: 600, fontSize: 14,
          color: 'var(--text-primary, #E2E8F0)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {player.name}
        </div>
        <div style={{
          fontSize: 12, color: 'var(--text-muted)', marginTop: 2,
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          {player.country ? (
            <><span>{countryFlag(player.country)}</span><span>{countryName(player.country)}</span></>
          ) : (
            <span style={{ color: 'var(--text-faint)' }}>Unknown</span>
          )}
        </div>
      </div>

      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-accent)' }}>
          {pts != null ? pts : '—'}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 2, fontWeight: 600, letterSpacing: '0.04em' }}>
          PTS
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function RankingPage() {
  const router = useRouter()
  const [rankType, setRankType] = useState<RankType>('official')
  const [gender, setGender]     = useState<Gender>('men')
  const [players, setPlayers]   = useState<Player[]>([])
  const [loading, setLoading]   = useState(true)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery]       = useState('')
  const [visibleCount, setVisibleCount] = useState(50)
  const inputRef                = useRef<HTMLInputElement>(null)
  const searchBoxRef            = useRef<HTMLDivElement>(null)

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setQuery('')
  }, [])

  // Close search on Escape or click outside
  useEffect(() => {
    if (!searchOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeSearch() }
    const onMouseDown = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) closeSearch()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onMouseDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [searchOpen, closeSearch])

  // ── Data fetching ──────────────────────────────────────────────────────

  const load = useCallback(async (rt: RankType, g: Gender) => {
    setLoading(true)
    try {
    const rankCol  = rt === 'official' ? 'ranking'  : 'race_ranking'
    const pointCol = rt === 'official' ? 'points'   : 'race_points'

    // Try with ranking_date column; fall back without it if column doesn't exist yet
    let { data, error } = await supabase
      .from('players')
      .select('id, name, country, ranking, points, ranking_move, race_ranking, race_points, race_move, avatar_url, category, updated_at, ranking_date')
      .eq('category', g)
      .not(rankCol, 'is', null)
      .order(rankCol, { ascending: true })
      .limit(1000)

    if (error) {
      const fallback = await supabase
        .from('players')
        .select('id, name, country, ranking, points, ranking_move, race_ranking, race_points, race_move, avatar_url, category, updated_at')
        .eq('category', g)
        .not(rankCol, 'is', null)
        .order(rankCol, { ascending: true })
        .limit(1000)
      data = fallback.data as typeof data
    }

    setPlayers(data ?? [])

    if (data && data.length > 0) {
      const latest = data.reduce((a, b) => ((a as any).ranking_date ?? a.updated_at ?? '') > ((b as any).ranking_date ?? b.updated_at ?? '') ? a : b)
      setUpdatedAt((latest as any).ranking_date ?? latest.updated_at)
    }

    } catch (e) {
      console.error('[Ranking] load error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(rankType, gender) }, [rankType, gender, load])

  // ── Search filter ──────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return players
    return players.filter(p =>
      p.name.toLowerCase().includes(q) ||
      countryName(p.country).toLowerCase().includes(q) ||
      (p.country ?? '').toLowerCase().includes(q)
    )
  }, [players, query])

  const formattedDate = updatedAt
    ? new Date(updatedAt).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })
    : null

  // ── Styles ─────────────────────────────────────────────────────────────

  const mainTabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '10px 0', border: 'none', cursor: 'pointer',
    fontWeight: 700, fontSize: 14, letterSpacing: '0.02em',
    transition: 'all 0.2s', fontFamily: 'inherit',
    background: 'transparent',
    color: active ? 'var(--color-accent)' : 'var(--text-faint)',
    borderBottom: `2px solid ${active ? 'var(--color-accent)' : 'transparent'}`,
  })

  return (
    <div style={{ maxWidth: 500, margin: '0 auto', paddingBottom: 20 }}>

      {/* Top nav bar — logo + search icon */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px',
        borderBottom: '0.5px solid rgba(255,255,255,0.06)',
        position: 'sticky', top: 0, zIndex: 10,
        background: 'var(--bg-base)',
        boxShadow: searchOpen ? '0 4px 20px rgba(0,0,0,0.4)' : 'none',
        transition: 'box-shadow 0.2s',
      }}>
        <div style={{ width: 36 }} />
        <img src="/padelnachos-logo-v2.png" alt="Padel Nachos" style={{ height: 28, width: 'auto', objectFit: 'contain' }} />
        <button
          onClick={() => { setSearchOpen(true); setTimeout(() => inputRef.current?.focus(), 50) }}
          style={{
            width: 36, height: 36, borderRadius: '50%', border: 'none', cursor: 'pointer',
            background: 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)', transition: 'all 0.15s',
          }}
          aria-label="Search players"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
        </button>
      </div>

      {/* Floating search overlay */}
      {searchOpen && (
        <div
          ref={searchBoxRef}
          style={{
            position: 'fixed', top: 56, left: '50%', transform: 'translateX(-50%)',
            width: 'calc(100% - 32px)', maxWidth: 468, zIndex: 50,
            background: 'var(--bg-card)',
            borderRadius: 14,
            border: '1px solid rgba(56,200,255,0.3)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            padding: '10px 14px',
            display: 'flex', alignItems: 'center', gap: 10,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2.5" strokeLinecap="round">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search by player or country…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              color: 'var(--text-primary, #E2E8F0)', fontSize: 15, fontFamily: 'inherit',
            }}
          />
          {query ? (
            <button onClick={() => setQuery('')} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: 20, lineHeight: 1, padding: 0 }}>×</button>
          ) : (
            <button onClick={closeSearch} style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', fontSize: 12, fontWeight: 600,
              fontFamily: 'inherit', padding: '2px 6px',
              borderRadius: 6, backgroundColor: 'var(--bg-card-alt)',
            }}>Cancel</button>
          )}
        </div>
      )}

      {/* Title row: "Ranking FIP" + updated date */}
      <div style={{ padding: '16px 16px 0' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary, #E2E8F0)', margin: 0 }}>
            Ranking FIP
          </h1>
          {formattedDate && (
            <span style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 500 }}>
              Updated {formattedDate}
            </span>
          )}
        </div>

        {/* Updated date + gender toggle on same line */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
          {/* Gender toggle — compact M/F slider */}
          <div
            onClick={() => { setGender(g => g === 'men' ? 'women' : 'men'); setQuery(''); setVisibleCount(50) }}
            style={{
              display: 'inline-flex', alignItems: 'center', cursor: 'pointer',
              background: 'var(--bg-card-alt)', borderRadius: 14,
              padding: 2, position: 'relative', width: 52, height: 26,
              border: `1px solid ${gender === 'women' ? 'rgba(244,114,182,0.3)' : 'rgba(255,255,255,0.08)'}`,
              transition: 'border-color 0.2s',
            }}
          >
            {/* Sliding pill */}
            <div style={{
              position: 'absolute', top: 2, left: gender === 'men' ? 2 : 26,
              width: 22, height: 22, borderRadius: 11,
              background: gender === 'women' ? 'var(--color-women)' : 'var(--color-accent)',
              transition: 'left 0.2s ease, background 0.2s ease',
            }} />
            <span style={{
              flex: 1, textAlign: 'center', fontSize: 11, fontWeight: 700,
              position: 'relative', zIndex: 1,
              color: gender === 'men' ? '#000' : 'var(--text-faint)',
              transition: 'color 0.2s',
            }}>M</span>
            <span style={{
              flex: 1, textAlign: 'center', fontSize: 11, fontWeight: 700,
              position: 'relative', zIndex: 1,
              color: gender === 'women' ? '#000' : 'var(--text-faint)',
              transition: 'color 0.2s',
            }}>F</span>
          </div>
        </div>
      </div>

      {/* Official / Race tabs — full-width underlined tabs */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        padding: '0 16px',
      }}>
        <button style={mainTabStyle(rankType === 'official')} onClick={() => { setRankType('official'); setQuery(''); setVisibleCount(50) }}>
          Official
        </button>
        <button style={mainTabStyle(rankType === 'race')} onClick={() => { setRankType('race'); setQuery(''); setVisibleCount(50) }}>
          Race
        </button>
      </div>

      {/* Column labels */}
      <div style={{
        display: 'flex', alignItems: 'center',
        padding: '6px 16px', gap: 12,
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <span style={{ width: 36, textAlign: 'right', fontSize: 10, color: 'var(--text-faint)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Rank</span>
        <span style={{ width: 40, flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: 10, color: 'var(--text-faint)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Player</span>
        <span style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Points</span>
      </div>

      {/* Player list */}
      {loading ? (
        <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 14 }}>
          Loading rankings…
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '60px 20px', textAlign: 'center' }}>
          <p style={{ fontSize: 32, marginBottom: 8 }}>{query ? '🔍' : '🏆'}</p>
          <p style={{ color: 'var(--text-muted)', fontWeight: 600, fontSize: 15 }}>
            {query ? `No results for "${query}"` : rankType === 'race' ? 'No race rankings yet' : 'No rankings yet'}
          </p>
          {!query && rankType === 'race' && (
            <p style={{ color: 'var(--text-faint)', fontSize: 13, marginTop: 6 }}>
              Run the FIP ranking sync to populate race data
            </p>
          )}
        </div>
      ) : (
        <>
          {(query ? filtered : filtered.slice(0, visibleCount)).map(player => (
            <PlayerRow
              key={player.id}
              player={player}
              rankType={rankType}
              onClick={() => router.push(`/player/${player.id}`)}
            />
          ))}

          {/* Load more button — hidden when searching or all shown */}
          {!query && visibleCount < filtered.length && (
            <div style={{ padding: '16px', textAlign: 'center' }}>
              <button
                onClick={() => setVisibleCount(v => v + 50)}
                style={{
                  background: 'var(--bg-card-alt)',
                  border: '1px solid rgba(56,200,255,0.2)',
                  borderRadius: 10, padding: '10px 24px',
                  color: 'var(--color-accent)', fontWeight: 700,
                  fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'all 0.15s',
                }}
              >
                Load more ({filtered.length - visibleCount} remaining)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

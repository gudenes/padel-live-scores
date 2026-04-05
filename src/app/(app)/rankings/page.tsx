'use client'
// src/app/(app)/rankings/page.tsx
// V3 Rankings — FIP Official & Race rankings with chunky brand styling.

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import FollowButton from '@/components/FollowButton'

// ── Brand colors ───────────────────────────────────────────────
const GREEN = '#7ED321'
const GREEN_DIM = 'rgba(126,211,33,0.15)'
const ORANGE = '#F5A623'
const BG_BASE = '#1A1A1A'
const BG_CARD = '#141414'
const MUTED = '#6B7280'
const BORDER = 'rgba(255,255,255,0.06)'
const MEN_BLUE = '#4A9EFF'
const WOMEN_PURPLE = '#D966FF'

// ── Chunky clip-path presets ───────────────────────────────────
const CHUNKY = {
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
  card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
  button: 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)',
}

// ── Country code → full name ───────────────────────────────────
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

// ISO-2 mapping for flagcdn (3-letter codes → 2-letter)
const ISO3_TO_2: Record<string, string> = {
  ESP: 'es', ARG: 'ar', BRA: 'br', POR: 'pt', FRA: 'fr', ITA: 'it',
  BEL: 'be', NLD: 'nl', GER: 'de', GBR: 'gb', DEN: 'dk', SWE: 'se',
  URU: 'uy', PAR: 'py', CHI: 'cl', MEX: 'mx', USA: 'us', AUS: 'au',
}

function countryName(code: string | null): string {
  if (!code) return 'Unknown'
  return COUNTRY_NAMES[code.toUpperCase()] ?? code
}

function countryFlagUrl(code: string | null): string | null {
  if (!code) return null
  const upper = code.toUpperCase()
  const iso2 = ISO3_TO_2[upper] ?? (upper.length === 2 ? upper.toLowerCase() : null)
  if (!iso2) return null
  return `https://flagcdn.com/w40/${iso2}.png`
}

// ── Types ─────────────────────────────────────────────────────
type RankType = 'official' | 'race'
type Gender = 'men' | 'women'

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

// ── Sub-components ────────────────────────────────────────────

function RankBadge({ rank }: { rank: number | null }) {
  if (!rank) return <span style={{ color: MUTED, fontSize: 14 }}>--</span>
  const isTop3 = rank <= 3
  const color = rank === 1 ? '#F5A623' : rank === 2 ? '#94A3B8' : rank === 3 ? '#CD7F32' : GREEN
  return (
    <span style={{
      fontWeight: 800, fontSize: isTop3 ? 17 : 15,
      color,
      display: 'block', textAlign: 'right',
      fontVariantNumeric: 'tabular-nums',
    }}>
      {rank}
    </span>
  )
}

function DeltaChip({ delta }: { delta: number }) {
  if (delta === 0) return (
    <span style={{ fontSize: 9, color: MUTED, fontWeight: 600, lineHeight: 1 }}>--</span>
  )
  const up = delta > 0
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, lineHeight: 1,
      color: up ? GREEN : '#FF4655',
      display: 'flex', alignItems: 'center', gap: 1,
    }}>
      {up ? '\u25B2' : '\u25BC'}{Math.abs(delta)}
    </span>
  )
}

function Avatar({ player, size = 40 }: { player: Player; size?: number }) {
  const [err, setErr] = useState(false)
  const initials = player.name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()
  const accent = player.category === 'women' ? WOMEN_PURPLE : MEN_BLUE

  if (!player.avatar_url || err) {
    return (
      <div style={{
        width: size, height: size, borderRadius: '50%',
        background: BG_CARD,
        border: `2px solid ${accent}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.32, fontWeight: 700, color: accent, flexShrink: 0,
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
        border: `2px solid ${accent}`,
      }}
    />
  )
}

function PlayerRow({ player, rankType, onClick }: { player: Player; rankType: RankType; onClick: () => void }) {
  const rank = rankType === 'official' ? player.ranking : player.race_ranking
  const pts = rankType === 'official' ? player.points : player.race_points
  const move = rankType === 'official' ? (player.ranking_move ?? 0) : (player.race_move ?? 0)
  const isTop3 = (rank ?? 999) <= 3
  const flagUrl = countryFlagUrl(player.country)

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 16px', cursor: 'pointer',
        background: isTop3 ? 'rgba(245,166,35,0.04)' : 'transparent',
        borderBottom: `1px solid ${BORDER}`,
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = GREEN_DIM)}
      onMouseLeave={e => (e.currentTarget.style.background = isTop3 ? 'rgba(245,166,35,0.04)' : 'transparent')}
    >
      {/* Rank + delta */}
      <div style={{ width: 36, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
        <RankBadge rank={rank} />
        <DeltaChip delta={move} />
      </div>

      <Avatar player={player} size={40} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontWeight: 700, fontSize: 14,
          color: '#E2E8F0',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {player.name}
        </div>
        <div style={{
          fontSize: 12, color: MUTED, marginTop: 2,
          display: 'flex', alignItems: 'center', gap: 5,
        }}>
          {flagUrl ? (
            <>
              <img
                src={flagUrl}
                alt={player.country ?? ''}
                style={{ width: 16, height: 12, objectFit: 'cover' }}
              />
              <span>{countryName(player.country)}</span>
            </>
          ) : (
            <span style={{ color: MUTED }}>Unknown</span>
          )}
        </div>
      </div>

      <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 14, color: GREEN, fontVariantNumeric: 'tabular-nums' }}>
            {pts != null ? pts : '--'}
          </div>
          <div style={{ fontSize: 9, color: MUTED, marginTop: 2, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            PTS
          </div>
        </div>
        <FollowButton type="player" targetId={player.id} variant="heart" size={14} style={{ marginLeft: 8 }} />
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────

export default function V3RankingPage() {
  const router = useRouter()
  const [rankType, setRankType] = useState<RankType>('official')
  const [gender, setGender] = useState<Gender>('men')
  const [players, setPlayers] = useState<Player[]>([])
  const [loading, setLoading] = useState(true)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [visibleCount, setVisibleCount] = useState(50)
  const inputRef = useRef<HTMLInputElement>(null)
  const searchBoxRef = useRef<HTMLDivElement>(null)

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

  // ── Data fetching ──────────────────────────────────────────
  const load = useCallback(async (rt: RankType, g: Gender) => {
    setLoading(true)
    try {
      const rankCol = rt === 'official' ? 'ranking' : 'race_ranking'

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
        const latest = data.reduce((a, b) =>
          ((a as any).ranking_date ?? a.updated_at ?? '') > ((b as any).ranking_date ?? b.updated_at ?? '') ? a : b
        )
        setUpdatedAt((latest as any).ranking_date ?? latest.updated_at)
      }
    } catch (e) {
      console.error('[V3 Ranking] load error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(rankType, gender) }, [rankType, gender, load])

  // ── Search filter ──────────────────────────────────────────
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

  // ── Gender accent ──────────────────────────────────────────
  const genderAccent = gender === 'women' ? WOMEN_PURPLE : MEN_BLUE

  return (
    <div style={{ maxWidth: 500, margin: '0 auto', background: BG_BASE, minHeight: '100vh' }}>

      {/* ── Sticky header ─────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px',
        borderBottom: 'none', boxShadow: '0 1px 8px rgba(0,0,0,0.5)',
        position: 'sticky', top: 0, zIndex: 20,
        background: '#0A0A0A',
        height: 62,
      }}>
        <button
          onClick={() => router.push('/home')}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: '#E2E8F0', padding: 4, display: 'flex', alignItems: 'center',
          }}
          aria-label="Back"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" /><polyline points="12 19 5 12 12 5" />
          </svg>
        </button>

        <h1 style={{ fontSize: 17, fontWeight: 800, color: '#E2E8F0', margin: 0, letterSpacing: '-0.01em' }}>
          Rankings
        </h1>

        <button
          onClick={() => { setSearchOpen(true); setTimeout(() => inputRef.current?.focus(), 50) }}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: MUTED, padding: 4, display: 'flex', alignItems: 'center',
          }}
          aria-label="Search players"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
        </button>
      </div>

      {/* ── Floating search overlay ───────────────────────── */}
      {searchOpen && (
        <div
          ref={searchBoxRef}
          style={{
            position: 'fixed', top: 56, left: '50%', transform: 'translateX(-50%)',
            width: 'calc(100% - 32px)', maxWidth: 468, zIndex: 50,
            background: BG_CARD,
            clipPath: CHUNKY.card,
            border: `1px solid rgba(126,211,33,0.3)`,
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            padding: '12px 16px',
            display: 'flex', alignItems: 'center', gap: 10,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search by player or country..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              color: '#E2E8F0', fontSize: 15, fontFamily: 'inherit',
            }}
          />
          {query ? (
            <button onClick={() => setQuery('')} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: MUTED, fontSize: 20, lineHeight: 1, padding: 0 }}>\u00D7</button>
          ) : (
            <button onClick={closeSearch} style={{
              background: 'rgba(255,255,255,0.06)', border: 'none', cursor: 'pointer',
              color: MUTED, fontSize: 11, fontWeight: 700,
              fontFamily: 'inherit', padding: '4px 10px',
              clipPath: CHUNKY.badge,
              textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>ESC</button>
          )}
        </div>
      )}

      {/* ── Gender toggle + updated date ──────────────────── */}
      <div style={{ padding: '14px 16px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {/* Gender pill toggle */}
          <div style={{ display: 'flex', gap: 6 }}>
            {(['men', 'women'] as Gender[]).map(g => {
              const active = gender === g
              const accent = g === 'women' ? WOMEN_PURPLE : MEN_BLUE
              return (
                <button
                  key={g}
                  onClick={() => { setGender(g); setQuery(''); setVisibleCount(50) }}
                  style={{
                    padding: '6px 18px',
                    border: 'none', cursor: 'pointer',
                    fontFamily: 'inherit', fontWeight: 800, fontSize: 12,
                    letterSpacing: '0.04em', textTransform: 'uppercase',
                    clipPath: CHUNKY.button,
                    background: active ? accent : 'rgba(255,255,255,0.05)',
                    color: active ? '#000' : MUTED,
                    transition: 'all 0.2s',
                  }}
                >
                  {g === 'men' ? 'Men' : 'Women'}
                </button>
              )
            })}
          </div>

          {formattedDate && (
            <span style={{ fontSize: 10, color: MUTED, fontWeight: 500 }}>
              {formattedDate}
            </span>
          )}
        </div>
      </div>

      {/* ── Official / Race tabs ──────────────────────────── */}
      <div style={{
        display: 'flex', gap: 0,
        margin: '12px 16px 0',
        borderBottom: `1px solid ${BORDER}`,
      }}>
        {(['official', 'race'] as RankType[]).map(rt => {
          const active = rankType === rt
          return (
            <button
              key={rt}
              onClick={() => { setRankType(rt); setQuery(''); setVisibleCount(50) }}
              style={{
                flex: 1, padding: '10px 0', border: 'none', cursor: 'pointer',
                fontWeight: 800, fontSize: 13, letterSpacing: '0.04em',
                textTransform: 'uppercase', fontFamily: 'inherit',
                background: 'transparent',
                color: active ? GREEN : MUTED,
                borderBottom: `2px solid ${active ? GREEN : 'transparent'}`,
                transition: 'all 0.2s',
              }}
            >
              {rt === 'official' ? 'Official' : 'Race'}
            </button>
          )
        })}
      </div>

      {/* ── Column labels ─────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center',
        padding: '8px 16px', gap: 12,
        borderBottom: `1px solid ${BORDER}`,
      }}>
        <span style={{ width: 36, textAlign: 'right', fontSize: 9, color: MUTED, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Rank</span>
        <span style={{ width: 40, flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: 9, color: MUTED, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Player</span>
        <span style={{ fontSize: 9, color: MUTED, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Points</span>
      </div>

      {/* ── Player list ───────────────────────────────────── */}
      {loading ? (
        <div style={{ padding: '80px 20px', textAlign: 'center' }}>
          <div style={{
            width: 32, height: 32, margin: '0 auto 16px',
            border: `3px solid ${BORDER}`,
            borderTopColor: GREEN,
            borderRadius: '50%',
            animation: 'v3-rank-spin 0.8s linear infinite',
          }} />
          <div style={{ color: MUTED, fontSize: 13, fontWeight: 600 }}>Loading rankings...</div>
          <style dangerouslySetInnerHTML={{ __html: `@keyframes v3-rank-spin { to { transform: rotate(360deg); } }` }} />
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '80px 20px', textAlign: 'center' }}>
          <div style={{
            display: 'inline-block',
            background: GREEN_DIM,
            clipPath: CHUNKY.badge,
            padding: '12px 20px',
            marginBottom: 16,
          }}>
            <span style={{ fontSize: 28 }}>{query ? '\uD83D\uDD0D' : '\uD83C\uDFC6'}</span>
          </div>
          <p style={{ color: '#E2E8F0', fontWeight: 700, fontSize: 15, margin: '0 0 6px' }}>
            {query ? `No results for "${query}"` : rankType === 'race' ? 'No race rankings yet' : 'No rankings yet'}
          </p>
          {!query && rankType === 'race' && (
            <p style={{ color: MUTED, fontSize: 12, margin: 0 }}>
              Race data will appear once the FIP ranking sync runs.
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

          {/* Load more button */}
          {!query && visibleCount < filtered.length && (
            <div style={{ padding: '20px 16px', textAlign: 'center' }}>
              <button
                onClick={() => setVisibleCount(v => v + 50)}
                style={{
                  background: GREEN_DIM,
                  border: `1px solid rgba(126,211,33,0.25)`,
                  clipPath: CHUNKY.button,
                  padding: '11px 28px',
                  color: GREEN, fontWeight: 800,
                  fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                  letterSpacing: '0.04em', textTransform: 'uppercase',
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

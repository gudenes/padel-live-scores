'use client'

import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { countryFlag } from '@/types/match'
import Link from 'next/link'

function formatDateRange(start: string, end: string): string {
  const s = new Date(start), e = new Date(end)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  if (s.getMonth() === e.getMonth()) return `${s.toLocaleDateString('en-US', opts)}–${e.getDate()}`
  return `${s.toLocaleDateString('en-US', opts)} – ${e.toLocaleDateString('en-US', opts)}`
}

function levelLabel(level: string | null): string {
  if (!level) return ''
  const map: Record<string, string> = { premier: 'Premier Padel', p1: 'P1', p2: 'P2', major: 'Major', fip_rise: 'FIP Rise', fip_star: 'FIP Star' }
  return map[level] ?? level
}

interface SearchResult {
  type: 'player' | 'tournament' | 'match'
  id: string
  title: string
  subtitle: string | null
  icon: string | null
  imageUrl: string | null
  href: string
  badge?: string | null
}

export default function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [popular, setPopular] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setResults([])
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  useEffect(() => {
    if (!open || popular.length > 0) return
    ;(async () => {
      const [playersRes, tournamentsRes, moversRes] = await Promise.all([
        supabase
          .from('players')
          .select('id, name, country, ranking, category, avatar_url')
          .not('ranking', 'is', null)
          .order('ranking', { ascending: true })
          .limit(6),
        supabase
          .from('tournaments')
          .select('id, name, country, level, starts_at, ends_at')
          .gte('ends_at', new Date(Date.now() - 14 * 86400000).toISOString())
          .order('starts_at', { ascending: false })
          .limit(3),
        supabase
          .from('players')
          .select('id, name, country, ranking, category, avatar_url, ranking_move')
          .not('ranking_move', 'is', null)
          .gt('ranking_move', 0)
          .lte('ranking', 50)
          .order('ranking_move', { ascending: false })
          .limit(3),
      ])

      const items: SearchResult[] = []
      for (const p of (playersRes.data ?? []) as any[]) {
        items.push({
          type: 'player', id: p.id,
          title: p.name,
          subtitle: `#${p.ranking} ${p.category === 'men' ? 'Men' : 'Women'}`,
          icon: null,
          imageUrl: p.avatar_url ?? null,
          href: `/player/${p.id}`,
        })
      }
      for (const t of (tournamentsRes.data ?? []) as any[]) {
        const dateStr = t.starts_at && t.ends_at ? ` · ${formatDateRange(t.starts_at, t.ends_at)}` : ''
        items.push({
          type: 'tournament', id: t.id,
          title: t.name,
          subtitle: `${levelLabel(t.level)}${dateStr}`,
          icon: t.country ? countryFlag(t.country) : null,
          imageUrl: null,
          href: '/v2/matches',
        })
      }
      const topIds = new Set(items.filter(i => i.type === 'player').map(i => i.id))
      for (const p of (moversRes.data ?? []) as any[]) {
        if (topIds.has(p.id)) continue
        items.push({
          type: 'player', id: p.id,
          title: p.name,
          subtitle: `#${p.ranking} ${p.category === 'men' ? 'Men' : 'Women'}`,
          icon: null,
          imageUrl: p.avatar_url ?? null,
          href: `/player/${p.id}`,
          badge: `↑${p.ranking_move}`,
        })
      }
      setPopular(items)
    })()
  }, [open, popular.length])

  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      const q = `%${query.trim()}%`
      const [playersRes, tournamentsRes, matchesRes] = await Promise.all([
        supabase
          .from('players')
          .select('id, name, country, ranking, category, avatar_url')
          .ilike('name', q)
          .order('ranking', { ascending: true, nullsFirst: false })
          .limit(5),
        supabase
          .from('tournaments')
          .select('id, name, country, level, starts_at, ends_at')
          .ilike('name', q)
          .order('starts_at', { ascending: false })
          .limit(3),
        supabase
          .from('matches')
          .select(`
            id,
            pair1_player1:players!matches_pair1_player1_id_fkey(name),
            pair1_player2:players!matches_pair1_player2_id_fkey(name),
            pair2_player1:players!matches_pair2_player1_id_fkey(name),
            pair2_player2:players!matches_pair2_player2_id_fkey(name),
            tournament:tournaments(name),
            round, status
          `)
          .or(`pair1_player1.name.ilike.${q},pair1_player2.name.ilike.${q},pair2_player1.name.ilike.${q},pair2_player2.name.ilike.${q}`)
          .order('scheduled_at', { ascending: false })
          .limit(4),
      ])

      const items: SearchResult[] = []
      for (const p of (playersRes.data ?? []) as any[]) {
        items.push({
          type: 'player', id: p.id,
          title: p.name,
          subtitle: p.ranking ? `#${p.ranking} ${p.category === 'men' ? 'Men' : 'Women'}` : p.category === 'men' ? 'Men' : 'Women',
          icon: null,
          imageUrl: p.avatar_url ?? null,
          href: `/player/${p.id}`,
        })
      }
      for (const t of (tournamentsRes.data ?? []) as any[]) {
        const dateStr = t.starts_at && t.ends_at ? ` · ${formatDateRange(t.starts_at, t.ends_at)}` : ''
        items.push({
          type: 'tournament', id: t.id,
          title: t.name,
          subtitle: `${levelLabel(t.level)}${dateStr}`,
          icon: t.country ? countryFlag(t.country) : null,
          imageUrl: null,
          href: '/v2/matches',
        })
      }
      for (const m of (matchesRes.data ?? []) as any[]) {
        const p1 = [m.pair1_player1?.name, m.pair1_player2?.name].filter(Boolean).join(' / ')
        const p2 = [m.pair2_player1?.name, m.pair2_player2?.name].filter(Boolean).join(' / ')
        items.push({
          type: 'match', id: m.id,
          title: `${p1} vs ${p2}`,
          subtitle: [m.tournament?.name, m.round, m.status].filter(Boolean).join(' · '),
          icon: null,
          imageUrl: null,
          href: `/match/${m.id}`,
        })
      }
      setResults(items)
      setSearching(false)
    }, 250)
  }, [query])

  if (!open) return null

  const display = query.trim() ? results : popular
  const groupedDisplay = {
    player: display.filter(r => r.type === 'player'),
    tournament: display.filter(r => r.type === 'tournament'),
    match: display.filter(r => r.type === 'match'),
  }
  const typeLabels = { player: 'Players', tournament: 'Tournaments', match: 'Matches' }
  const typeIcons = { player: '👤', tournament: '🏆', match: '🎾' }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 500,
          background: 'var(--bg-base)',
          borderRadius: '0 0 16px 16px',
          maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Search input */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 14px',
          borderBottom: '1px solid var(--border-card)',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search players, tournaments, matches..."
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text-primary)', fontSize: 15, fontFamily: 'inherit',
              fontWeight: 500,
            }}
          />
          <button
            onClick={onClose}
            style={{
              background: 'var(--bg-card-alt)', border: 'none', borderRadius: 6,
              padding: '4px 10px', fontSize: 11, fontWeight: 700,
              color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Cancel
          </button>
        </div>

        {/* Results */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {!query.trim() && popular.length > 0 && (
            <div style={{ padding: '4px 16px 8px', fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Popular
            </div>
          )}
          {searching && (
            <div style={{ padding: '20px 16px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
              Searching...
            </div>
          )}
          {query.trim() && !searching && results.length === 0 && (
            <div style={{ padding: '20px 16px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
              No results for &quot;{query}&quot;
            </div>
          )}
          {(['player', 'tournament', 'match'] as const).map(type => {
            const items = groupedDisplay[type]
            if (items.length === 0) return null
            return (
              <div key={type}>
                {query.trim() && (
                  <div style={{ padding: '8px 16px 4px', fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {typeIcons[type]} {typeLabels[type]}
                  </div>
                )}
                {items.map(item => (
                  <Link
                    key={`${type}-${item.id}`}
                    href={item.href}
                    onClick={onClose}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 16px', textDecoration: 'none', color: 'inherit',
                    }}
                  >
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.title}
                        style={{
                          width: 32, height: 32, borderRadius: '50%',
                          objectFit: 'cover', flexShrink: 0,
                          background: 'var(--bg-card-alt)',
                        }}
                      />
                    ) : item.icon ? (
                      <span style={{ fontSize: 18, width: 32, textAlign: 'center', flexShrink: 0 }}>{item.icon}</span>
                    ) : (
                      <span style={{
                        fontSize: 12, width: 32, height: 32, borderRadius: '50%',
                        background: 'var(--bg-card-alt)', display: 'flex',
                        alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        color: 'var(--text-muted)',
                      }}>
                        {typeIcons[type]}
                      </span>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {item.title}
                      </div>
                      {item.subtitle && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                          {item.subtitle}
                        </div>
                      )}
                    </div>
                    {item.badge && (
                      <span style={{
                        fontSize: 11, fontWeight: 700, color: '#22c55e',
                        background: 'rgba(34,197,94,0.12)', borderRadius: 6,
                        padding: '2px 6px', flexShrink: 0,
                      }}>
                        {item.badge}
                      </span>
                    )}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2" strokeLinecap="round">
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                  </Link>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

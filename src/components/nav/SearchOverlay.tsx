'use client'
// src/components/nav/SearchOverlay.tsx
// V3 Search overlay — full rewrite with PadelNachos brand language.
// Functionality preserved: player/tournament/match search, debounced queries,
// recent searches in localStorage, popular section.

import { useEffect, useState, useRef } from 'react'
import Avatar from '@/components/Avatar'
import { useFormatter, useTranslations } from 'next-intl'
import { supabase } from '@/lib/supabase'
import { Link } from '@/i18n/navigation'
import { DATE_SHORT } from '@/lib/format-patterns'
import { FlagImage } from '@/components/FlagImage'
import { levelLabel } from '@/lib/tournament-labels'

// ── Brand constants ───────────────────────────────────────────
const GREEN = '#7ED321'
const ORANGE = '#F5A623'
const LIVE_RED = '#FF4655'
const BG_BASE = '#1A1A1A'
const BG_CARD = '#141414'
const MUTED = '#6B7280'
const BORDER = 'rgba(255,255,255,0.06)'

const CLIP = {
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
  card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
  button: 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)',
}

// ── Helpers ───────────────────────────────────────────────────

function formatDateRange(format: ReturnType<typeof useFormatter>, start: string, end: string): string {
  const s = new Date(start), e = new Date(end)
  if (s.getMonth() === e.getMonth()) return `${format.dateTime(s, DATE_SHORT)}–${e.getDate()}`
  return `${format.dateTime(s, DATE_SHORT)} – ${format.dateTime(e, DATE_SHORT)}`
}

// levelLabel imported at the top from @/lib/tournament-labels (the
// canonical map). The local copy that used to live here was a tiny
// subset — Premier / P1 / P2 / Major / FIP Rise / FIP Star — and let
// every other tier fall through to the raw key.

// ── Types ─────────────────────────────────────────────────────

interface SearchResult {
  type: 'player' | 'tournament' | 'match'
  id: string
  title: string
  subtitle: string | null
  country: string | null
  imageUrl: string | null
  href: string
  badge?: string | null
  matchLetter?: string   // W, L, —, LIVE, F for matches
}

// ── LocalStorage recents ──────────────────────────────────────

const RECENTS_KEY = 'padel-search-recents'
const MAX_RECENTS = 6

function loadRecents(): SearchResult[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveRecent(item: SearchResult) {
  const recents = loadRecents().filter(r => !(r.type === item.type && r.id === item.id))
  recents.unshift({ ...item, badge: undefined })
  if (recents.length > MAX_RECENTS) recents.length = MAX_RECENTS
  localStorage.setItem(RECENTS_KEY, JSON.stringify(recents))
}

function clearRecents() {
  localStorage.removeItem(RECENTS_KEY)
}

// ── Type styling ──────────────────────────────────────────────
//
// Type-meta `label` strings are translated at the call site via
// `tSearch('type<Players|Tournaments|Matches>')` rather than baked
// into this map (the map can't `useTranslations`). The single-letter
// glyphs and colours stay here.

const TYPE_META: Record<string, { letter: string; bg: string; fg: string }> = {
  player:     { letter: 'P', bg: 'rgba(126,211,33,0.12)', fg: GREEN },
  tournament: { letter: 'T', bg: 'rgba(245,166,35,0.12)', fg: ORANGE },
  match:      { letter: 'M', bg: 'rgba(255,70,85,0.12)',  fg: LIVE_RED },
}

const TYPE_LABEL_KEYS: Record<string, 'typePlayers' | 'typeTournaments' | 'typeMatches'> = {
  player: 'typePlayers',
  tournament: 'typeTournaments',
  match: 'typeMatches',
}

// ── Component ─────────────────────────────────────────────────

export default function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const format = useFormatter()
  const tSearch = useTranslations('nav.search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [popular, setPopular] = useState<SearchResult[]>([])
  const [recents, setRecents] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset state when opened
  useEffect(() => {
    if (open) {
      setQuery('')
      setResults([])
      setRecents(loadRecents())
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  // Load popular items (top players, recent tournaments, biggest movers)
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
          subtitle: `#${p.ranking} ${p.category === 'men' ? tSearch('categoryMen') : tSearch('categoryWomen')}`,
          country: p.country ?? null,
          imageUrl: p.avatar_url ?? null,
          href: `/player/${p.id}`,
        })
      }
      for (const t of (tournamentsRes.data ?? []) as any[]) {
        const dateStr = t.starts_at && t.ends_at ? ` · ${formatDateRange(format, t.starts_at, t.ends_at)}` : ''
        items.push({
          type: 'tournament', id: t.id,
          title: t.name,
          subtitle: `${levelLabel(t.level)}${dateStr}`,
          country: t.country ?? null,
          imageUrl: null,
          href: `/tournaments/${t.id}`,
        })
      }
      const topIds = new Set(items.filter(i => i.type === 'player').map(i => i.id))
      for (const p of (moversRes.data ?? []) as any[]) {
        if (topIds.has(p.id)) continue
        items.push({
          type: 'player', id: p.id,
          title: p.name,
          subtitle: `#${p.ranking} ${p.category === 'men' ? tSearch('categoryMen') : tSearch('categoryWomen')}`,
          country: p.country ?? null,
          imageUrl: p.avatar_url ?? null,
          href: `/player/${p.id}`,
          badge: `+${p.ranking_move}`,
        })
      }
      setPopular(items)
    })()
  }, [open, popular.length])

  // Debounced search
  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      const q = `%${query.trim()}%`
      const [playersRes, tournamentsRes] = await Promise.all([
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
      ])

      // Find matches by player IDs from the player search results
      const playerIds = (playersRes.data ?? []).map((p: any) => p.id)
      let matchesRes: { data: any[] | null } = { data: [] }
      if (playerIds.length > 0) {
        matchesRes = await supabase
          .from('matches')
          .select(`
            id, started_at, scheduled_at, winner_pair,
            pair1_player1:players!matches_pair1_player1_id_fkey(id, name, display_name),
            pair1_player2:players!matches_pair1_player2_id_fkey(id, name, display_name),
            pair2_player1:players!matches_pair2_player1_id_fkey(id, name, display_name),
            pair2_player2:players!matches_pair2_player2_id_fkey(id, name, display_name),
            tournament:tournaments(name),
            round, status
          `)
          .or(playerIds.map((id: string) => `pair1_player1_id.eq.${id},pair1_player2_id.eq.${id},pair2_player1_id.eq.${id},pair2_player2_id.eq.${id}`).join(','))
          .in('status', ['live', 'finished', 'scheduled'])
          .order('scheduled_at', { ascending: false, nullsFirst: false })
          .limit(6)
      }

      const items: SearchResult[] = []
      for (const p of (playersRes.data ?? []) as any[]) {
        items.push({
          type: 'player', id: p.id,
          title: p.name,
          subtitle: p.ranking ? `#${p.ranking} ${p.category === 'men' ? tSearch('categoryMen') : tSearch('categoryWomen')}` : p.category === 'men' ? tSearch('categoryMen') : tSearch('categoryWomen'),
          country: p.country ?? null,
          imageUrl: p.avatar_url ?? null,
          href: `/player/${p.id}`,
        })
      }
      for (const t of (tournamentsRes.data ?? []) as any[]) {
        const dateStr = t.starts_at && t.ends_at ? ` · ${formatDateRange(format, t.starts_at, t.ends_at)}` : ''
        items.push({
          type: 'tournament', id: t.id,
          title: t.name,
          subtitle: `${levelLabel(t.level)}${dateStr}`,
          country: t.country ?? null,
          imageUrl: null,
          href: `/tournaments/${t.id}`,
        })
      }
      // Sort: live first, then by date descending (already from query)
      const matchData = [...(matchesRes.data ?? [])].sort((a: any, b: any) => {
        if (a.status === 'live' && b.status !== 'live') return -1
        if (b.status === 'live' && a.status !== 'live') return 1
        return 0
      })
      for (const m of matchData as any[]) {
        const p1 = [m.pair1_player1?.name, m.pair1_player2?.name].filter(Boolean).join(' / ')
        const p2 = [m.pair2_player1?.name, m.pair2_player2?.name].filter(Boolean).join(' / ')
        const matchDate = m.started_at ?? m.scheduled_at
        const date = matchDate ? format.dateTime(new Date(matchDate), DATE_SHORT) : ''

        // Determine W/L from the searched player's perspective.
        // Check which pair the searched player(s) belong to, then
        // compare against winner_pair.
        let matchLetter = '—'
        if (m.status === 'live') {
          matchLetter = 'LIVE'
        } else if (m.status === 'finished' && m.winner_pair) {
          const p1Ids = [m.pair1_player1?.id, m.pair1_player2?.id].filter(Boolean)
          const p2Ids = [m.pair2_player1?.id, m.pair2_player2?.id].filter(Boolean)
          const searchedInPair1 = p1Ids.some((id: string) => playerIds.includes(id))
          const searchedInPair2 = p2Ids.some((id: string) => playerIds.includes(id))
          if (searchedInPair1 && !searchedInPair2) {
            matchLetter = m.winner_pair === 1 ? 'W' : 'L'
          } else if (searchedInPair2 && !searchedInPair1) {
            matchLetter = m.winner_pair === 2 ? 'W' : 'L'
          } else {
            // Both pairs contain searched players (e.g. searching a common name) — just show finished
            matchLetter = 'F'
          }
        }

        const statusLabel = m.status === 'live' ? 'LIVE' : m.status === 'finished' ? 'Finished' : 'Scheduled'
        items.push({
          type: 'match', id: m.id,
          title: `${p1} vs ${p2}`,
          subtitle: [m.tournament?.name, m.round, date, statusLabel].filter(Boolean).join(' · '),
          country: null,
          imageUrl: null,
          href: `/match/${m.id}`,
          badge: m.status === 'live' ? 'LIVE' : null,
          matchLetter,
        })
      }
      setResults(items)
      setSearching(false)
    }, 250)
  }, [query])

  const handleResultClick = (item: SearchResult) => {
    saveRecent(item)
    onClose()
  }

  const handleClearRecents = () => {
    clearRecents()
    setRecents([])
  }

  if (!open) return null

  const display = query.trim() ? results : popular
  const grouped = {
    player: display.filter(r => r.type === 'player'),
    tournament: display.filter(r => r.type === 'tournament'),
    match: display.filter(r => r.type === 'match'),
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.88)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 500,
          background: BG_BASE,
          clipPath: 'polygon(0% 0%, 100% 0%, 100% 99%, 0.5% 100%)',
          maxHeight: '82vh',
          display: 'flex', flexDirection: 'column',
          borderBottom: `2px solid ${GREEN}`,
        }}
      >
        {/* ── Search input bar ──────────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 16px',
          borderBottom: `1px solid ${BORDER}`,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={tSearch('placeholder')}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: '#fff', fontSize: 15, fontFamily: 'inherit', fontWeight: 500,
            }}
          />
          <button
            onClick={onClose}
            aria-label={tSearch('closeAria')}
            style={{
              background: BG_CARD, border: `1px solid ${BORDER}`,
              clipPath: CLIP.button,
              width: 32, height: 32,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 20, fontWeight: 600, lineHeight: 1,
              color: MUTED, cursor: 'pointer', fontFamily: 'inherit',
              padding: 0,
            }}
          >
            ×
          </button>
        </div>

        {/* ── Scrollable results area ──────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>

          {/* Recent searches */}
          {!query.trim() && recents.length > 0 && (
            <>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '6px 16px 8px',
              }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, color: ORANGE,
                  textTransform: 'uppercase', letterSpacing: '0.8px',
                }}>
                  Recent
                </span>
                <button
                  onClick={handleClearRecents}
                  style={{
                    fontSize: 10, fontWeight: 600, color: MUTED,
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    fontFamily: 'inherit', padding: '2px 4px',
                  }}
                >
                  Clear
                </button>
              </div>
              {recents.map(item => (
                <Link
                  key={`recent-${item.type}-${item.id}`}
                  href={item.href}
                  onClick={() => handleResultClick(item)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 16px', textDecoration: 'none', color: 'inherit',
                  }}
                >
                  {/* Clock icon */}
                  <span style={{
                    width: 32, height: 32, borderRadius: '50%',
                    background: 'rgba(255,255,255,0.04)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                    </svg>
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, fontWeight: 600, color: '#fff',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {item.title}
                    </div>
                    {item.subtitle && (
                      <div style={{ fontSize: 11, color: MUTED, marginTop: 1 }}>
                        {item.subtitle}
                      </div>
                    )}
                  </div>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2" strokeLinecap="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </Link>
              ))}
            </>
          )}

          {/* Popular heading */}
          {!query.trim() && popular.length > 0 && (
            <div style={{
              padding: '6px 16px 8px', fontSize: 10, fontWeight: 700,
              color: GREEN, textTransform: 'uppercase', letterSpacing: '0.8px',
            }}>
              Popular
            </div>
          )}

          {/* Searching indicator */}
          {searching && (
            <div style={{
              padding: '24px 16px', fontSize: 12, color: MUTED, textAlign: 'center',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              <span style={{
                width: 14, height: 14, border: `2px solid ${GREEN}`, borderTopColor: 'transparent',
                borderRadius: '50%', display: 'inline-block',
                animation: 'v3spin 0.6s linear infinite',
              }} />
              Searching...
            </div>
          )}

          {/* No results */}
          {query.trim() && !searching && results.length === 0 && (
            <div style={{
              padding: '28px 16px', fontSize: 13, color: MUTED, textAlign: 'center',
            }}>
              No results for <span style={{ color: '#fff', fontWeight: 600 }}>&quot;{query}&quot;</span>
            </div>
          )}

          {/* Grouped results */}
          {(['player', 'match', 'tournament'] as const).map(type => {
            const items = grouped[type]
            if (items.length === 0) return null
            const meta = TYPE_META[type]
            return (
              <div key={type}>
                {query.trim() && (
                  <div style={{
                    padding: '10px 16px 4px', fontSize: 10, fontWeight: 700,
                    color: meta.fg, textTransform: 'uppercase', letterSpacing: '0.8px',
                  }}>
                    {tSearch(TYPE_LABEL_KEYS[type])}
                  </div>
                )}
                {items.map(item => (
                  <Link
                    key={`${type}-${item.id}`}
                    href={item.href}
                    onClick={() => handleResultClick(item)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 16px', textDecoration: 'none', color: 'inherit',
                      transition: 'background 0.15s',
                    }}
                  >
                    {/* Thumbnail / icon */}
                    {item.imageUrl ? (
                      <Avatar
                        src={item.imageUrl}
                        alt={item.title}
                        size={34}
                        style={{
                          background: BG_CARD,
                          border: `1px solid ${BORDER}`,
                        }}
                      />
                    ) : item.country ? (
                      <span style={{
                        width: 34, height: 34, display: 'flex',
                        alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        <FlagImage country={item.country} size={22} rounded />
                      </span>
                    ) : (
                      (() => {
                        // For matches: show W/L/— instead of generic "M"
                        const letter = item.matchLetter ?? meta.letter
                        const isWin = letter === 'W'
                        const isLoss = letter === 'L'
                        const iconBg = isWin ? 'rgba(126,211,33,0.15)' : isLoss ? 'rgba(255,70,85,0.15)' : meta.bg
                        const iconFg = isWin ? GREEN : isLoss ? LIVE_RED : meta.fg
                        return (
                          <span style={{
                            fontSize: 11, fontWeight: 800, width: 34, height: 34,
                            clipPath: CLIP.badge,
                            background: iconBg,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0, color: iconFg, letterSpacing: 0.5,
                          }}>
                            {letter}
                          </span>
                        )
                      })()
                    )}

                    {/* Text */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13, fontWeight: 600, color: '#fff',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {item.title}
                      </div>
                      {item.subtitle && (
                        <div style={{ fontSize: 11, color: MUTED, marginTop: 1 }}>
                          {item.subtitle}
                        </div>
                      )}
                    </div>

                    {/* Badge (LIVE / ranking move) */}
                    {item.badge && (
                      <span style={{
                        fontSize: 10, fontWeight: 800,
                        color: item.badge === 'LIVE' ? '#fff' : GREEN,
                        background: item.badge === 'LIVE' ? LIVE_RED : 'rgba(126,211,33,0.12)',
                        clipPath: CLIP.badge,
                        padding: '3px 8px', flexShrink: 0,
                        letterSpacing: item.badge === 'LIVE' ? '0.5px' : 0,
                      }}>
                        {item.badge}
                      </span>
                    )}

                    {/* Chevron */}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="2" strokeLinecap="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </Link>
                ))}
              </div>
            )
          })}
        </div>
      </div>

      {/* Spinner keyframe animation */}
      <style>{`
        @keyframes v3spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

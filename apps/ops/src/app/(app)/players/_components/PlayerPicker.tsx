'use client'
// apps/ops/src/app/(app)/players/_components/PlayerPicker.tsx
// Searchable player picker used in AddRacketModal step 2.
//
// Behaviour:
//   - Click trigger → dropdown opens with autofocused search input
//   - Type → 250ms debounce → GET /api/internal/search-players?q=...&per_page=20
//   - Empty search → shows the default top-ranked list (page=1 per_page=20)
//   - Click result → select + close
//   - "Clear selection" affordance inside the dropdown
//
// Differs from Combobox: server-side search (Combobox is client-only over a
// pre-fetched options array), avatar/country/ranking rich rows, and a single
// "select OR clear" UX (no inline create).

import { useState, useRef, useEffect, useCallback } from 'react'

export interface PlayerLite {
  id: string
  name: string
  display_name: string | null
  country: string | null
  ranking: number | null
  category: 'men' | 'women' | null
  avatar_url: string | null
}

interface Props {
  value: PlayerLite | null
  onChange: (player: PlayerLite | null) => void
  disabled?: boolean
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('')
}

function displayLabel(p: PlayerLite): string {
  return p.display_name?.trim() || p.name
}

export default function PlayerPicker({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PlayerLite[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const reqIdRef = useRef(0)

  // Close on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  // Debounced server-side search. Empty query → top-ranked default list.
  const runSearch = useCallback(async (q: string) => {
    const myReqId = ++reqIdRef.current
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ per_page: '20' })
      if (q) params.set('q', q)
      const res = await fetch(`/api/internal/search-players?${params.toString()}`)
      if (!res.ok) {
        if (myReqId === reqIdRef.current) {
          setError(`Search failed (${res.status})`)
          setResults([])
        }
        return
      }
      const data = (await res.json()) as { players?: PlayerLite[] }
      if (myReqId === reqIdRef.current) {
        setResults(data.players ?? [])
      }
    } catch (err) {
      if (myReqId === reqIdRef.current) {
        setError(err instanceof Error ? err.message : 'Search failed')
        setResults([])
      }
    } finally {
      if (myReqId === reqIdRef.current) setLoading(false)
    }
  }, [])

  // Trigger search whenever the dropdown opens or query changes (250ms debounce).
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      runSearch(query.trim())
    }, 250)
    return () => clearTimeout(t)
  }, [open, query, runSearch])

  function handleSelect(p: PlayerLite) {
    onChange(p)
    setOpen(false)
    setQuery('')
  }

  function handleClear() {
    onChange(null)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={ref} className="relative">
      {/* Trigger button */}
      {value ? (
        <div className="flex items-center gap-2 w-full px-3 py-2 border border-gray-200 rounded bg-white">
          <PlayerAvatar player={value} size={24} />
          <div className="flex-1 min-w-0">
            <div className="text-sm text-gray-900 truncate">{displayLabel(value)}</div>
            {(value.country || value.ranking != null) && (
              <div className="text-[11px] text-gray-500 truncate">
                {value.country ?? ''}
                {value.country && value.ranking != null ? ' · ' : ''}
                {value.ranking != null ? `#${value.ranking}` : ''}
              </div>
            )}
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setOpen((v) => !v)}
            className="text-[11px] text-blue-600 cursor-pointer hover:underline"
          >
            Change
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={handleClear}
            className="text-[11px] text-gray-400 cursor-pointer hover:text-gray-600"
            aria-label="Clear selection"
          >
            ×
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => !disabled && setOpen((v) => !v)}
          className="w-full px-3 py-2 text-left text-sm border border-gray-200 rounded bg-white text-gray-400 cursor-pointer disabled:bg-gray-50 disabled:cursor-not-allowed"
        >
          Search for a player…
        </button>
      )}

      {open && !disabled && (
        <div className="absolute left-0 right-0 mt-1 max-h-72 overflow-auto bg-white border border-gray-200 rounded shadow-lg z-10">
          <input
            type="text"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a name…"
            className="w-full px-3 py-2 text-sm border-b border-gray-100 outline-none"
          />
          {value && (
            <button
              type="button"
              onClick={handleClear}
              className="w-full px-3 py-2 text-left text-xs text-gray-500 border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
            >
              Clear selection
            </button>
          )}
          {loading && (
            <div className="px-3 py-3 text-xs text-gray-400">Searching…</div>
          )}
          {!loading && error && (
            <div className="px-3 py-3 text-xs text-red-600">{error}</div>
          )}
          {!loading && !error && results.length === 0 && (
            <div className="px-3 py-3 text-xs text-gray-400">
              {query.trim() ? 'No matches' : 'No players found'}
            </div>
          )}
          {!loading &&
            !error &&
            results.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelect(p)}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 cursor-pointer flex items-center gap-2"
              >
                <PlayerAvatar player={p} size={24} />
                <div className="flex-1 min-w-0">
                  <div className="text-gray-900 truncate">{displayLabel(p)}</div>
                  {p.category && (
                    <div className="text-[10px] text-gray-400">
                      {p.category === 'men' ? "Men's" : "Women's"}
                    </div>
                  )}
                </div>
                <div className="text-[11px] text-gray-500 text-right shrink-0">
                  {p.country && <div>{p.country}</div>}
                  {p.ranking != null && <div>#{p.ranking}</div>}
                </div>
              </button>
            ))}
        </div>
      )}
    </div>
  )
}

function PlayerAvatar({ player, size }: { player: PlayerLite; size: number }) {
  if (player.avatar_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={player.avatar_url}
        alt={player.name}
        width={size}
        height={size}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          flexShrink: 0,
        }}
      />
    )
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: '#E5E7EB',
        color: '#6B7280',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.4,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {initials(player.name)}
    </div>
  )
}

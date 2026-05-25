'use client'
// apps/ops/src/components/TournamentExplorerPicker.tsx
// Searchable dropdown of tournaments with a recent snapshot.

import { useMemo, useState } from 'react'
import type { TournamentListItem } from '@/lib/tournament-list-aggregator'

export function TournamentExplorerPicker({
  tournaments,
  selectedId,
  onSelect,
}: {
  tournaments: TournamentListItem[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return tournaments.slice(0, 50)
    return tournaments
      .filter((t) => t.name.toLowerCase().includes(q) || (t.country ?? '').toLowerCase().includes(q))
      .slice(0, 50)
  }, [tournaments, query])

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 12, marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--status-neutral)', textTransform: 'uppercase', marginBottom: 6 }}>
        Tournament
      </label>
      <input
        type="search"
        autoFocus={!selectedId}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name or country…"
        style={{ width: '100%', padding: '6px 10px', fontSize: 13, border: '1px solid var(--border-subtle)', borderRadius: 4, marginBottom: 8 }}
      />
      <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 4 }}>
        {filtered.length === 0 && (
          <div style={{ padding: 10, fontSize: 12, color: 'var(--status-neutral)' }}>No tournaments match.</div>
        )}
        {filtered.map((t) => {
          const isSelected = t.id === selectedId
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t.id)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '8px 10px', border: 'none', cursor: 'pointer',
                background: isSelected ? '#eff6ff' : 'transparent',
                borderBottom: '1px solid var(--border-subtle)',
                fontSize: 12,
              }}
            >
              <div style={{ fontWeight: 600, color: '#111' }}>{t.name}</div>
              <div style={{ fontSize: 10, color: 'var(--status-neutral)', fontFamily: 'monospace', marginTop: 2 }}>
                {t.starts_at?.slice(0, 10) ?? '—'} · {t.country ?? '—'} · {t.level ?? '—'}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

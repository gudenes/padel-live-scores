'use client'
// src/app/ops/DrawEditorTab.tsx
// Draw editor UI — ops dashboard tab for editing tournament draw entries

import { useEffect, useState, useRef, useCallback } from 'react'

// ── Types ────────────────────────────────────────────────────────

interface DrawEntry {
  id: string
  tournament_id: string
  category: string
  draw_position: number
  seed: number | null
  marker: string | null
  player1_name: string
  player1_country: string | null
  player1_id: string | null
  player2_name: string
  player2_country: string | null
  player2_id: string | null
  team_points: number | null
  created_at: string
}

interface PlayerSearchResult {
  id: string
  name: string
  country: string | null
  ranking: number | null
}

interface PendingNewRow {
  tempId: string
  draw_position: number
  seed: number | null
  marker: string | null
  player1_name: string
  player1_id: string | null
  player2_name: string
  player2_id: string | null
  team_points: number | null
}

type Category = 'men' | 'women'

// ── Shared styles ────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'white',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 12,
}

const sectionLabel: React.CSSProperties = {
  fontSize: 10,
  color: '#999',
  textTransform: 'uppercase' as const,
  fontWeight: 700,
  letterSpacing: 1,
  marginBottom: 8,
}

// ── Component ────────────────────────────────────────────────────

export default function DrawEditorTab({
  tournamentId,
  tournamentName,
  onBack,
}: {
  tournamentId: string
  tournamentName: string
  onBack: () => void
}) {
  const [category, setCategory] = useState<Category>('men')
  const [draws, setDraws] = useState<DrawEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Changes tracking: Map of draw ID -> partial updates
  const [changes, setChanges] = useState<Map<string, Partial<DrawEntry>>>(new Map())
  const [newRows, setNewRows] = useState<PendingNewRow[]>([])
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set())

  // Player search popover
  const [searchPopoverKey, setSearchPopoverKey] = useState<string | null>(null)
  const [searchPopoverQuery, setSearchPopoverQuery] = useState('')
  const [searchPopoverResults, setSearchPopoverResults] = useState<PlayerSearchResult[]>([])
  const [searchPopoverLoading, setSearchPopoverLoading] = useState(false)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Fetch draws ────────────────────────────────────────────────

  const fetchDraws = useCallback(async () => {
    setLoading(true)
    setError(null)
    setChanges(new Map())
    setNewRows([])
    setDeletedIds(new Set())
    setSaveMessage(null)
    try {
      const res = await fetch(`/api/ops/tournament-draws?tournament_id=${tournamentId}&category=${category}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(`HTTP ${res.status}: ${body.error ?? 'Unknown'}`)
      }
      const data = await res.json()
      setDraws(data.draws ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load draws')
    } finally {
      setLoading(false)
    }
  }, [tournamentId, category])

  useEffect(() => {
    fetchDraws()
  }, [fetchDraws])

  // ── Close search popover on outside click ─────────────────────

  useEffect(() => {
    if (!searchPopoverKey) return
    function handleClickOutside(e: MouseEvent) {
      const popover = document.getElementById('draw-player-search-popover')
      if (popover && !popover.contains(e.target as Node)) {
        setSearchPopoverKey(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [searchPopoverKey])

  // ── Player search handler ─────────────────────────────────────

  const handlePlayerSearch = useCallback((query: string) => {
    setSearchPopoverQuery(query)
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    if (!query.trim()) {
      setSearchPopoverResults([])
      return
    }
    searchDebounceRef.current = setTimeout(async () => {
      setSearchPopoverLoading(true)
      try {
        const res = await fetch(`/api/ops/search-players?q=${encodeURIComponent(query)}&category=${category}`)
        if (res.ok) {
          const data = await res.json()
          setSearchPopoverResults(data.players ?? [])
        }
      } catch { /* ignore */ }
      setSearchPopoverLoading(false)
    }, 300)
  }, [category])

  // ── Change tracking helpers ───────────────────────────────────

  const updateField = useCallback((id: string, field: string, value: unknown) => {
    setChanges(prev => {
      const next = new Map(prev)
      const existing = next.get(id) ?? {}
      next.set(id, { ...existing, [field]: value })
      return next
    })
  }, [])

  const getFieldValue = useCallback((draw: DrawEntry, field: keyof DrawEntry) => {
    const change = changes.get(draw.id)
    if (change && field in change) return change[field as keyof typeof change]
    return draw[field]
  }, [changes])

  const updateNewRowField = useCallback((tempId: string, field: string, value: unknown) => {
    setNewRows(prev => prev.map(row =>
      row.tempId === tempId ? { ...row, [field]: value } : row
    ))
  }, [])

  const handleDelete = useCallback((id: string) => {
    setDeletedIds(prev => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }, [])

  const handleAddRow = useCallback(() => {
    const maxPos = Math.max(
      ...draws.map(d => d.draw_position),
      ...newRows.map(r => r.draw_position),
      0
    )
    setNewRows(prev => [...prev, {
      tempId: `new-${Date.now()}`,
      draw_position: maxPos + 1,
      seed: null,
      marker: null,
      player1_name: '',
      player1_id: null,
      player2_name: '',
      player2_id: null,
      team_points: null,
    }])
  }, [draws, newRows])

  // ── Save changes ──────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    setSaving(true)
    setSaveMessage(null)
    const errors: string[] = []

    // 1. Delete removed rows
    for (const id of deletedIds) {
      try {
        const res = await fetch(`/api/ops/tournament-draws?id=${id}`, { method: 'DELETE' })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          errors.push(`Delete ${id.slice(0, 8)}: ${body.error ?? 'failed'}`)
        }
      } catch (e: unknown) {
        errors.push(`Delete ${id.slice(0, 8)}: ${e instanceof Error ? e.message : 'failed'}`)
      }
    }

    // 2. Patch modified rows
    const updates = Array.from(changes.entries())
      .filter(([id]) => !deletedIds.has(id))
      .map(([id, fields]) => ({ id, ...fields }))

    if (updates.length > 0) {
      try {
        const res = await fetch('/api/ops/tournament-draws', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ updates }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          errors.push(`Patch: ${body.error ?? 'failed'}`)
        } else {
          const result = await res.json()
          if (result.errors?.length) {
            errors.push(...result.errors)
          }
        }
      } catch (e: unknown) {
        errors.push(`Patch: ${e instanceof Error ? e.message : 'failed'}`)
      }
    }

    // 3. Create new rows
    for (const row of newRows) {
      if (!row.player1_name && !row.player2_name) continue
      try {
        const res = await fetch('/api/ops/tournament-draws', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tournament_id: tournamentId,
            category,
            draw_position: row.draw_position,
            seed: row.seed,
            marker: row.marker,
            player1_name: row.player1_name || 'TBD',
            player2_name: row.player2_name || 'TBD',
            player1_id: row.player1_id,
            player2_id: row.player2_id,
            team_points: row.team_points,
          }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          errors.push(`Create pos ${row.draw_position}: ${body.error ?? 'failed'}`)
        }
      } catch (e: unknown) {
        errors.push(`Create pos ${row.draw_position}: ${e instanceof Error ? e.message : 'failed'}`)
      }
    }

    setSaving(false)

    if (errors.length > 0) {
      setSaveMessage(`Saved with ${errors.length} error(s): ${errors.join('; ')}`)
    } else {
      setSaveMessage('Saved successfully')
    }

    // Refresh
    fetchDraws()
  }, [changes, deletedIds, newRows, tournamentId, category, fetchDraws])

  const hasChanges = changes.size > 0 || newRows.length > 0 || deletedIds.size > 0

  // Visible draws (excluding deleted)
  const visibleDraws = draws.filter(d => !deletedIds.has(d.id))

  // ── Render ────────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button
          onClick={onBack}
          style={{
            background: 'none', border: 'none', color: '#4A9EFF', cursor: 'pointer',
            fontSize: 12, fontWeight: 500, padding: 0,
          }}
        >
          &larr; Back to Readiness
        </button>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#111' }}>
          Draw Editor &mdash; {tournamentName}
        </div>
      </div>

      {/* Gender toggle + summary */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 0 }}>
          {(['men', 'women'] as Category[]).map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              style={{
                padding: '5px 14px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                border: '1px solid #d1d5db',
                borderRadius: cat === 'men' ? '4px 0 0 4px' : '0 4px 4px 0',
                background: category === cat ? '#111' : 'white',
                color: category === cat ? 'white' : '#333',
                borderLeft: cat === 'women' ? 'none' : undefined,
              }}
            >
              {cat === 'men' ? 'Men' : 'Women'}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 11, color: '#6B7280' }}>
          {visibleDraws.length + newRows.length} entries
        </span>
        {hasChanges && (
          <span style={{ fontSize: 10, color: '#F5A623', fontWeight: 600 }}>
            Unsaved changes
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={{ ...card, background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', marginBottom: 12, fontSize: 12 }}>
          {error}
        </div>
      )}

      {/* Save message */}
      {saveMessage && (
        <div style={{
          ...card, marginBottom: 12, fontSize: 12,
          background: saveMessage.includes('error') ? '#FEF2F2' : '#F0FDF4',
          border: saveMessage.includes('error') ? '1px solid #FECACA' : '1px solid #BBF7D0',
          color: saveMessage.includes('error') ? '#991B1B' : '#166534',
        }}>
          {saveMessage}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ padding: 20, color: '#999', fontSize: 12, textAlign: 'center' }}>Loading draws...</div>
      )}

      {/* Table */}
      {!loading && (
        <div style={{ ...card, padding: 0, overflow: 'auto' }}>
          <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
                {['Pos', 'Seed', 'Marker', 'Player 1', 'P1 ID', 'Player 2', 'P2 ID', 'Points', ''].map(h => (
                  <th
                    key={h}
                    style={{
                      ...sectionLabel,
                      padding: '8px 6px', textAlign: 'left', marginBottom: 0,
                      fontSize: 9, fontWeight: 700, color: '#999',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleDraws.map(draw => {
                const isModified = changes.has(draw.id)
                return (
                  <tr
                    key={draw.id}
                    style={{
                      borderBottom: '1px solid #f3f4f6',
                      borderLeft: isModified ? '3px solid #FEF3C7' : '3px solid transparent',
                    }}
                  >
                    {/* Pos - read only */}
                    <td style={{ padding: '5px 6px', color: '#9ca3af', fontWeight: 500, width: 40 }}>
                      {draw.draw_position}
                    </td>
                    {/* Seed */}
                    <td style={{ padding: '5px 4px', width: 50 }}>
                      <input
                        type="number"
                        value={getFieldValue(draw, 'seed') ?? ''}
                        onChange={e => updateField(draw.id, 'seed', e.target.value ? Number(e.target.value) : null)}
                        style={{
                          width: 40, padding: '3px 4px', fontSize: 11,
                          border: '1px solid #e5e7eb', borderRadius: 3,
                          textAlign: 'center',
                        }}
                      />
                    </td>
                    {/* Marker */}
                    <td style={{ padding: '5px 4px', width: 60 }}>
                      <select
                        value={(getFieldValue(draw, 'marker') as string) ?? ''}
                        onChange={e => updateField(draw.id, 'marker', e.target.value || null)}
                        style={{
                          padding: '3px 4px', fontSize: 11,
                          border: '1px solid #e5e7eb', borderRadius: 3,
                          background: 'white',
                        }}
                      >
                        <option value="">(none)</option>
                        <option value="Q">Q</option>
                        <option value="WC">WC</option>
                        <option value="LL">LL</option>
                      </select>
                    </td>
                    {/* Player 1 name */}
                    <td style={{ padding: '5px 4px' }}>
                      <input
                        type="text"
                        value={(getFieldValue(draw, 'player1_name') as string) ?? ''}
                        onChange={e => updateField(draw.id, 'player1_name', e.target.value)}
                        style={{
                          width: '100%', padding: '3px 5px', fontSize: 11,
                          border: '1px solid #e5e7eb', borderRadius: 3,
                          boxSizing: 'border-box',
                        }}
                      />
                    </td>
                    {/* P1 ID */}
                    <td style={{ padding: '5px 4px', position: 'relative', width: 110 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        <span style={{ fontSize: 10, color: '#6B7280', fontFamily: 'monospace' }}>
                          {((getFieldValue(draw, 'player1_id') as string) ?? '').slice(0, 8) || '—'}
                        </span>
                        <button
                          onClick={() => {
                            setSearchPopoverKey(`${draw.id}-p1`)
                            setSearchPopoverQuery('')
                            setSearchPopoverResults([])
                          }}
                          style={{
                            background: 'none', border: '1px solid #d1d5db', borderRadius: 4,
                            cursor: 'pointer', padding: '2px 5px', fontSize: 12, lineHeight: 1,
                          }}
                        >&#128269;</button>
                        {searchPopoverKey === `${draw.id}-p1` && (
                          <PlayerSearchPopover
                            query={searchPopoverQuery}
                            results={searchPopoverResults}
                            loading={searchPopoverLoading}
                            onQueryChange={handlePlayerSearch}
                            onClose={() => setSearchPopoverKey(null)}
                            onSelect={(playerId) => {
                              updateField(draw.id, 'player1_id', playerId)
                              setSearchPopoverKey(null)
                            }}
                          />
                        )}
                      </div>
                    </td>
                    {/* Player 2 name */}
                    <td style={{ padding: '5px 4px' }}>
                      <input
                        type="text"
                        value={(getFieldValue(draw, 'player2_name') as string) ?? ''}
                        onChange={e => updateField(draw.id, 'player2_name', e.target.value)}
                        style={{
                          width: '100%', padding: '3px 5px', fontSize: 11,
                          border: '1px solid #e5e7eb', borderRadius: 3,
                          boxSizing: 'border-box',
                        }}
                      />
                    </td>
                    {/* P2 ID */}
                    <td style={{ padding: '5px 4px', position: 'relative', width: 110 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        <span style={{ fontSize: 10, color: '#6B7280', fontFamily: 'monospace' }}>
                          {((getFieldValue(draw, 'player2_id') as string) ?? '').slice(0, 8) || '—'}
                        </span>
                        <button
                          onClick={() => {
                            setSearchPopoverKey(`${draw.id}-p2`)
                            setSearchPopoverQuery('')
                            setSearchPopoverResults([])
                          }}
                          style={{
                            background: 'none', border: '1px solid #d1d5db', borderRadius: 4,
                            cursor: 'pointer', padding: '2px 5px', fontSize: 12, lineHeight: 1,
                          }}
                        >&#128269;</button>
                        {searchPopoverKey === `${draw.id}-p2` && (
                          <PlayerSearchPopover
                            query={searchPopoverQuery}
                            results={searchPopoverResults}
                            loading={searchPopoverLoading}
                            onQueryChange={handlePlayerSearch}
                            onClose={() => setSearchPopoverKey(null)}
                            onSelect={(playerId) => {
                              updateField(draw.id, 'player2_id', playerId)
                              setSearchPopoverKey(null)
                            }}
                          />
                        )}
                      </div>
                    </td>
                    {/* Points */}
                    <td style={{ padding: '5px 4px', width: 60 }}>
                      <input
                        type="number"
                        value={getFieldValue(draw, 'team_points') ?? ''}
                        onChange={e => updateField(draw.id, 'team_points', e.target.value ? Number(e.target.value) : null)}
                        style={{
                          width: 55, padding: '3px 4px', fontSize: 11,
                          border: '1px solid #e5e7eb', borderRadius: 3,
                          textAlign: 'right',
                        }}
                      />
                    </td>
                    {/* Actions */}
                    <td style={{ padding: '5px 6px', width: 36, textAlign: 'center' }}>
                      <button
                        onClick={() => handleDelete(draw.id)}
                        title="Delete row"
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          fontSize: 14, padding: '2px 4px', color: '#9ca3af',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#FF4655')}
                        onMouseLeave={e => (e.currentTarget.style.color = '#9ca3af')}
                      >
                        &#128465;
                      </button>
                    </td>
                  </tr>
                )
              })}

              {/* New rows */}
              {newRows.map(row => (
                <tr
                  key={row.tempId}
                  style={{
                    borderBottom: '1px solid #f3f4f6',
                    borderLeft: '3px solid #DBEAFE',
                    background: '#FAFBFF',
                  }}
                >
                  <td style={{ padding: '5px 6px', width: 40 }}>
                    <input
                      type="number"
                      value={row.draw_position}
                      onChange={e => updateNewRowField(row.tempId, 'draw_position', Number(e.target.value))}
                      style={{
                        width: 40, padding: '3px 4px', fontSize: 11,
                        border: '1px solid #e5e7eb', borderRadius: 3,
                        textAlign: 'center',
                      }}
                    />
                  </td>
                  <td style={{ padding: '5px 4px', width: 50 }}>
                    <input
                      type="number"
                      value={row.seed ?? ''}
                      onChange={e => updateNewRowField(row.tempId, 'seed', e.target.value ? Number(e.target.value) : null)}
                      style={{
                        width: 40, padding: '3px 4px', fontSize: 11,
                        border: '1px solid #e5e7eb', borderRadius: 3,
                        textAlign: 'center',
                      }}
                    />
                  </td>
                  <td style={{ padding: '5px 4px', width: 60 }}>
                    <select
                      value={row.marker ?? ''}
                      onChange={e => updateNewRowField(row.tempId, 'marker', e.target.value || null)}
                      style={{
                        padding: '3px 4px', fontSize: 11,
                        border: '1px solid #e5e7eb', borderRadius: 3,
                        background: 'white',
                      }}
                    >
                      <option value="">(none)</option>
                      <option value="Q">Q</option>
                      <option value="WC">WC</option>
                      <option value="LL">LL</option>
                    </select>
                  </td>
                  <td style={{ padding: '5px 4px' }}>
                    <input
                      type="text"
                      value={row.player1_name}
                      onChange={e => updateNewRowField(row.tempId, 'player1_name', e.target.value)}
                      placeholder="Player 1"
                      style={{
                        width: '100%', padding: '3px 5px', fontSize: 11,
                        border: '1px solid #e5e7eb', borderRadius: 3,
                        boxSizing: 'border-box',
                      }}
                    />
                  </td>
                  <td style={{ padding: '5px 4px', position: 'relative', width: 110 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <span style={{ fontSize: 10, color: '#6B7280', fontFamily: 'monospace' }}>
                        {(row.player1_id ?? '').slice(0, 8) || '—'}
                      </span>
                      <button
                        onClick={() => {
                          setSearchPopoverKey(`${row.tempId}-p1`)
                          setSearchPopoverQuery('')
                          setSearchPopoverResults([])
                        }}
                        style={{
                          background: 'none', border: '1px solid #d1d5db', borderRadius: 4,
                          cursor: 'pointer', padding: '2px 5px', fontSize: 12, lineHeight: 1,
                        }}
                      >&#128269;</button>
                      {searchPopoverKey === `${row.tempId}-p1` && (
                        <PlayerSearchPopover
                          query={searchPopoverQuery}
                          results={searchPopoverResults}
                          loading={searchPopoverLoading}
                          onQueryChange={handlePlayerSearch}
                          onClose={() => setSearchPopoverKey(null)}
                          onSelect={(playerId) => {
                            updateNewRowField(row.tempId, 'player1_id', playerId)
                            setSearchPopoverKey(null)
                          }}
                        />
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '5px 4px' }}>
                    <input
                      type="text"
                      value={row.player2_name}
                      onChange={e => updateNewRowField(row.tempId, 'player2_name', e.target.value)}
                      placeholder="Player 2"
                      style={{
                        width: '100%', padding: '3px 5px', fontSize: 11,
                        border: '1px solid #e5e7eb', borderRadius: 3,
                        boxSizing: 'border-box',
                      }}
                    />
                  </td>
                  <td style={{ padding: '5px 4px', position: 'relative', width: 110 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <span style={{ fontSize: 10, color: '#6B7280', fontFamily: 'monospace' }}>
                        {(row.player2_id ?? '').slice(0, 8) || '—'}
                      </span>
                      <button
                        onClick={() => {
                          setSearchPopoverKey(`${row.tempId}-p2`)
                          setSearchPopoverQuery('')
                          setSearchPopoverResults([])
                        }}
                        style={{
                          background: 'none', border: '1px solid #d1d5db', borderRadius: 4,
                          cursor: 'pointer', padding: '2px 5px', fontSize: 12, lineHeight: 1,
                        }}
                      >&#128269;</button>
                      {searchPopoverKey === `${row.tempId}-p2` && (
                        <PlayerSearchPopover
                          query={searchPopoverQuery}
                          results={searchPopoverResults}
                          loading={searchPopoverLoading}
                          onQueryChange={handlePlayerSearch}
                          onClose={() => setSearchPopoverKey(null)}
                          onSelect={(playerId) => {
                            updateNewRowField(row.tempId, 'player2_id', playerId)
                            setSearchPopoverKey(null)
                          }}
                        />
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '5px 4px', width: 60 }}>
                    <input
                      type="number"
                      value={row.team_points ?? ''}
                      onChange={e => updateNewRowField(row.tempId, 'team_points', e.target.value ? Number(e.target.value) : null)}
                      style={{
                        width: 55, padding: '3px 4px', fontSize: 11,
                        border: '1px solid #e5e7eb', borderRadius: 3,
                        textAlign: 'right',
                      }}
                    />
                  </td>
                  <td style={{ padding: '5px 6px', width: 36, textAlign: 'center' }}>
                    <button
                      onClick={() => setNewRows(prev => prev.filter(r => r.tempId !== row.tempId))}
                      title="Remove row"
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        fontSize: 14, padding: '2px 4px', color: '#9ca3af',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.color = '#FF4655')}
                      onMouseLeave={e => (e.currentTarget.style.color = '#9ca3af')}
                    >
                      &#128465;
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Empty state */}
          {visibleDraws.length === 0 && newRows.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>
              No draw entries for {category}. Upload a draw via Entry Lists or add rows manually.
            </div>
          )}
        </div>
      )}

      {/* Bottom actions */}
      {!loading && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
          <button
            onClick={handleAddRow}
            style={{
              padding: '6px 14px', fontSize: 11, fontWeight: 600,
              background: 'white', border: '1px solid #d1d5db', borderRadius: 6,
              cursor: 'pointer', color: '#333',
            }}
          >
            + Add Row
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            style={{
              padding: '6px 14px', fontSize: 11, fontWeight: 600,
              background: hasChanges ? '#111' : '#e5e7eb',
              color: hasChanges ? 'white' : '#9ca3af',
              border: 'none', borderRadius: 6,
              cursor: hasChanges ? 'pointer' : 'default',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          {deletedIds.size > 0 && (
            <span style={{ fontSize: 10, color: '#FF4655' }}>
              {deletedIds.size} row(s) will be deleted
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ── Player Search Popover subcomponent ──────────────────────────

function PlayerSearchPopover({
  query,
  results,
  loading,
  onQueryChange,
  onClose,
  onSelect,
}: {
  query: string
  results: PlayerSearchResult[]
  loading: boolean
  onQueryChange: (q: string) => void
  onClose: () => void
  onSelect: (playerId: string) => void
}) {
  return (
    <div
      id="draw-player-search-popover"
      style={{
        position: 'absolute', top: '100%', left: 0, zIndex: 60,
        background: 'white', border: '1px solid #e5e7eb', borderRadius: 6,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)', padding: 8,
        width: 260, marginTop: 2,
      }}
    >
      <input
        type="text"
        autoFocus
        value={query}
        onChange={e => onQueryChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') onClose() }}
        placeholder="Search by name..."
        style={{
          width: '100%', padding: '5px 7px', fontSize: 11,
          border: '1px solid #d1d5db', borderRadius: 4, marginBottom: 4,
          boxSizing: 'border-box',
        }}
      />
      {loading && <div style={{ fontSize: 10, color: '#888', padding: 4 }}>Searching...</div>}
      {!loading && results.length === 0 && query.trim() && (
        <div style={{ fontSize: 10, color: '#999', padding: 4 }}>No results</div>
      )}
      {results.map(r => (
        <div
          key={r.id}
          onClick={() => onSelect(r.id)}
          style={{
            padding: '5px 6px', cursor: 'pointer', borderRadius: 4,
            fontSize: 11, display: 'flex', alignItems: 'center', gap: 6,
          }}
          onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <span style={{ fontWeight: 500, color: '#111' }}>{r.name}</span>
          {r.country && <span style={{ color: '#999' }}>({r.country})</span>}
          {r.ranking && <span style={{ color: '#888', fontSize: 10 }}>#{r.ranking}</span>}
        </div>
      ))}
    </div>
  )
}

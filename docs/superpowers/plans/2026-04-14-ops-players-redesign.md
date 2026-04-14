# Ops Players Tab Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the ops Players tab with data completeness indicators, filter chips, bulk actions, a right-side overlay drawer, and server-side pagination.

**Architecture:** Break the 1,350-line monolith into 5 focused components (PlayersTab, PlayersTable, PlayerDrawer, BulkActionsBar, FilterChips). Extend the search-players API with pagination and filter params. Keep the existing merge flow intact — it stays in the main PlayersTab.

**Tech Stack:** React 19 (client components), Supabase JS, inline styles (matching ops dashboard patterns)

**Spec:** `docs/superpowers/specs/2026-04-14-ops-players-redesign-design.md`

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/app/ops/players/PlayersTable.tsx` | Create | Table with checkboxes, completeness dots, row click handler |
| `src/app/ops/players/FilterChips.tsx` | Create | Filter chips row with counts |
| `src/app/ops/players/BulkActionsBar.tsx` | Create | Selection count + bulk action buttons |
| `src/app/ops/players/PlayerDrawer.tsx` | Create | Right overlay drawer with edit form, tabs, equipment |
| `src/app/ops/players/types.ts` | Create | Shared types (PlayerSummary, PlayerDetail, etc.) |
| `src/app/ops/PlayersTab.tsx` | Modify | Slim down to orchestrator: state, data fetching, compose sub-components. Keep merge flow. |
| `src/app/api/ops/search-players/route.ts` | Modify | Add pagination, filter params, total count |
| `src/app/api/ops/player-equipment/route.ts` | Modify | Add bulk assignment endpoint |

---

### Task 1: Shared types + API pagination

**Files:**
- Create: `src/app/ops/players/types.ts`
- Modify: `src/app/api/ops/search-players/route.ts`

- [ ] **Step 1: Create shared types file**

Create `src/app/ops/players/types.ts` with all the types currently defined at the top of PlayersTab.tsx. Add an `equipment` field to `PlayerSummary` and a `completeness` computed type:

```ts
// src/app/ops/players/types.ts

export interface PlayerSummary {
  id: string
  name: string
  display_name: string | null
  country: string | null
  ranking: number | null
  points: number | null
  category: string | null
  avatar_url: string | null
  equipment: { brand: string; model: string; year: number | null } | null
}

export interface PlayerDetail {
  id: string
  name: string
  display_name: string | null
  country: string | null
  category: string | null
  ranking: number | null
  points: number | null
  ranking_move: number | null
  race_ranking: number | null
  race_points: number | null
  race_move: number | null
  external_id: string | null
  fip_id: string | null
  avatar_url: string | null
  profile_url: string | null
  side: string | null
  height: string | null
  birthdate: string | null
  birthplace: string | null
  hand: string | null
  titles: number | null
  finals: number | null
  semifinals: number | null
  win_rate: number | null
  total_matches: number | null
  equipment: {
    racket_brand?: string
    racket_model?: string
    racket_url?: string
    racket_image?: string
    brand_logo?: string
  } | null
  created_at: string | null
  updated_at: string | null
}

export type DataFilter = 'all' | 'missing_equipment' | 'missing_avatar' | 'missing_ranking'
export type CategoryFilter = 'all' | 'men' | 'women'

export interface FilterCounts {
  total: number
  missing_equipment: number
  missing_avatar: number
  missing_ranking: number
}

/** 4 booleans: [hasAvatar, hasRanking, hasFipId, hasEquipment] */
export function computeCompleteness(p: PlayerSummary): boolean[] {
  return [
    !!p.avatar_url,
    p.ranking != null,
    false, // fip_id not in summary — filled by detail fetch
    !!p.equipment,
  ]
}
```

- [ ] **Step 2: Update search-players API with pagination + filters**

Modify `src/app/api/ops/search-players/route.ts`. The updated API accepts:
- `q` — search query (optional now, not required when using filters)
- `category` — men/women filter
- `filter` — `missing_equipment|missing_avatar|missing_ranking`
- `page` — page number (default 1)
- `per_page` — results per page (default 25)

Returns: `{ players: [...], total: number, page: number, per_page: number }`

Replace the GET handler with:

```ts
export async function GET(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const url = new URL(request.url)
  const q = url.searchParams.get('q')
  const category = url.searchParams.get('category')
  const filter = url.searchParams.get('filter')
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'))
  const perPage = Math.min(100, Math.max(1, parseInt(url.searchParams.get('per_page') ?? '25')))

  let query = supabase
    .from('players')
    .select('id, name, display_name, country, ranking, points, category, avatar_url, fip_id', { count: 'exact' })

  // Text search
  if (q && q.trim()) {
    query = query.ilike('name', `%${q}%`)
  }

  // Category filter
  if (category === 'men' || category === 'women') {
    query = query.eq('category', category)
  }

  // Data quality filters
  if (filter === 'missing_avatar') {
    query = query.is('avatar_url', null)
  } else if (filter === 'missing_ranking') {
    query = query.is('ranking', null)
  }
  // missing_equipment is handled post-query (requires join)

  const from = (page - 1) * perPage
  const to = from + perPage - 1

  const { data, error, count } = await query
    .order('ranking', { ascending: true, nullsFirst: false })
    .range(from, to)

  if (error) {
    console.error('[Search Players] Query failed:', error.message)
    return Response.json({ error: error.message }, { status: 500 })
  }

  // Fetch current equipment for returned players
  const playerIds = (data ?? []).map(p => p.id)
  let equipmentMap: Record<string, { brand: string; model: string; year: number | null }> = {}

  if (playerIds.length > 0) {
    const { data: eqData } = await supabase
      .from('player_equipment')
      .select('player_id, racket:padel_rackets(model, year, brand:padel_brands(name))')
      .in('player_id', playerIds)
      .is('ended_at', null)

    for (const eq of eqData ?? []) {
      const racket = eq.racket as any
      if (racket) {
        equipmentMap[eq.player_id] = {
          brand: racket.brand?.name ?? '',
          model: racket.model ?? '',
          year: racket.year ?? null,
        }
      }
    }
  }

  // For missing_equipment filter, we need to post-filter
  let players = (data ?? []).map(p => ({
    ...p,
    equipment: equipmentMap[p.id] ?? null,
  }))

  let total = count ?? 0

  if (filter === 'missing_equipment') {
    players = players.filter(p => !p.equipment)
    // Note: total count is approximate when using missing_equipment filter
    // since we filter post-query. For accurate counts, the FilterChips
    // component fetches counts separately.
  }

  return Response.json({
    players,
    total: filter === 'missing_equipment' ? players.length : total,
    page,
    per_page: perPage,
  })
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/ops/players/types.ts src/app/api/ops/search-players/route.ts
git commit -m "feat(ops): add shared player types + pagination/filter params to search API"
```

---

### Task 2: FilterChips component

**Files:**
- Create: `src/app/ops/players/FilterChips.tsx`

- [ ] **Step 1: Create FilterChips component**

```tsx
'use client'
import React from 'react'
import type { DataFilter, CategoryFilter, FilterCounts } from './types'

interface FilterChipsProps {
  counts: FilterCounts | null
  activeFilter: DataFilter
  activeCategory: CategoryFilter
  onFilterChange: (filter: DataFilter) => void
  onCategoryChange: (category: CategoryFilter) => void
}

export default function FilterChips({
  counts, activeFilter, activeCategory, onFilterChange, onCategoryChange,
}: FilterChipsProps) {
  const chipBase: React.CSSProperties = {
    fontSize: 11, fontWeight: 500, padding: '4px 10px', borderRadius: 6,
    border: '1px solid #e5e7eb', cursor: 'pointer', background: '#fff', color: '#111',
    transition: 'all 0.15s',
  }
  const chipActive: React.CSSProperties = {
    ...chipBase, background: '#111', color: '#fff', borderColor: '#111',
  }

  const dataFilters: { key: DataFilter; label: string; count: number | null }[] = [
    { key: 'all', label: 'All', count: counts?.total ?? null },
    { key: 'missing_equipment', label: 'Missing Equipment', count: counts?.missing_equipment ?? null },
    { key: 'missing_avatar', label: 'Missing Avatar', count: counts?.missing_avatar ?? null },
    { key: 'missing_ranking', label: 'Missing Ranking', count: counts?.missing_ranking ?? null },
  ]

  const categoryFilters: { key: CategoryFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'men', label: 'Men' },
    { key: 'women', label: 'Women' },
  ]

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
      {dataFilters.map(f => (
        <button
          key={f.key}
          onClick={() => onFilterChange(f.key)}
          style={activeFilter === f.key ? chipActive : chipBase}
        >
          {f.label}
          {f.count != null && (
            <span style={{ marginLeft: 4, opacity: 0.7, fontSize: 10 }}>({f.count.toLocaleString()})</span>
          )}
        </button>
      ))}
      <span style={{ width: 1, height: 20, background: '#e5e7eb', margin: '0 4px' }} />
      {categoryFilters.map(f => (
        <button
          key={f.key}
          onClick={() => onCategoryChange(f.key)}
          style={activeCategory === f.key ? chipActive : chipBase}
        >
          {f.label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/ops/players/FilterChips.tsx
git commit -m "feat(ops): add FilterChips component with data quality + category filters"
```

---

### Task 3: PlayersTable component with checkboxes + completeness dots

**Files:**
- Create: `src/app/ops/players/PlayersTable.tsx`

- [ ] **Step 1: Create PlayersTable component**

This component handles: table rendering, checkboxes, completeness dots, row click, pagination controls.

```tsx
'use client'
import React from 'react'
import type { PlayerSummary } from './types'
import { computeCompleteness } from './types'

interface PlayersTableProps {
  players: PlayerSummary[]
  selectedIds: Set<string>
  activePlayerId: string | null
  page: number
  totalPages: number
  onToggleSelect: (id: string) => void
  onToggleSelectAll: () => void
  onRowClick: (id: string) => void
  onPageChange: (page: number) => void
  loading: boolean
}

const thStyle: React.CSSProperties = {
  fontSize: 10, color: '#6B7280', fontWeight: 700,
  textTransform: 'uppercase' as const, padding: '6px 8px',
  textAlign: 'left', borderBottom: '1px solid #e5e7eb',
}

const tdStyle: React.CSSProperties = {
  fontSize: 11, color: '#111', padding: '6px 8px',
  borderBottom: '1px solid #f3f4f6', verticalAlign: 'middle',
}

const DOT_LABELS = ['Avatar', 'Ranking', 'FIP ID', 'Equipment']

export default function PlayersTable({
  players, selectedIds, activePlayerId, page, totalPages,
  onToggleSelect, onToggleSelectAll, onRowClick, onPageChange, loading,
}: PlayersTableProps) {
  const allSelected = players.length > 0 && players.every(p => selectedIds.has(p.id))

  return (
    <>
      <div style={{
        background: 'white', border: '1px solid #e5e7eb', borderRadius: 8,
        overflow: 'auto', marginBottom: 12, opacity: loading ? 0.6 : 1,
        transition: 'opacity 0.2s',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, width: 32, padding: '6px 6px 6px 10px' }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onToggleSelectAll}
                  style={{ cursor: 'pointer' }}
                />
              </th>
              <th style={{ ...thStyle, width: 48 }} />
              <th style={thStyle}>Name</th>
              <th style={{ ...thStyle, width: 60 }}>Rank</th>
              <th style={{ ...thStyle, width: 50 }}>Cat</th>
              <th style={{ ...thStyle, width: 160 }}>Equipment</th>
              <th style={{ ...thStyle, width: 80 }}>Data</th>
            </tr>
          </thead>
          <tbody>
            {players.map(player => {
              const completeness = computeCompleteness(player)
              const isActive = activePlayerId === player.id
              const isSelected = selectedIds.has(player.id)
              return (
                <tr
                  key={player.id}
                  style={{
                    cursor: 'pointer',
                    background: isActive ? '#F0F7FF' : isSelected ? '#f9fafb' : undefined,
                  }}
                  onClick={() => onRowClick(player.id)}
                >
                  <td style={{ ...tdStyle, padding: '6px 6px 6px 10px' }} onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleSelect(player.id)}
                      style={{ cursor: 'pointer' }}
                    />
                  </td>
                  <td style={{ ...tdStyle, width: 48, padding: '5px 6px' }}>
                    <div style={{ position: 'relative', width: 28, height: 28 }}>
                      {player.avatar_url ? (
                        <img
                          src={player.avatar_url}
                          alt=""
                          style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }}
                        />
                      ) : (
                        <div style={{
                          width: 28, height: 28, borderRadius: '50%',
                          background: '#e5e7eb', display: 'flex', alignItems: 'center',
                          justifyContent: 'center', fontSize: 10, color: '#9ca3af',
                        }}>
                          ?
                        </div>
                      )}
                      {player.country && (
                        <img
                          src={`https://flagcdn.com/w20/${player.country.toLowerCase()}.png`}
                          alt={player.country}
                          style={{
                            position: 'absolute', bottom: -2, right: -4,
                            width: 14, height: 10, objectFit: 'cover',
                            borderRadius: 2, border: '1px solid #fff',
                          }}
                        />
                      )}
                    </div>
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 500 }}>
                    {player.name}
                    {player.display_name && player.display_name !== player.name && (
                      <div style={{ fontSize: 10, color: '#6B7280', fontWeight: 400 }}>{player.display_name}</div>
                    )}
                  </td>
                  <td style={tdStyle}>{player.ranking != null ? `#${player.ranking}` : '—'}</td>
                  <td style={tdStyle}>
                    {player.category && (
                      <span style={{
                        fontSize: 9, fontWeight: 700, textTransform: 'uppercase' as const,
                        padding: '2px 6px', borderRadius: 3,
                        background: player.category === 'men' ? '#DBEAFE' : '#FCE7F3',
                        color: player.category === 'men' ? '#1E40AF' : '#9D174D',
                      }}>
                        {player.category === 'men' ? 'M' : 'W'}
                      </span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, maxWidth: 160 }}>
                    {player.equipment ? (
                      <span style={{ fontSize: 10 }}>
                        <span style={{ fontWeight: 600 }}>{player.equipment.brand}</span>
                        {' '}{player.equipment.model}
                        {player.equipment.year && <span style={{ color: '#9ca3af' }}> {player.equipment.year}</span>}
                      </span>
                    ) : (
                      <span style={{ fontSize: 10, color: '#d1d5db' }}>—</span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {completeness.map((ok, i) => (
                        <div
                          key={i}
                          title={`${DOT_LABELS[i]}: ${ok ? 'Present' : 'Missing'}`}
                          style={{
                            width: 8, height: 8, borderRadius: '50%',
                            background: ok ? '#22c55e' : '#ef4444',
                          }}
                        />
                      ))}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {players.length === 0 && !loading && (
          <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: 12, padding: 24 }}>
            No players found
          </div>
        )}
        {loading && (
          <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: 12, padding: 24 }}>
            Loading...
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, fontSize: 12 }}>
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            style={{
              padding: '4px 10px', fontSize: 11, border: '1px solid #e5e7eb',
              borderRadius: 4, background: '#fff', color: page <= 1 ? '#d1d5db' : '#111',
              cursor: page <= 1 ? 'default' : 'pointer',
            }}
          >
            ← Previous
          </button>
          <span style={{ color: '#6B7280' }}>
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            style={{
              padding: '4px 10px', fontSize: 11, border: '1px solid #e5e7eb',
              borderRadius: 4, background: '#fff', color: page >= totalPages ? '#d1d5db' : '#111',
              cursor: page >= totalPages ? 'default' : 'pointer',
            }}
          >
            Next →
          </button>
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/ops/players/PlayersTable.tsx
git commit -m "feat(ops): add PlayersTable component with checkboxes, completeness dots, pagination"
```

---

### Task 4: BulkActionsBar component

**Files:**
- Create: `src/app/ops/players/BulkActionsBar.tsx`
- Modify: `src/app/api/ops/player-equipment/route.ts`

- [ ] **Step 1: Add bulk equipment assignment to API**

In `src/app/api/ops/player-equipment/route.ts`, add a `PUT` handler for bulk assignment:

```ts
// -- PUT: Bulk assign equipment to multiple players ──────────────
export async function PUT(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const body = await request.json() as { player_ids?: string[]; racket_id?: string }
  const { player_ids, racket_id } = body

  if (!player_ids?.length || !racket_id) {
    return Response.json({ error: 'Missing required fields: player_ids, racket_id' }, { status: 400 })
  }

  const today = new Date().toISOString().split('T')[0]
  let assigned = 0

  for (const playerId of player_ids) {
    // End current assignment if exists
    await supabase
      .from('player_equipment')
      .update({ ended_at: today })
      .eq('player_id', playerId)
      .is('ended_at', null)

    // Create new assignment
    const { error } = await supabase
      .from('player_equipment')
      .insert({ player_id: playerId, racket_id, started_at: today })

    if (!error) assigned++
  }

  return Response.json({ assigned, total: player_ids.length })
}
```

- [ ] **Step 2: Create BulkActionsBar component**

```tsx
'use client'
import React, { useState, useEffect, useCallback } from 'react'

interface BulkActionsBarProps {
  selectedCount: number
  selectedIds: string[]
  onClearSelection: () => void
  onBulkComplete: () => void
}

export default function BulkActionsBar({
  selectedCount, selectedIds, onClearSelection, onBulkComplete,
}: BulkActionsBarProps) {
  const [showEquipModal, setShowEquipModal] = useState(false)
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([])
  const [rackets, setRackets] = useState<{ id: string; model: string; year: number | null }[]>([])
  const [selectedBrand, setSelectedBrand] = useState('')
  const [selectedRacket, setSelectedRacket] = useState('')
  const [assigning, setAssigning] = useState(false)

  const fetchBrands = useCallback(async () => {
    const res = await fetch('/api/ops/brands')
    const json = await res.json()
    setBrands((json.brands ?? []).map((b: any) => ({ id: b.id, name: b.name })))
  }, [])

  useEffect(() => {
    if (showEquipModal && brands.length === 0) fetchBrands()
  }, [showEquipModal, brands.length, fetchBrands])

  useEffect(() => {
    if (!selectedBrand) { setRackets([]); setSelectedRacket(''); return }
    fetch(`/api/ops/rackets?brand_id=${selectedBrand}`)
      .then(r => r.json())
      .then(json => setRackets((json.rackets ?? []).map((r: any) => ({ id: r.id, model: r.model, year: r.year }))))
  }, [selectedBrand])

  const handleAssign = async () => {
    if (!selectedRacket) return
    setAssigning(true)
    try {
      await fetch('/api/ops/player-equipment', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_ids: selectedIds, racket_id: selectedRacket }),
      })
      setShowEquipModal(false)
      setSelectedBrand('')
      setSelectedRacket('')
      onClearSelection()
      onBulkComplete()
    } finally {
      setAssigning(false)
    }
  }

  if (selectedCount === 0) return null

  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 12px', marginBottom: 8, borderRadius: 6,
        background: '#f0f7ff', border: '1px solid #bfdbfe',
      }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#1e40af' }}>
          ✓ {selectedCount} selected
        </span>
        <button
          onClick={() => setShowEquipModal(true)}
          style={{
            fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 4,
            background: '#111', color: '#fff', border: 'none', cursor: 'pointer',
          }}
        >
          Assign Equipment
        </button>
        <span style={{ flex: 1 }} />
        <button
          onClick={onClearSelection}
          style={{
            fontSize: 10, color: '#6B7280', background: 'none', border: 'none', cursor: 'pointer',
          }}
        >
          Clear
        </button>
      </div>

      {/* Bulk equipment modal */}
      {showEquipModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setShowEquipModal(false)}>
          <div style={{
            background: '#fff', borderRadius: 8, padding: 20, width: 360,
            boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#111', marginBottom: 16 }}>
              Assign Equipment to {selectedCount} player{selectedCount > 1 ? 's' : ''}
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 10, color: '#6B7280', fontWeight: 600, display: 'block', marginBottom: 2 }}>Brand</label>
              <select
                value={selectedBrand}
                onChange={e => setSelectedBrand(e.target.value)}
                style={{ width: '100%', padding: '6px 8px', fontSize: 12, border: '1px solid #e5e7eb', borderRadius: 4 }}
              >
                <option value="">Select brand...</option>
                {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 10, color: '#6B7280', fontWeight: 600, display: 'block', marginBottom: 2 }}>Racket</label>
              <select
                value={selectedRacket}
                onChange={e => setSelectedRacket(e.target.value)}
                disabled={!selectedBrand}
                style={{ width: '100%', padding: '6px 8px', fontSize: 12, border: '1px solid #e5e7eb', borderRadius: 4 }}
              >
                <option value="">Select racket...</option>
                {rackets.map(r => <option key={r.id} value={r.id}>{r.model}{r.year ? ` (${r.year})` : ''}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowEquipModal(false)}
                style={{ padding: '6px 14px', fontSize: 11, border: '1px solid #e5e7eb', borderRadius: 6, background: '#fff', color: '#111', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleAssign}
                disabled={!selectedRacket || assigning}
                style={{
                  padding: '6px 14px', fontSize: 11, borderRadius: 6, border: 'none',
                  background: selectedRacket && !assigning ? '#111' : '#d1d5db',
                  color: '#fff', cursor: selectedRacket && !assigning ? 'pointer' : 'default',
                }}
              >
                {assigning ? 'Assigning...' : 'Assign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/ops/players/BulkActionsBar.tsx src/app/api/ops/player-equipment/route.ts
git commit -m "feat(ops): add BulkActionsBar + bulk equipment assignment API"
```

---

### Task 5: PlayerDrawer component

**Files:**
- Create: `src/app/ops/players/PlayerDrawer.tsx`

- [ ] **Step 1: Create PlayerDrawer component**

This is the right overlay drawer. It fetches the full player detail on open, shows a tabbed edit form, handles equipment, and has save/close logic. It receives the player ID and callbacks from PlayersTab.

The drawer needs to:
- Fetch player detail from `/api/ops/players?id=...` on open
- Fetch equipment from `/api/ops/player-equipment?player_id=...`
- Show 3 tabs: Profile, IDs, Equipment
- Have a sticky Save button at the bottom
- Support ↑↓ keyboard navigation (received as onPrev/onNext callbacks)
- Close on Escape key or backdrop click

Create the file at `src/app/ops/players/PlayerDrawer.tsx`. This is a large component (~400 lines) that should be implemented as a self-contained unit. It should import the `PlayerDetail` type from `./types` and use the same field definitions currently in `EDITABLE_FIELDS` from the old PlayersTab.

Key sections:
- Backdrop overlay (semi-transparent black, fixed position, z-index 10000)
- Drawer panel (420px wide, white bg, fixed right, slides in with transition)
- Header: avatar (64px), name, ranking, country
- Tab bar: Profile | IDs | Equipment
- Form fields matching the existing edit panel
- Equipment section: reuse the brand/racket dropdown pattern from old PlayersTab
- Sticky save button at bottom

- [ ] **Step 2: Commit**

```bash
git add src/app/ops/players/PlayerDrawer.tsx
git commit -m "feat(ops): add PlayerDrawer overlay with tabbed edit form and equipment"
```

---

### Task 6: Rewrite PlayersTab as orchestrator

**Files:**
- Modify: `src/app/ops/PlayersTab.tsx`

- [ ] **Step 1: Rewrite PlayersTab**

Slim down the 1,350-line file to an orchestrator that:
- Manages state (search query, filters, pagination, selection, active player)
- Fetches data (search with pagination, filter counts)
- Composes the sub-components: FilterChips, BulkActionsBar, PlayersTable, PlayerDrawer
- Keeps the existing merge flow intact (DuplicatePanel and merge UI stay in this file for now)

The new structure:

```tsx
'use client'
import React, { useState, useCallback, useEffect, useRef } from 'react'
import type { PlayerSummary, DataFilter, CategoryFilter, FilterCounts } from './players/types'
import FilterChips from './players/FilterChips'
import PlayersTable from './players/PlayersTable'
import BulkActionsBar from './players/BulkActionsBar'
import PlayerDrawer from './players/PlayerDrawer'

export default function PlayersTab() {
  // Search
  const [searchQuery, setSearchQuery] = useState('')
  const [results, setResults] = useState<PlayerSummary[]>([])
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  // Filters
  const [dataFilter, setDataFilter] = useState<DataFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [filterCounts, setFilterCounts] = useState<FilterCounts | null>(null)

  // Pagination
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const perPage = 25

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Drawer
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null)

  // ... fetchData, fetchCounts, handlers, effects ...
  // ... existing merge/duplicate state and UI ...

  return (
    <div>
      {/* Search input */}
      {/* FilterChips */}
      {/* BulkActionsBar */}
      {/* PlayersTable */}
      {/* Existing merge/duplicate panel (kept as-is) */}
      {/* PlayerDrawer */}
    </div>
  )
}
```

Key behaviors:
- `fetchData()` calls search API with current query + filters + page
- `fetchCounts()` runs 4 count queries on mount for the filter chip numbers
- Changing filter/category resets to page 1 and clears selection
- Row click sets `activePlayerId` → opens drawer
- Checkbox toggle adds/removes from `selectedIds` set
- ↑↓ in drawer navigates to adjacent players in `results` array

- [ ] **Step 2: Verify build**

Run: `npm run build 2>&1 | grep -E "TypeScript|type check|Compiled|Type error"`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/ops/PlayersTab.tsx
git commit -m "refactor(ops): rewrite PlayersTab as slim orchestrator composing sub-components"
```

---

### Task 7: Final build verification + visual check

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: No TypeScript errors.

- [ ] **Step 2: Visual verification**

Open ops dashboard, go to Players tab:
- Verify filter chips show with counts
- Verify table has checkboxes and completeness dots
- Verify clicking a row opens the right drawer
- Verify pagination controls work
- Verify bulk selection + "Assign Equipment" modal works
- Verify search still works

- [ ] **Step 3: Commit any fixes**

If issues found, fix and commit.

- [ ] **Step 4: Push**

```bash
git push origin claude/badge-system
```

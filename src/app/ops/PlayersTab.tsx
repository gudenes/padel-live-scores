'use client'
// src/app/ops/PlayersTab.tsx
// Player management UI — slim orchestrator composing sub-components.
// Merge/duplicate detection flow is preserved intact here.

import React, { useState, useRef, useCallback, useEffect } from 'react'
import type { PlayerSummary, PlayerDetail, DataFilter, CategoryFilter, FilterCounts } from './players/types'
import FilterChips from './players/FilterChips'
import PlayersTable from './players/PlayersTable'
import BulkActionsBar from './players/BulkActionsBar'
import PlayerDrawer from './players/PlayerDrawer'

// ── Fields to compare during merge ──────────────────────────────
const MERGE_FIELDS: (keyof PlayerDetail)[] = [
  'name', 'display_name', 'country', 'category', 'ranking', 'points', 'ranking_move',
  'external_id', 'fip_id', 'side', 'avatar_url', 'height', 'birthdate',
  'birthplace', 'hand', 'titles', 'finals', 'semifinals',
]

// ── Shared styles ────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'white',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 12,
}

const sectionLabel: React.CSSProperties = {
  fontSize: 10,
  color: '#9ca3af',
  textTransform: 'uppercase' as const,
  fontWeight: 700,
  letterSpacing: 1,
  marginBottom: 8,
}

// ── Component ────────────────────────────────────────────────────

export default function PlayersTab() {
  // ── Search / list state ────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('')
  const [results, setResults] = useState<PlayerSummary[]>([])
  const [searching, setSearching] = useState(false)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [dataFilter, setDataFilter] = useState<DataFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [filterCounts, setFilterCounts] = useState<FilterCounts | null>(null)

  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const perPage = 25

  // ── Selection state ────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // ── Drawer state ───────────────────────────────────────────────
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null)

  // ── Merge state ────────────────────────────────────────────────
  const [mergeMode, setMergeMode] = useState(false)
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerDetail | null>(null)
  const [selectedMatchCount, setSelectedMatchCount] = useState(0)
  const [mergeTarget, setMergeTarget] = useState<PlayerDetail | null>(null)
  const [mergeTargetMatchCount, setMergeTargetMatchCount] = useState(0)
  const [mergeSelections, setMergeSelections] = useState<Record<string, 'a' | 'b'>>({})
  const [mergeSearchQuery, setMergeSearchQuery] = useState('')
  const [mergeSearchResults, setMergeSearchResults] = useState<PlayerSummary[]>([])
  const [mergeSearching, setMergeSearching] = useState(false)
  const mergeSearchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [merging, setMerging] = useState(false)
  const [mergeMessage, setMergeMessage] = useState<string | null>(null)
  const [mergePreview, setMergePreview] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)

  // ── Duplicate scan state ───────────────────────────────────────
  interface DupGroup {
    reasons: string[]
    players: { id: string; name: string; country: string | null; ranking: number | null; points: number | null; category: string | null; avatar_url: string | null; fip_id: string | null; external_id: string | null }[]
    aiVerified?: boolean
    mergeGuidance?: string
  }
  const [dupGroups, setDupGroups] = useState<DupGroup[]>([])
  const [dupScanning, setDupScanning] = useState(false)
  const [dupScanned, setDupScanned] = useState(0)
  const [dupShowPanel, setDupShowPanel] = useState(false)
  const [dupDismissed, setDupDismissed] = useState<Set<string>>(new Set())
  const [dupMerging, setDupMerging] = useState<Set<string>>(new Set())
  const [dupMerged, setDupMerged] = useState<Set<string>>(new Set())
  const [dupMode, setDupMode] = useState<'rules' | 'ai'>('rules')

  // ── Data fetching ──────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    setSearching(true)
    try {
      const params = new URLSearchParams()
      if (searchQuery.trim()) params.set('q', searchQuery.trim())
      if (dataFilter !== 'all') params.set('filter', dataFilter)
      if (categoryFilter !== 'all') params.set('category', categoryFilter)
      params.set('page', String(page))
      params.set('per_page', String(perPage))
      const res = await fetch(`/api/ops/search-players?${params}`)
      if (res.ok) {
        const data = await res.json()
        setResults(data.players ?? [])
        setTotal(data.total ?? 0)
      }
    } catch { /* ignore */ }
    setSearching(false)
  }, [searchQuery, dataFilter, categoryFilter, page])

  const fetchCounts = useCallback(async () => {
    try {
      const base = '/api/ops/search-players?per_page=1'
      const [all, eq, av, rk] = await Promise.all([
        fetch(base).then(r => r.json()),
        fetch(`${base}&filter=missing_equipment`).then(r => r.json()),
        fetch(`${base}&filter=missing_avatar`).then(r => r.json()),
        fetch(`${base}&filter=missing_ranking`).then(r => r.json()),
      ])
      setFilterCounts({
        total: all.total ?? 0,
        missing_equipment: eq.total ?? 0,
        missing_avatar: av.total ?? 0,
        missing_ranking: rk.total ?? 0,
      })
    } catch { /* ignore */ }
  }, [])

  // Debounce search query changes
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(() => {
      fetchData()
    }, 300)
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    }
  }, [searchQuery, fetchData])

  useEffect(() => { fetchCounts() }, [fetchCounts])

  // Refetch when non-search params change (filter/page)
  useEffect(() => {
    fetchData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataFilter, categoryFilter, page])

  // ── Handlers ───────────────────────────────────────────────────

  const handleFilterChange = useCallback((filter: DataFilter) => {
    setDataFilter(filter)
    setPage(1)
    setSelectedIds(new Set())
  }, [])

  const handleCategoryChange = useCallback((category: CategoryFilter) => {
    setCategoryFilter(category)
    setPage(1)
    setSelectedIds(new Set())
  }, [])

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleToggleSelectAll = useCallback(() => {
    setSelectedIds(prev => {
      if (prev.size === results.length) return new Set()
      return new Set(results.map(p => p.id))
    })
  }, [results])

  const handleRowClick = useCallback((id: string) => {
    setActivePlayerId(id)
  }, [])

  const handlePageChange = useCallback((p: number) => {
    setPage(p)
    setSelectedIds(new Set())
  }, [])

  const handleDrawerNavigate = useCallback((dir: 'prev' | 'next') => {
    if (!activePlayerId) return
    const idx = results.findIndex(p => p.id === activePlayerId)
    if (idx === -1) return
    const nextIdx = dir === 'prev' ? idx - 1 : idx + 1
    if (nextIdx >= 0 && nextIdx < results.length) {
      setActivePlayerId(results[nextIdx].id)
    }
  }, [activePlayerId, results])

  // ── Merge: fetch player detail ─────────────────────────────────

  const fetchPlayerDetail = useCallback(async (id: string): Promise<{ player: PlayerDetail; matchCount: number } | null> => {
    try {
      const res = await fetch(`/api/ops/players?id=${id}`)
      if (!res.ok) return null
      const data = await res.json()
      return { player: data.player, matchCount: data.matchCount }
    } catch {
      return null
    }
  }, [])

  // ── Merge: search for Player B ─────────────────────────────────

  const doMergeSearch = useCallback((query: string) => {
    if (mergeSearchDebounceRef.current) clearTimeout(mergeSearchDebounceRef.current)
    if (!query.trim()) {
      setMergeSearchResults([])
      return
    }
    mergeSearchDebounceRef.current = setTimeout(async () => {
      setMergeSearching(true)
      try {
        const catParam = selectedPlayer?.category ? `&category=${selectedPlayer.category}` : ''
        const res = await fetch(`/api/ops/search-players?q=${encodeURIComponent(query)}${catParam}`)
        if (res.ok) {
          const data = await res.json()
          setMergeSearchResults((data.players ?? []).filter((p: PlayerSummary) => p.id !== selectedPlayer?.id))
        }
      } catch { /* ignore */ }
      setMergeSearching(false)
    }, 300)
  }, [selectedPlayer])

  const selectMergeTarget = useCallback(async (id: string) => {
    const detail = await fetchPlayerDetail(id)
    if (detail) {
      setMergeTarget(detail.player)
      setMergeTargetMatchCount(detail.matchCount)
      setMergeSearchResults([])
      setMergeSearchQuery('')
      setMergePreview(false)
      const selections: Record<string, 'a' | 'b'> = {}
      for (const field of MERGE_FIELDS) {
        const aVal = selectedPlayer?.[field]
        const bVal = detail.player[field]
        if (aVal != null && bVal == null) selections[field] = 'a'
        else if (aVal == null && bVal != null) selections[field] = 'b'
        else if (aVal != null && bVal != null) selections[field] = 'a'
      }
      setMergeSelections(selections)
    }
  }, [fetchPlayerDetail, selectedPlayer])

  // ── Execute merge ──────────────────────────────────────────────

  const handleMerge = useCallback(async () => {
    if (!selectedPlayer || !mergeTarget) return
    setMerging(true)
    setMergeMessage(null)
    const mergedFields: Record<string, unknown> = {}
    for (const field of MERGE_FIELDS) {
      const selection = mergeSelections[field]
      if (selection === 'b') mergedFields[field] = mergeTarget[field]
    }
    try {
      const res = await fetch('/api/ops/players/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keepId: selectedPlayer.id, deleteId: mergeTarget.id, mergedFields }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setMergeMessage(`Error: ${body.error ?? 'Merge failed'}`)
      } else {
        const data = await res.json()
        setMergeMessage(`Merged! ${data.matchesUpdated} matches + ${data.drawsUpdated} draws reassigned.`)
        setMergeMode(false)
        setMergeTarget(null)
        setMergePreview(false)
        setSelectedPlayer(null)
        fetchData()
      }
    } catch (e: unknown) {
      setMergeMessage(`Error: ${e instanceof Error ? e.message : 'Merge failed'}`)
    }
    setMerging(false)
  }, [selectedPlayer, mergeTarget, mergeSelections, fetchData])

  // ── Duplicate scan ─────────────────────────────────────────────

  const runDupScan = useCallback(async (mode: 'rules' | 'ai' = 'rules') => {
    setDupScanning(true)
    setDupDismissed(new Set())
    setDupMerged(new Set())
    setDupMode(mode)
    try {
      const params = new URLSearchParams()
      if (categoryFilter !== 'all') params.set('category', categoryFilter)
      params.set('mode', mode)
      const res = await fetch(`/api/ops/duplicate-scan?${params}`)
      if (res.ok) {
        const data = await res.json()
        setDupGroups(data.groups ?? [])
        setDupScanned(data.scanned ?? 0)
        setDupShowPanel(true)
      }
    } catch { /* ignore */ }
    setDupScanning(false)
  }, [categoryFilter])

  const directMergeFromDup = useCallback(async (keepPlayer: DupGroup['players'][0], deletePlayer: DupGroup['players'][0], groupKey: string) => {
    setDupMerging(prev => { const s = new Set(prev); s.add(groupKey); return s })
    try {
      const mergedFields: Record<string, unknown> = {}
      const fieldKeys = ['name', 'country', 'category', 'ranking', 'points', 'fip_id', 'external_id', 'avatar_url'] as const
      for (const key of fieldKeys) {
        const keepVal = keepPlayer[key as keyof typeof keepPlayer]
        const delVal = deletePlayer[key as keyof typeof deletePlayer]
        if (keepVal != null && keepVal !== '') mergedFields[key] = keepVal
        else if (delVal != null && delVal !== '') mergedFields[key] = delVal
      }
      const res = await fetch('/api/ops/players/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keepId: keepPlayer.id, deleteId: deletePlayer.id, mergedFields }),
      })
      if (res.ok) {
        const data = await res.json()
        setDupMerged(prev => { const s = new Set(prev); s.add(groupKey); return s })
        console.log(`[Dup Merge] Kept ${keepPlayer.name}, deleted ${deletePlayer.name}. Matches: ${data.matchesUpdated}, draws: ${data.drawsUpdated}`)
      } else {
        const err = await res.json().catch(() => ({}))
        console.error('[Dup Merge] Failed:', err.error ?? res.status)
        alert(`Merge failed: ${err.error ?? 'Unknown error'}`)
      }
    } catch (e) {
      console.error('[Dup Merge] Error:', e)
      alert('Merge failed — check console')
    }
    setDupMerging(prev => { const s = new Set(prev); s.delete(groupKey); return s })
  }, [])

  const startMergeFromDup = useCallback(async (keepId: string, deleteId: string) => {
    setDupShowPanel(false)
    setLoadingDetail(true)
    try {
      const keepRes = await fetch(`/api/ops/players?id=${keepId}`)
      if (!keepRes.ok) return
      const keepData = await keepRes.json()
      setSelectedPlayer(keepData.player)
      setSelectedMatchCount(keepData.matchCount ?? 0)
      setMergeMode(true)
      const delRes = await fetch(`/api/ops/players?id=${deleteId}`)
      if (!delRes.ok) return
      const delData = await delRes.json()
      setMergeTarget(delData.player)
      setMergeTargetMatchCount(delData.matchCount ?? 0)
      const selections: Record<string, 'a' | 'b'> = {}
      for (const field of MERGE_FIELDS) {
        const valA = keepData.player[field]
        const valB = delData.player[field]
        if (valA != null && valA !== '') selections[field] = 'a'
        else if (valB != null && valB !== '') selections[field] = 'b'
        else selections[field] = 'a'
      }
      setMergeSelections(selections)
      setMergePreview(false)
    } catch { /* ignore */ }
    setLoadingDetail(false)
  }, [])

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="players-tab">
      <style>{`
        .players-tab input, .players-tab select, .players-tab textarea { color: #111 !important; }
      `}</style>

      {/* Search bar + dup scan buttons */}
      <div style={{ ...card, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search players by name..."
          style={{
            flex: 1, padding: '7px 10px', fontSize: 12,
            border: '1px solid #d1d5db', borderRadius: 6,
          }}
        />
        {searching && <span style={{ fontSize: 10, color: '#9ca3af' }}>Searching...</span>}
        <button
          onClick={() => runDupScan('rules')}
          disabled={dupScanning}
          style={{
            padding: '5px 12px', fontSize: 11, fontWeight: 600, cursor: dupScanning ? 'default' : 'pointer',
            border: '1px solid #fbbf24', borderRadius: 4,
            background: dupShowPanel && dupMode === 'rules' ? '#fef3c7' : '#fffbeb', color: '#92400e',
            opacity: dupScanning ? 0.6 : 1, whiteSpace: 'nowrap' as const,
          }}
        >
          {dupScanning && dupMode === 'rules' ? 'Scanning...' : '⚠️ Rules Scan'}
        </button>
        <button
          onClick={() => runDupScan('ai')}
          disabled={dupScanning}
          style={{
            padding: '5px 12px', fontSize: 11, fontWeight: 600, cursor: dupScanning ? 'default' : 'pointer',
            border: '1px solid #8b5cf6', borderRadius: 4,
            background: dupShowPanel && dupMode === 'ai' ? '#ede9fe' : '#f5f3ff', color: '#6d28d9',
            opacity: dupScanning ? 0.6 : 1, whiteSpace: 'nowrap' as const,
          }}
        >
          {dupScanning && dupMode === 'ai' ? '🤖 AI Scanning...' : '🤖 AI Scan'}
        </button>
      </div>

      {/* Filter chips */}
      <FilterChips
        counts={filterCounts}
        activeFilter={dataFilter}
        activeCategory={categoryFilter}
        onFilterChange={handleFilterChange}
        onCategoryChange={handleCategoryChange}
      />

      {/* Duplicate scan results panel */}
      {dupShowPanel && (
        <div style={{ ...card, marginBottom: 12, background: '#fffbeb', border: '1px solid #fbbf24' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#92400e' }}>
                {dupGroups.length - dupDismissed.size > 0
                  ? `⚠️ ${dupGroups.length - dupDismissed.size} potential duplicate group${dupGroups.length - dupDismissed.size !== 1 ? 's' : ''} found`
                  : '✓ All duplicates resolved'}
                <span style={{ fontSize: 10, color: '#b45309', marginLeft: 6 }}>({dupScanned} players scanned)</span>
              </div>
            </div>
            <button
              onClick={() => setDupShowPanel(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 14 }}
            >✕</button>
          </div>

          {dupGroups.length === 0 && (
            <div style={{ fontSize: 11, color: '#6B7280', padding: '8px 0' }}>No duplicates found. Your player database is clean!</div>
          )}

          <div style={{ maxHeight: 400, overflowY: 'auto' as const }}>
            {dupGroups.map((group, gi) => {
              const groupKey = group.players.map(p => p.id).sort().join('|')
              if (dupDismissed.has(groupKey)) return null
              const [a, b] = group.players
              const richness = (p: typeof a) => {
                let s = 0
                if (p.name) s += 1
                if (p.country) s += 1
                if (p.ranking !== null) s += 2
                if (p.points !== null) s += 1
                if (p.fip_id) s += 2
                if (p.external_id) s += 1
                return s
              }
              const scoreA = richness(a)
              const scoreB = richness(b)
              const recommended = scoreA >= scoreB ? 'a' : 'b'

              return (
                <div key={gi} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: 10, marginBottom: 6 }}>
                  <div style={{ fontSize: 10, color: '#6B7280', marginBottom: 6 }}>
                    {group.reasons.map((r, ri) => (
                      <span key={ri} style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 3, background: '#fef3c7', color: '#92400e', fontSize: 9, fontWeight: 600, marginRight: 4 }}>{r}</span>
                    ))}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                    {[a, b].map((p, pi) => {
                      const isRec = (pi === 0 && recommended === 'a') || (pi === 1 && recommended === 'b')
                      return (
                        <div key={p.id} style={{ padding: 6, background: isRec ? '#f0fdf4' : '#f9fafb', borderRadius: 4, border: isRec ? '1px solid #86efac' : '1px solid #e5e7eb' }}>
                          <div style={{ fontSize: 9, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' as const, marginBottom: 2 }}>
                            Player {pi === 0 ? 'A' : 'B'} {isRec && <span style={{ color: '#16a34a' }}>★ Richer</span>}
                          </div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#111' }}>{p.name}</div>
                          <div style={{ fontSize: 10, color: '#6B7280' }}>
                            {p.country ?? '—'} · Rank: {p.ranking ?? '—'} · Pts: {p.points?.toLocaleString() ?? '—'}
                          </div>
                          <div style={{ fontSize: 9, color: '#9ca3af' }}>
                            {p.category ?? '—'} · FIP: {p.fip_id ?? '—'} · ID: {p.id.slice(0, 8)}...
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  {group.mergeGuidance && (
                    <div style={{
                      padding: '6px 10px', background: '#f5f3ff', borderRadius: 4,
                      border: '1px solid #ddd6fe', marginBottom: 8, fontSize: 11, color: '#5b21b6',
                    }}>
                      <span style={{ fontWeight: 700 }}>🤖 AI recommendation:</span> {group.mergeGuidance}
                    </div>
                  )}
                  {dupMerged.has(groupKey) ? (
                    <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>✓ Merged successfully</div>
                  ) : (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
                      <button
                        onClick={() => {
                          const keep = recommended === 'a' ? a : b
                          const del = recommended === 'a' ? b : a
                          directMergeFromDup(keep, del, groupKey)
                        }}
                        disabled={dupMerging.has(groupKey)}
                        style={{
                          fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 4,
                          border: 'none', cursor: dupMerging.has(groupKey) ? 'default' : 'pointer',
                          background: '#22c55e', color: '#fff',
                          opacity: dupMerging.has(groupKey) ? 0.6 : 1,
                        }}
                      >
                        {dupMerging.has(groupKey) ? 'Merging...' : `⚡ Quick merge → keep ${recommended === 'a' ? 'A' : 'B'}`}
                      </button>
                      <button
                        onClick={() => {
                          const keep = recommended === 'a' ? b : a
                          const del = recommended === 'a' ? a : b
                          directMergeFromDup(keep, del, groupKey)
                        }}
                        disabled={dupMerging.has(groupKey)}
                        style={{
                          fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 4,
                          border: '1px solid #d1d5db', cursor: dupMerging.has(groupKey) ? 'default' : 'pointer',
                          background: '#fff', color: '#111',
                          opacity: dupMerging.has(groupKey) ? 0.6 : 1,
                        }}
                      >
                        Keep {recommended === 'a' ? 'B' : 'A'} instead
                      </button>
                      <button
                        onClick={() => {
                          const keepId = recommended === 'a' ? a.id : b.id
                          const deleteId = recommended === 'a' ? b.id : a.id
                          startMergeFromDup(keepId, deleteId)
                          setDupDismissed(prev => { const s = new Set(prev); s.add(groupKey); return s })
                        }}
                        disabled={dupMerging.has(groupKey)}
                        style={{
                          fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 4,
                          border: '1px solid #d1d5db', cursor: 'pointer', background: '#fff', color: '#6B7280',
                        }}
                      >
                        Review fields...
                      </button>
                      <button
                        onClick={() => setDupDismissed(prev => { const s = new Set(prev); s.add(groupKey); return s })}
                        disabled={dupMerging.has(groupKey)}
                        style={{
                          fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 4,
                          border: '1px solid #d1d5db', cursor: 'pointer', background: '#fff', color: '#9ca3af',
                        }}
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Bulk actions bar */}
      <BulkActionsBar
        selectedCount={selectedIds.size}
        selectedIds={Array.from(selectedIds)}
        onClearSelection={() => setSelectedIds(new Set())}
        onBulkComplete={() => { fetchData(); fetchCounts() }}
      />

      {/* Players table */}
      <PlayersTable
        players={results}
        selectedIds={selectedIds}
        activePlayerId={activePlayerId}
        page={page}
        totalPages={Math.ceil(total / perPage)}
        onToggleSelect={handleToggleSelect}
        onToggleSelectAll={handleToggleSelectAll}
        onRowClick={handleRowClick}
        onPageChange={handlePageChange}
        loading={searching}
      />

      {/* Merge mode — detailed field comparison panel */}
      {loadingDetail && (
        <div style={{ ...card, textAlign: 'center', color: '#9ca3af', fontSize: 12, marginBottom: 12 }}>
          Loading player details...
        </div>
      )}

      {selectedPlayer && !loadingDetail && mergeMode && (
        <div style={{ ...card, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>Merge Players</span>
            <button
              onClick={() => { setMergeMode(false); setMergeTarget(null); setMergePreview(false); setMergeMessage(null); setSelectedPlayer(null) }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#9ca3af', padding: '2px 6px' }}
            >
              &times;
            </button>
          </div>

          {mergeMessage && (
            <div style={{
              marginBottom: 10, padding: '6px 10px', borderRadius: 4, fontSize: 11,
              background: mergeMessage.startsWith('Error') ? '#FEF2F2' : '#F0FDF4',
              color: mergeMessage.startsWith('Error') ? '#991B1B' : '#166534',
              border: mergeMessage.startsWith('Error') ? '1px solid #FECACA' : '1px solid #BBF7D0',
            }}>
              {mergeMessage}
            </div>
          )}

          <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
            {/* Player A */}
            <div style={{ flex: 1 }}>
              <div style={sectionLabel}>Player A (Keep)</div>
              <div style={{ padding: 10, border: '1px solid #BBF7D0', borderRadius: 6, background: '#F0FDF4' }}>
                <div style={{ fontWeight: 600, fontSize: 12, color: '#111' }}>{selectedPlayer.name}</div>
                <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2 }}>
                  {selectedPlayer.country ?? 'No country'} &middot; Rank #{selectedPlayer.ranking ?? '—'} &middot; {selectedMatchCount} matches
                </div>
              </div>
            </div>

            {/* Player B */}
            <div style={{ flex: 1 }}>
              <div style={sectionLabel}>Player B (Delete)</div>
              {!mergeTarget ? (
                <div>
                  <input
                    type="text"
                    value={mergeSearchQuery}
                    onChange={e => { setMergeSearchQuery(e.target.value); doMergeSearch(e.target.value) }}
                    placeholder="Search for player to merge..."
                    style={{ width: '100%', padding: '7px 10px', fontSize: 11, border: '1px solid #d1d5db', borderRadius: 4, boxSizing: 'border-box' }}
                  />
                  {mergeSearching && <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 4 }}>Searching...</div>}
                  {mergeSearchResults.length > 0 && (
                    <div style={{ border: '1px solid #e5e7eb', borderRadius: 4, marginTop: 4, maxHeight: 180, overflowY: 'auto' }}>
                      {mergeSearchResults.map(r => (
                        <div
                          key={r.id}
                          onClick={() => selectMergeTarget(r.id)}
                          style={{ padding: '6px 8px', cursor: 'pointer', fontSize: 11, borderBottom: '1px solid #f3f4f6' }}
                          onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                          <span style={{ fontWeight: 500, color: '#111' }}>{r.name}</span>
                          {r.country && <span style={{ color: '#9ca3af', marginLeft: 4 }}>({r.country})</span>}
                          {r.ranking && <span style={{ color: '#6B7280', fontSize: 10, marginLeft: 4 }}>#{r.ranking}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ padding: 10, border: '1px solid #FECACA', borderRadius: 6, background: '#FEF2F2' }}>
                  <div style={{ fontWeight: 600, fontSize: 12, color: '#111' }}>{mergeTarget.name}</div>
                  <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2 }}>
                    {mergeTarget.country ?? 'No country'} &middot; Rank #{mergeTarget.ranking ?? '—'} &middot; {mergeTargetMatchCount} matches
                  </div>
                  <button
                    onClick={() => { setMergeTarget(null); setMergePreview(false) }}
                    style={{ marginTop: 6, padding: '2px 8px', fontSize: 10, fontWeight: 600, background: 'white', border: '1px solid #d1d5db', borderRadius: 3, cursor: 'pointer', color: '#6B7280' }}
                  >
                    Change
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Field comparison table */}
          {mergeTarget && (
            <>
              <div style={{ ...card, padding: 0, overflow: 'auto', marginBottom: 12, border: '1px solid #e5e7eb' }}>
                <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
                      <th style={{ ...sectionLabel, padding: '6px 8px', textAlign: 'left', marginBottom: 0, width: 100 }}>Field</th>
                      <th style={{ ...sectionLabel, padding: '6px 8px', textAlign: 'left', marginBottom: 0 }}>Player A (Keep)</th>
                      <th style={{ ...sectionLabel, padding: '6px 8px', textAlign: 'center', marginBottom: 0, width: 50 }}>Pick</th>
                      <th style={{ ...sectionLabel, padding: '6px 8px', textAlign: 'left', marginBottom: 0 }}>Player B (Delete)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {MERGE_FIELDS.map(field => {
                      const aVal = selectedPlayer[field]
                      const bVal = mergeTarget[field]
                      const bothNonNull = aVal != null && aVal !== '' && bVal != null && bVal !== ''
                      const isConflict = bothNonNull && String(aVal) !== String(bVal)
                      return (
                        <tr key={field} style={{ borderBottom: '1px solid #f3f4f6', background: isConflict ? '#FFF7ED' : undefined }}>
                          <td style={{ padding: '5px 8px', fontWeight: 600, color: '#6B7280', fontSize: 10 }}>{field}</td>
                          <td style={{ padding: '5px 8px', color: '#111', fontWeight: mergeSelections[field] === 'a' ? 600 : 400, opacity: mergeSelections[field] === 'b' ? 0.5 : 1 }}>
                            {aVal != null ? String(aVal) : <span style={{ color: '#d1d5db' }}>null</span>}
                          </td>
                          <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                            {(aVal != null || bVal != null) && (
                              <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                                <label style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
                                  <input type="radio" name={`merge-${field}`} checked={mergeSelections[field] === 'a'} onChange={() => setMergeSelections(prev => ({ ...prev, [field]: 'a' }))} style={{ margin: 0 }} />
                                  A
                                </label>
                                <label style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
                                  <input type="radio" name={`merge-${field}`} checked={mergeSelections[field] === 'b'} onChange={() => setMergeSelections(prev => ({ ...prev, [field]: 'b' }))} style={{ margin: 0 }} />
                                  B
                                </label>
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '5px 8px', color: '#111', fontWeight: mergeSelections[field] === 'b' ? 600 : 400, opacity: mergeSelections[field] === 'a' ? 0.5 : 1 }}>
                            {bVal != null ? String(bVal) : <span style={{ color: '#d1d5db' }}>null</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Merge actions */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {!mergePreview ? (
                  <button
                    onClick={() => setMergePreview(true)}
                    style={{ padding: '6px 14px', fontSize: 11, fontWeight: 600, background: '#F5A623', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}
                  >
                    Preview Merge
                  </button>
                ) : (
                  <>
                    <div style={{ flex: 1, padding: '8px 10px', borderRadius: 6, fontSize: 11, background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B' }}>
                      Will reassign {mergeTargetMatchCount} matches and draw entries from <strong>{mergeTarget.name}</strong> to <strong>{selectedPlayer.name}</strong>. Player B will be deleted.
                    </div>
                    <button
                      onClick={handleMerge}
                      disabled={merging}
                      style={{ padding: '6px 14px', fontSize: 11, fontWeight: 600, background: '#FF4655', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', opacity: merging ? 0.6 : 1, whiteSpace: 'nowrap' }}
                    >
                      {merging ? 'Merging...' : 'Confirm Merge'}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Player drawer (edit panel) */}
      <PlayerDrawer
        playerId={activePlayerId}
        onClose={() => setActivePlayerId(null)}
        onSaved={() => fetchData()}
        onNavigate={handleDrawerNavigate}
      />
    </div>
  )
}

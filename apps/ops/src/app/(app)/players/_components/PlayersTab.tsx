'use client'
// src/app/ops/PlayersTab.tsx
// Player management UI — slim orchestrator composing sub-components.
// Merge/duplicate detection flow is preserved intact here.

import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import type { PlayerSummary, PlayerDetail, DataFilter, CategoryFilter, FilterCounts } from './types'
import FilterChips from './FilterChips'
import PlayersTable from './PlayersTable'
import BulkActionsBar from './BulkActionsBar'
import AddRacketModal from './AddRacketModal'
import DuplicatePlayersPanel from '@/components/DuplicatePlayersPanel'
import { useOpenPlayerDrawer, useRegisterDrawerCallbacks } from '@/components/player-drawer-context'
import { PageHeader, Panel, Button } from '@/components/ui'

// ── Fields to compare during merge ──────────────────────────────
const MERGE_FIELDS: (keyof PlayerDetail)[] = [
  'name', 'display_name', 'country', 'category', 'ranking', 'points', 'ranking_move',
  'external_id', 'fip_id', 'side', 'avatar_url', 'height', 'birthdate',
  'birthplace', 'hand', 'titles', 'finals', 'semifinals',
]

// ── Shared styles ────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--r-sm)',
  padding: 12,
}

const sectionLabel: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--text-3)',
  textTransform: 'uppercase' as const,
  fontWeight: 700,
  letterSpacing: 1,
  marginBottom: 8,
}

// ── Component ────────────────────────────────────────────────────

export default function PlayersTab() {
  // ── Router / query-param wiring ────────────────────────────────
  const searchParams = useSearchParams()
  const router = useRouter()
  const drawerParamConsumedRef = useRef(false)

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

  // ── Drawer state — sourced from the global PlayerDrawerProvider so any
  //    surface (Matches, Draws, OOP, …) can also open the drawer. PlayersTab
  //    still drives ↑/↓ navigation + onSaved refresh via useRegisterDrawerCallbacks.
  const drawer = useOpenPlayerDrawer()
  const activePlayerId = drawer.openPlayerId

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

  // ── Add racket (catalog-only) state ────────────────────────────
  const [showAddRacket, setShowAddRacket] = useState(false)

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
      const res = await fetch(`/api/internal/search-players?${params}`)
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
      const base = '/api/internal/search-players?per_page=1'
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

  // On mount, honor ?drawer=<id> — open that player in the drawer and clear
  // the param so it doesn't re-fire on re-renders or back-nav. ref-guarded
  // to prevent a feedback loop if the URL refreshes before router.replace lands.
  useEffect(() => {
    if (drawerParamConsumedRef.current) return
    const drawerId = searchParams.get('drawer')
    if (!drawerId) return
    drawerParamConsumedRef.current = true
    drawer.open(drawerId)
    router.replace('/players')
  }, [searchParams, router, drawer])

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
    drawer.open(id)
  }, [drawer])

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
      drawer.open(results[nextIdx].id)
    }
  }, [activePlayerId, results, drawer])

  // Register list-aware drawer callbacks. The host (mounted in (app)/layout.tsx)
  // forwards onSaved + onNavigate through these refs.
  useRegisterDrawerCallbacks({
    onSaved: fetchData,
    onNavigate: handleDrawerNavigate,
  })

  // ── Merge: fetch player detail ─────────────────────────────────

  const fetchPlayerDetail = useCallback(async (id: string): Promise<{ player: PlayerDetail; matchCount: number } | null> => {
    try {
      const res = await fetch(`/api/internal/players?id=${id}`)
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
        const res = await fetch(`/api/internal/search-players?q=${encodeURIComponent(query)}${catParam}`)
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
      const res = await fetch('/api/internal/players/merge', {
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

  // ── Per-field merge editor (entry point from DuplicatePlayersPanel) ──

  const startMergeFromDup = useCallback(async (keepId: string, deleteId: string) => {
    setLoadingDetail(true)
    try {
      const keepRes = await fetch(`/api/internal/players?id=${keepId}`)
      if (!keepRes.ok) return
      const keepData = await keepRes.json()
      setSelectedPlayer(keepData.player)
      setSelectedMatchCount(keepData.matchCount ?? 0)
      setMergeMode(true)
      const delRes = await fetch(`/api/internal/players?id=${deleteId}`)
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

  // ── Swap which player is kept vs deleted ───────────────────────
  // With the "select 2" entry point neither player is implicitly the
  // survivor, so let the operator flip A↔B. Values flip too, so invert
  // the per-field picks to preserve what was chosen.
  const handleSwapMergeSides = useCallback(() => {
    if (!selectedPlayer || !mergeTarget) return
    const a = selectedPlayer
    const aCount = selectedMatchCount
    setSelectedPlayer(mergeTarget)
    setSelectedMatchCount(mergeTargetMatchCount)
    setMergeTarget(a)
    setMergeTargetMatchCount(aCount)
    setMergeSelections(prev => {
      const next: Record<string, 'a' | 'b'> = {}
      for (const [field, side] of Object.entries(prev)) next[field] = side === 'a' ? 'b' : 'a'
      return next
    })
    setMergePreview(false)
  }, [selectedPlayer, mergeTarget, selectedMatchCount, mergeTargetMatchCount])

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="ui-page">
      <PageHeader
        title="Players"
        actions={
          <>
            <input
              type="text"
              className="ui-input"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search players by name..."
              style={{ width: 260 }}
            />
            {searching && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Searching...</span>}
            <Button onClick={() => setShowAddRacket(true)}>+ Add racket</Button>
          </>
        }
      />

      {/* Filter chips */}
      <FilterChips
        counts={filterCounts}
        activeFilter={dataFilter}
        activeCategory={categoryFilter}
        onFilterChange={handleFilterChange}
        onCategoryChange={handleCategoryChange}
      />

      {/* Duplicate-scan panel (shared with /needs-review). Owns its own scan-mode
          buttons + results UI. Category is passed through so the "scan by category"
          behavior the dup-scan buttons used to have is preserved. */}
      <DuplicatePlayersPanel
        category={categoryFilter}
        onMerged={fetchData}
        onReviewFields={startMergeFromDup}
      />

      {/* Bulk actions bar */}
      <BulkActionsBar
        selectedCount={selectedIds.size}
        selectedIds={Array.from(selectedIds)}
        onClearSelection={() => setSelectedIds(new Set())}
        onBulkComplete={() => { fetchData(); fetchCounts() }}
        onMergeSelected={(ids) => { startMergeFromDup(ids[0], ids[1]); setSelectedIds(new Set()) }}
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
        <div style={{ ...card, textAlign: 'center', color: 'var(--text-3)', fontSize: 12, marginBottom: 12 }}>
          Loading player details...
        </div>
      )}

      {selectedPlayer && !loadingDetail && mergeMode && (
        <div style={{ marginBottom: 12 }}>
        <Panel
          title="Merge Players"
          actions={
            <>
              {mergeTarget && (
                <Button variant="ghost" size="sm" onClick={handleSwapMergeSides}>
                  &#8646; Swap A/B
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setMergeMode(false); setMergeTarget(null); setMergePreview(false); setMergeMessage(null); setSelectedPlayer(null) }}
              >
                &times;
              </Button>
            </>
          }
        >
          {mergeMessage && (
            <div style={{
              marginBottom: 10, padding: '6px 10px', borderRadius: 'var(--r-sm)', fontSize: 11,
              background: mergeMessage.startsWith('Error') ? 'var(--live-bg)' : 'var(--lime-bg)',
              color: mergeMessage.startsWith('Error') ? 'var(--live-text)' : 'var(--lime-text)',
              border: mergeMessage.startsWith('Error') ? '1px solid var(--live-border)' : '1px solid var(--lime-border)',
            }}>
              {mergeMessage}
            </div>
          )}

          <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
            {/* Player A */}
            <div style={{ flex: 1 }}>
              <div style={sectionLabel}>Player A (Keep)</div>
              <div style={{ padding: 10, border: '1px solid var(--lime-border)', borderRadius: 'var(--r-sm)', background: 'var(--lime-bg)' }}>
                <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-1)' }}>{selectedPlayer.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text-2)', marginTop: 2 }}>
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
                    className="ui-input"
                    value={mergeSearchQuery}
                    onChange={e => { setMergeSearchQuery(e.target.value); doMergeSearch(e.target.value) }}
                    placeholder="Search for player to merge..."
                    style={{ width: '100%', fontSize: 11, boxSizing: 'border-box' }}
                  />
                  {mergeSearching && <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>Searching...</div>}
                  {mergeSearchResults.length > 0 && (
                    <div style={{ border: '1px solid var(--border-card)', borderRadius: 'var(--r-sm)', marginTop: 4, maxHeight: 180, overflowY: 'auto' }}>
                      {mergeSearchResults.map(r => (
                        <div
                          key={r.id}
                          onClick={() => selectMergeTarget(r.id)}
                          style={{ padding: '6px 8px', cursor: 'pointer', fontSize: 11, borderBottom: '1px solid var(--border-inner)' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                          <span style={{ fontWeight: 500, color: 'var(--text-1)' }}>{r.name}</span>
                          {r.country && <span style={{ color: 'var(--text-3)', marginLeft: 4 }}>({r.country})</span>}
                          {r.ranking && <span style={{ color: 'var(--text-2)', fontSize: 10, marginLeft: 4 }}>#{r.ranking}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ padding: 10, border: '1px solid var(--live-border)', borderRadius: 'var(--r-sm)', background: 'var(--live-bg)' }}>
                  <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-1)' }}>{mergeTarget.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-2)', marginTop: 2 }}>
                    {mergeTarget.country ?? 'No country'} &middot; Rank #{mergeTarget.ranking ?? '—'} &middot; {mergeTargetMatchCount} matches
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <Button size="sm" onClick={() => { setMergeTarget(null); setMergePreview(false) }}>
                      Change
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Field comparison table */}
          {mergeTarget && (
            <>
              <div style={{ ...card, padding: 0, overflow: 'auto', marginBottom: 12 }}>
                <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-card)', background: 'var(--bg-card-2)' }}>
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
                        <tr key={field} style={{ borderBottom: '1px solid var(--border-inner)', background: isConflict ? 'var(--orange-bg)' : undefined }}>
                          <td style={{ padding: '5px 8px', fontWeight: 600, color: 'var(--text-2)', fontSize: 10 }}>{field}</td>
                          <td style={{ padding: '5px 8px', color: 'var(--text-1)', fontWeight: mergeSelections[field] === 'a' ? 600 : 400, opacity: mergeSelections[field] === 'b' ? 0.5 : 1 }}>
                            {aVal != null ? String(aVal) : <span style={{ color: 'var(--text-4)' }}>null</span>}
                          </td>
                          <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                            {(aVal != null || bVal != null) && (
                              <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                                <label style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 2, cursor: 'pointer', color: 'var(--text-2)' }}>
                                  <input type="radio" name={`merge-${field}`} checked={mergeSelections[field] === 'a'} onChange={() => setMergeSelections(prev => ({ ...prev, [field]: 'a' }))} style={{ margin: 0, accentColor: 'var(--lime)' }} />
                                  A
                                </label>
                                <label style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 2, cursor: 'pointer', color: 'var(--text-2)' }}>
                                  <input type="radio" name={`merge-${field}`} checked={mergeSelections[field] === 'b'} onChange={() => setMergeSelections(prev => ({ ...prev, [field]: 'b' }))} style={{ margin: 0, accentColor: 'var(--lime)' }} />
                                  B
                                </label>
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '5px 8px', color: 'var(--text-1)', fontWeight: mergeSelections[field] === 'b' ? 600 : 400, opacity: mergeSelections[field] === 'a' ? 0.5 : 1 }}>
                            {bVal != null ? String(bVal) : <span style={{ color: 'var(--text-4)' }}>null</span>}
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
                  <Button variant="primary" size="sm" onClick={() => setMergePreview(true)}>
                    Preview Merge
                  </Button>
                ) : (
                  <>
                    <div style={{ flex: 1, padding: '8px 10px', borderRadius: 'var(--r-sm)', fontSize: 11, background: 'var(--live-bg)', border: '1px solid var(--live-border)', color: 'var(--live-text)' }}>
                      Will reassign {mergeTargetMatchCount} matches and draw entries from <strong>{mergeTarget.name}</strong> to <strong>{selectedPlayer.name}</strong>. Player B will be deleted.
                    </div>
                    <Button variant="danger" size="sm" onClick={handleMerge} disabled={merging}>
                      {merging ? 'Merging...' : 'Confirm Merge'}
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
        </Panel>
        </div>
      )}

      {/* Player drawer is rendered globally by PlayerDrawerHost in (app)/layout.tsx.
          PlayersTab registers onSaved + onNavigate via useRegisterDrawerCallbacks
          above so list refresh + ↑/↓ navigation still work. */}

      {/* Standalone "+ Add racket" catalog modal (no player assignment) */}
      {showAddRacket && (
        <AddRacketModal onClose={() => setShowAddRacket(false)} />
      )}
    </div>
  )
}

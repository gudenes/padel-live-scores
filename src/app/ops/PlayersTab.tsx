'use client'
// src/app/ops/PlayersTab.tsx
// Player management UI — search, edit, and merge players from the ops dashboard

import React, { useState, useRef, useCallback, useEffect } from 'react'

// ── Types ────────────────────────────────────────────────────────

interface PlayerSummary {
  id: string
  name: string
  display_name: string | null
  country: string | null
  ranking: number | null
  points: number | null
  category: string | null
  avatar_url: string | null
}

interface PlayerDetail {
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

type CategoryFilter = 'all' | 'men' | 'women'

// Fields displayed in the edit panel
const EDITABLE_FIELDS: { key: keyof PlayerDetail; label: string; type: 'text' | 'number' | 'date' }[] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'display_name', label: 'Display Name', type: 'text' },
  { key: 'country', label: 'Country', type: 'text' },
  { key: 'category', label: 'Category', type: 'text' },
  { key: 'ranking', label: 'Ranking', type: 'number' },
  { key: 'points', label: 'Points', type: 'number' },
  { key: 'ranking_move', label: 'Ranking Move', type: 'number' },
  { key: 'external_id', label: 'External ID', type: 'text' },
  { key: 'fip_id', label: 'FIP ID', type: 'text' },
  { key: 'side', label: 'Side', type: 'text' },
  { key: 'avatar_url', label: 'Avatar URL', type: 'text' },
  { key: 'height', label: 'Height', type: 'text' },
  { key: 'birthdate', label: 'Birthdate', type: 'date' },
  { key: 'birthplace', label: 'Birthplace', type: 'text' },
  { key: 'hand', label: 'Hand', type: 'text' },
  { key: 'titles', label: 'Titles', type: 'number' },
  { key: 'finals', label: 'Finals', type: 'number' },
  { key: 'semifinals', label: 'Semifinals', type: 'number' },
]

// Fields to compare during merge
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
  color: '#999',
  textTransform: 'uppercase' as const,
  fontWeight: 700,
  letterSpacing: 1,
  marginBottom: 8,
}

// ── Component ────────────────────────────────────────────────────

export default function PlayersTab() {
  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [results, setResults] = useState<PlayerSummary[]>([])
  const [searching, setSearching] = useState(false)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Detail/Edit state
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerDetail | null>(null)
  const [selectedMatchCount, setSelectedMatchCount] = useState(0)
  const [editFields, setEditFields] = useState<Record<string, unknown>>({})
  const [equipmentFields, setEquipmentFields] = useState<{
    racket_brand: string; racket_model: string; racket_url: string; racket_image: string; brand_logo: string
  }>({ racket_brand: '', racket_model: '', racket_url: '', racket_image: '', brand_logo: '' })
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [savingPlayer, setSavingPlayer] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  // Merge state
  const [mergeMode, setMergeMode] = useState(false)
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

  // Duplicate scan state
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
  const [dupMerging, setDupMerging] = useState<Set<string>>(new Set()) // groups currently being merged
  const [dupMerged, setDupMerged] = useState<Set<string>>(new Set())   // groups successfully merged

  const [dupMode, setDupMode] = useState<'rules' | 'ai'>('rules')

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

  // Direct merge from scan results — no intermediate step
  const directMergeFromDup = useCallback(async (keepPlayer: DupGroup['players'][0], deletePlayer: DupGroup['players'][0], groupKey: string) => {
    setDupMerging(prev => { const s = new Set(prev); s.add(groupKey); return s })
    try {
      // Build merged fields: for each field, pick the non-null value from keep, fallback to delete
      const mergedFields: Record<string, unknown> = {}
      const fieldKeys = ['name', 'country', 'category', 'ranking', 'points', 'fip_id', 'external_id', 'avatar_url'] as const
      for (const key of fieldKeys) {
        const keepVal = keepPlayer[key as keyof typeof keepPlayer]
        const delVal = deletePlayer[key as keyof typeof deletePlayer]
        // Use keep's value if present, otherwise take delete's value
        if (keepVal != null && keepVal !== '') {
          mergedFields[key] = keepVal
        } else if (delVal != null && delVal !== '') {
          mergedFields[key] = delVal
        }
      }

      const res = await fetch('/api/ops/players/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keepId: keepPlayer.id, deleteId: deletePlayer.id, mergedFields }),
      })

      if (res.ok) {
        const data = await res.json()
        setDupMerged(prev => { const s = new Set(prev); s.add(groupKey); return s })
        console.log(`[Dup Merge] Kept ${keepPlayer.name}, deleted ${deletePlayer.name}. Matches updated: ${data.matchesUpdated}, draws: ${data.drawsUpdated}`)
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

  // When user clicks a dup group player, load their detail for merge
  const startMergeFromDup = useCallback(async (keepId: string, deleteId: string) => {
    setDupShowPanel(false)
    setLoadingDetail(true)
    try {
      // Load the "keep" player as selectedPlayer
      const keepRes = await fetch(`/api/ops/players?id=${keepId}`)
      if (!keepRes.ok) return
      const keepData = await keepRes.json()
      setSelectedPlayer(keepData.player)
      setSelectedMatchCount(keepData.matchCount ?? 0)
      setEditFields({})

      // Activate merge mode and load the "delete" player as target
      setMergeMode(true)
      const delRes = await fetch(`/api/ops/players?id=${deleteId}`)
      if (!delRes.ok) return
      const delData = await delRes.json()
      setMergeTarget(delData.player)
      setMergeTargetMatchCount(delData.matchCount ?? 0)

      // Auto-select richer values for each field
      const selections: Record<string, 'a' | 'b'> = {}
      for (const field of MERGE_FIELDS) {
        const valA = keepData.player[field]
        const valB = delData.player[field]
        // Prefer non-null, non-empty values. If both have values, keep A (the richer one)
        if (valA != null && valA !== '') selections[field] = 'a'
        else if (valB != null && valB !== '') selections[field] = 'b'
        else selections[field] = 'a'
      }
      setMergeSelections(selections)
      setMergePreview(false)
    } catch { /* ignore */ }
    setLoadingDetail(false)
  }, [])

  // ── Search handler ────────────────────────────────────────────

  const doSearch = useCallback((query: string, cat: CategoryFilter) => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    if (!query.trim()) {
      setResults([])
      return
    }
    searchDebounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const catParam = cat !== 'all' ? `&category=${cat}` : ''
        const res = await fetch(`/api/ops/search-players?q=${encodeURIComponent(query)}${catParam}`)
        if (res.ok) {
          const data = await res.json()
          setResults(data.players ?? [])
        }
      } catch { /* ignore */ }
      setSearching(false)
    }, 300)
  }, [])

  useEffect(() => {
    doSearch(searchQuery, categoryFilter)
  }, [searchQuery, categoryFilter, doSearch])

  // ── Fetch player detail ───────────────────────────────────────

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

  const selectPlayer = useCallback(async (id: string) => {
    setLoadingDetail(true)
    setSaveMessage(null)
    setMergeMode(false)
    setMergeTarget(null)
    setMergeMessage(null)
    setMergePreview(false)
    const detail = await fetchPlayerDetail(id)
    if (detail) {
      setSelectedPlayer(detail.player)
      setSelectedMatchCount(detail.matchCount)
      // Init edit fields from player
      const fields: Record<string, unknown> = {}
      for (const f of EDITABLE_FIELDS) {
        fields[f.key] = detail.player[f.key]
      }
      setEditFields(fields)
      // Init equipment fields
      const eq = detail.player.equipment
      setEquipmentFields({
        racket_brand: eq?.racket_brand ?? '',
        racket_model: eq?.racket_model ?? '',
        racket_url: eq?.racket_url ?? '',
        racket_image: eq?.racket_image ?? '',
        brand_logo: eq?.brand_logo ?? '',
      })
    }
    setLoadingDetail(false)
  }, [fetchPlayerDetail])

  // ── Save player edits ─────────────────────────────────────────

  const handleSavePlayer = useCallback(async () => {
    if (!selectedPlayer) return
    setSavingPlayer(true)
    setSaveMessage(null)
    try {
      // Build updates: only changed fields
      const updates: Record<string, unknown> = {}
      for (const f of EDITABLE_FIELDS) {
        const newVal = editFields[f.key]
        const oldVal = selectedPlayer[f.key]
        if (newVal !== oldVal) {
          updates[f.key] = newVal === '' ? null : newVal
        }
      }
      // Build equipment update if changed
      const newEquipment = {
        ...(equipmentFields.racket_brand ? { racket_brand: equipmentFields.racket_brand } : {}),
        ...(equipmentFields.racket_model ? { racket_model: equipmentFields.racket_model } : {}),
        ...(equipmentFields.racket_url ? { racket_url: equipmentFields.racket_url } : {}),
        ...(equipmentFields.racket_image ? { racket_image: equipmentFields.racket_image } : {}),
        ...(equipmentFields.brand_logo ? { brand_logo: equipmentFields.brand_logo } : {}),
      }
      const oldEquipment = selectedPlayer.equipment ?? {}
      if (JSON.stringify(newEquipment) !== JSON.stringify(oldEquipment)) {
        updates.equipment = Object.keys(newEquipment).length > 0 ? newEquipment : null
      }

      if (Object.keys(updates).length === 0) {
        setSaveMessage('No changes to save')
        setSavingPlayer(false)
        return
      }
      const res = await fetch('/api/ops/players', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedPlayer.id, updates }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setSaveMessage(`Error: ${body.error ?? 'Failed to save'}`)
      } else {
        setSaveMessage('Saved successfully')
        // Refresh
        const detail = await fetchPlayerDetail(selectedPlayer.id)
        if (detail) {
          setSelectedPlayer(detail.player)
          setSelectedMatchCount(detail.matchCount)
        }
        doSearch(searchQuery, categoryFilter)
      }
    } catch (e: unknown) {
      setSaveMessage(`Error: ${e instanceof Error ? e.message : 'Failed to save'}`)
    }
    setSavingPlayer(false)
  }, [selectedPlayer, editFields, fetchPlayerDetail, doSearch, searchQuery, categoryFilter])

  // ── Merge: search for Player B ────────────────────────────────

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
          // Exclude Player A from results
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

      // Auto-select non-null values
      const selections: Record<string, 'a' | 'b'> = {}
      for (const field of MERGE_FIELDS) {
        const aVal = selectedPlayer?.[field]
        const bVal = detail.player[field]
        if (aVal != null && bVal == null) selections[field] = 'a'
        else if (aVal == null && bVal != null) selections[field] = 'b'
        else if (aVal != null && bVal != null) {
          // Both non-null: default to A (the kept player)
          selections[field] = 'a'
        }
        // Both null: no selection needed
      }
      setMergeSelections(selections)
    }
  }, [fetchPlayerDetail, selectedPlayer])

  // ── Execute merge ─────────────────────────────────────────────

  const handleMerge = useCallback(async () => {
    if (!selectedPlayer || !mergeTarget) return
    setMerging(true)
    setMergeMessage(null)

    // Build merged fields from selections
    const mergedFields: Record<string, unknown> = {}
    for (const field of MERGE_FIELDS) {
      const selection = mergeSelections[field]
      if (selection === 'b') {
        mergedFields[field] = mergeTarget[field]
      }
      // 'a' means keep existing — no update needed
    }

    try {
      const res = await fetch('/api/ops/players/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keepId: selectedPlayer.id,
          deleteId: mergeTarget.id,
          mergedFields,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setMergeMessage(`Error: ${body.error ?? 'Merge failed'}`)
      } else {
        const data = await res.json()
        setMergeMessage(`Merged! ${data.matchesUpdated} matches + ${data.drawsUpdated} draws reassigned.`)
        // Reset merge mode
        setMergeMode(false)
        setMergeTarget(null)
        setMergePreview(false)
        // Refresh player
        const detail = await fetchPlayerDetail(selectedPlayer.id)
        if (detail) {
          setSelectedPlayer(detail.player)
          setSelectedMatchCount(detail.matchCount)
        }
        doSearch(searchQuery, categoryFilter)
      }
    } catch (e: unknown) {
      setMergeMessage(`Error: ${e instanceof Error ? e.message : 'Merge failed'}`)
    }
    setMerging(false)
  }, [selectedPlayer, mergeTarget, mergeSelections, fetchPlayerDetail, doSearch, searchQuery, categoryFilter])

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="players-tab">
      <style>{`
        .players-tab input, .players-tab select, .players-tab textarea { color: #111 !important; }
      `}</style>
      {/* Search bar */}
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
        <div style={{ display: 'flex', gap: 0 }}>
          {(['all', 'men', 'women'] as CategoryFilter[]).map((cat, i) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              style={{
                padding: '5px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                border: '1px solid #d1d5db',
                borderRadius: i === 0 ? '4px 0 0 4px' : i === 2 ? '0 4px 4px 0' : '0',
                background: categoryFilter === cat ? '#111' : 'white',
                color: categoryFilter === cat ? 'white' : '#333',
                borderLeft: i > 0 ? 'none' : undefined,
              }}
            >
              {cat === 'all' ? 'All' : cat === 'men' ? 'Men' : 'Women'}
            </button>
          ))}
        </div>
        {searching && <span style={{ fontSize: 10, color: '#999' }}>Searching...</span>}
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
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: 14 }}
            >✕</button>
          </div>

          {dupGroups.length === 0 && (
            <div style={{ fontSize: 11, color: '#666', padding: '8px 0' }}>No duplicates found. Your player database is clean!</div>
          )}

          <div style={{ maxHeight: 400, overflowY: 'auto' as const }}>
            {dupGroups.map((group, gi) => {
              const groupKey = group.players.map(p => p.id).sort().join('|')
              if (dupDismissed.has(groupKey)) return null
              const [a, b] = group.players
              // Richness: count non-null fields
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
                  <div style={{ fontSize: 10, color: '#666', marginBottom: 6 }}>
                    {group.reasons.map((r, ri) => (
                      <span key={ri} style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 3, background: '#fef3c7', color: '#92400e', fontSize: 9, fontWeight: 600, marginRight: 4 }}>{r}</span>
                    ))}
                  </div>
                  {/* Side-by-side */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                    {[a, b].map((p, pi) => {
                      const isRec = (pi === 0 && recommended === 'a') || (pi === 1 && recommended === 'b')
                      return (
                        <div key={p.id} style={{ padding: 6, background: isRec ? '#f0fdf4' : '#f9fafb', borderRadius: 4, border: isRec ? '1px solid #86efac' : '1px solid #e5e7eb' }}>
                          <div style={{ fontSize: 9, color: '#999', fontWeight: 600, textTransform: 'uppercase' as const, marginBottom: 2 }}>
                            Player {pi === 0 ? 'A' : 'B'} {isRec && <span style={{ color: '#16a34a' }}>★ Richer</span>}
                          </div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#111' }}>{p.name}</div>
                          <div style={{ fontSize: 10, color: '#666' }}>
                            {p.country ?? '—'} · Rank: {p.ranking ?? '—'} · Pts: {p.points?.toLocaleString() ?? '—'}
                          </div>
                          <div style={{ fontSize: 9, color: '#999' }}>
                            {p.category ?? '—'} · FIP: {p.fip_id ?? '—'} · ID: {p.id.slice(0, 8)}...
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  {/* AI merge guidance */}
                  {group.mergeGuidance && (
                    <div style={{
                      padding: '6px 10px', background: '#f5f3ff', borderRadius: 4,
                      border: '1px solid #ddd6fe', marginBottom: 8, fontSize: 11, color: '#5b21b6',
                    }}>
                      <span style={{ fontWeight: 700 }}>🤖 AI recommendation:</span> {group.mergeGuidance}
                    </div>
                  )}
                  {/* Actions */}
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
                        background: '#fff', color: '#333',
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
                        border: '1px solid #d1d5db', cursor: 'pointer', background: '#fff', color: '#666',
                      }}
                    >
                      Review fields...
                    </button>
                    <button
                      onClick={() => setDupDismissed(prev => { const s = new Set(prev); s.add(groupKey); return s })}
                      disabled={dupMerging.has(groupKey)}
                      style={{
                        fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 4,
                        border: '1px solid #d1d5db', cursor: 'pointer', background: '#fff', color: '#999',
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

      {/* Results table */}
      {results.length > 0 && (
        <div style={{ ...card, padding: 0, marginBottom: 12, overflow: 'auto' }}>
          <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
                {['', 'Name', 'Country', 'Ranking', 'Points', 'Category', 'Actions'].map(h => (
                  <th
                    key={h}
                    style={{
                      ...sectionLabel, padding: '8px 6px', textAlign: 'left', marginBottom: 0,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.map(player => (
                <tr
                  key={player.id}
                  style={{
                    borderBottom: '1px solid #f3f4f6',
                    cursor: 'pointer',
                    background: selectedPlayer?.id === player.id ? '#F0F7FF' : undefined,
                  }}
                  onClick={() => selectPlayer(player.id)}
                >
                  {/* Avatar */}
                  <td style={{ padding: '5px 6px', width: 32 }}>
                    {player.avatar_url ? (
                      <img
                        src={player.avatar_url}
                        alt=""
                        style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div style={{
                        width: 24, height: 24, borderRadius: '50%',
                        background: '#e5e7eb', display: 'flex', alignItems: 'center',
                        justifyContent: 'center', fontSize: 10, color: '#999',
                      }}>
                        ?
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '5px 6px', fontWeight: 500, color: '#111' }}>
                    {player.name}
                    {player.display_name && player.display_name !== player.name && (
                      <div style={{ fontSize: 10, color: '#888', fontWeight: 400 }}>{player.display_name}</div>
                    )}
                  </td>
                  <td style={{ padding: '5px 6px', color: '#6B7280' }}>{player.country ?? '—'}</td>
                  <td style={{ padding: '5px 6px', color: '#333' }}>{player.ranking ?? '—'}</td>
                  <td style={{ padding: '5px 6px', color: '#333' }}>{player.points ?? '—'}</td>
                  <td style={{ padding: '5px 6px' }}>
                    {player.category && (
                      <span style={{
                        fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
                        padding: '2px 6px', borderRadius: 3,
                        background: player.category === 'men' ? '#DBEAFE' : '#FCE7F3',
                        color: player.category === 'men' ? '#1E40AF' : '#9D174D',
                      }}>
                        {player.category}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '5px 6px' }} onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        onClick={() => selectPlayer(player.id)}
                        style={{
                          padding: '3px 8px', fontSize: 10, fontWeight: 600,
                          background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4,
                          cursor: 'pointer', color: '#333',
                        }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          selectPlayer(player.id).then(() => {
                            setMergeMode(true)
                            setMergeTarget(null)
                            setMergePreview(false)
                            setMergeMessage(null)
                          })
                        }}
                        style={{
                          padding: '3px 8px', fontSize: 10, fontWeight: 600,
                          background: '#FEF3C7', border: '1px solid #F5A623', borderRadius: 4,
                          cursor: 'pointer', color: '#92400E',
                        }}
                      >
                        Merge
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty state */}
      {searchQuery.trim() && !searching && results.length === 0 && (
        <div style={{ ...card, textAlign: 'center', color: '#9ca3af', fontSize: 12, marginBottom: 12 }}>
          No players found
        </div>
      )}

      {/* Loading detail */}
      {loadingDetail && (
        <div style={{ ...card, textAlign: 'center', color: '#999', fontSize: 12 }}>Loading player details...</div>
      )}

      {/* Detail / Edit panel */}
      {selectedPlayer && !loadingDetail && !mergeMode && (
        <div style={{ ...card, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>{selectedPlayer.name}</span>
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '2px 8px',
                background: '#F0F7FF', border: '1px solid #DBEAFE', borderRadius: 10,
                color: '#1E40AF',
              }}>
                Referenced in {selectedMatchCount} matches
              </span>
            </div>
            <button
              onClick={() => { setSelectedPlayer(null); setSaveMessage(null) }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 16, color: '#9ca3af', padding: '2px 6px',
              }}
            >
              &times;
            </button>
          </div>

          {/* Save message */}
          {saveMessage && (
            <div style={{
              marginBottom: 10, padding: '6px 10px', borderRadius: 4, fontSize: 11,
              background: saveMessage.startsWith('Error') ? '#FEF2F2' : '#F0FDF4',
              color: saveMessage.startsWith('Error') ? '#991B1B' : '#166534',
              border: saveMessage.startsWith('Error') ? '1px solid #FECACA' : '1px solid #BBF7D0',
            }}>
              {saveMessage}
            </div>
          )}

          {/* Two-column field grid */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px',
          }}>
            {EDITABLE_FIELDS.map(f => (
              <div key={f.key}>
                <label style={{ fontSize: 10, color: '#6B7280', fontWeight: 600, display: 'block', marginBottom: 2 }}>
                  {f.label}
                </label>
                <input
                  type={f.type === 'number' ? 'number' : 'text'}
                  value={(editFields[f.key] as string | number | undefined) ?? ''}
                  onChange={e => {
                    const val = f.type === 'number'
                      ? (e.target.value === '' ? null : Number(e.target.value))
                      : e.target.value
                    setEditFields(prev => ({ ...prev, [f.key]: val }))
                  }}
                  style={{
                    width: '100%', padding: '5px 7px', fontSize: 11,
                    border: '1px solid #e5e7eb', borderRadius: 4,
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            ))}
          </div>

          {/* ── Equipment Section ──────────────────────── */}
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#111', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>🏓</span> Equipment
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
              {([
                { key: 'racket_brand', label: 'Brand' },
                { key: 'racket_model', label: 'Model' },
                { key: 'brand_logo', label: 'Brand Logo URL' },
                { key: 'racket_image', label: 'Racket Image URL' },
                { key: 'racket_url', label: 'Affiliate URL' },
              ] as const).map(f => (
                <div key={f.key} style={f.key === 'racket_url' ? { gridColumn: '1 / -1' } : undefined}>
                  <label style={{ fontSize: 10, color: '#6B7280', fontWeight: 600, display: 'block', marginBottom: 2 }}>
                    {f.label}
                  </label>
                  <input
                    type="text"
                    value={equipmentFields[f.key]}
                    onChange={e => setEquipmentFields(prev => ({ ...prev, [f.key]: e.target.value }))}
                    placeholder={f.key === 'brand_logo' || f.key === 'racket_image' ? 'https://...' : ''}
                    style={{
                      width: '100%', padding: '5px 7px', fontSize: 11,
                      border: '1px solid #e5e7eb', borderRadius: 4,
                      boxSizing: 'border-box' as const,
                    }}
                  />
                </div>
              ))}
            </div>

            {/* ── Live Preview (dark card matching player profile) ── */}
            {(equipmentFields.racket_brand || equipmentFields.racket_model) && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 10, color: '#6B7280', fontWeight: 600, marginBottom: 6 }}>Preview (as shown on player profile)</div>
                <div style={{
                  background: '#141414',
                  clipPath: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
                  padding: 12,
                  position: 'relative',
                  minHeight: 92,
                  maxWidth: 180,
                }}>
                  {/* Widget label */}
                  <div style={{ fontSize: 9, color: '#F5A623', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, marginBottom: 8 }}>
                    Plays with
                  </div>
                  {/* Brand logo or text */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {equipmentFields.brand_logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={equipmentFields.brand_logo}
                        alt={equipmentFields.racket_brand}
                        style={{ height: 16, objectFit: 'contain', filter: 'brightness(0) invert(1)', opacity: 0.7 }}
                      />
                    ) : equipmentFields.racket_brand ? (
                      <span style={{ fontSize: 10, fontWeight: 800, color: '#F5A623' }}>{equipmentFields.racket_brand}</span>
                    ) : null}
                  </div>
                  {/* Racket image */}
                  {equipmentFields.racket_image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={equipmentFields.racket_image}
                      alt={equipmentFields.racket_model}
                      style={{ height: 44, objectFit: 'contain', margin: '6px auto 2px', display: 'block', filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.4))' }}
                    />
                  )}
                  {/* Model name */}
                  {equipmentFields.racket_model && (
                    <div style={{ fontSize: 10, fontWeight: 600, color: '#fff', lineHeight: 1.3, marginTop: equipmentFields.racket_image ? 0 : 6 }}>
                      {equipmentFields.racket_model}
                    </div>
                  )}
                  {/* Affiliate link indicator */}
                  {equipmentFields.racket_url && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 4 }}>
                      <span style={{ fontSize: 8, color: '#4A6F8E', fontWeight: 600 }}>Learn more</span>
                      <span style={{ fontSize: 8, color: '#4A6F8E' }}>›</span>
                    </div>
                  )}
                  {/* Paddle icon chip */}
                  <div style={{
                    position: 'absolute', top: 10, right: 10,
                    width: 22, height: 22,
                    background: 'rgba(245,166,35,0.1)',
                    color: '#F5A623',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    clipPath: 'polygon(8% 12%, 92% 0%, 100% 88%, 0% 100%)',
                  }}>
                    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#F5A623" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="8" r="6"/><line x1="12" y1="14" x2="12" y2="22"/><line x1="9" y1="19" x2="15" y2="19"/>
                    </svg>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              onClick={handleSavePlayer}
              disabled={savingPlayer}
              style={{
                padding: '6px 14px', fontSize: 11, fontWeight: 600,
                background: '#111', color: 'white', border: 'none', borderRadius: 6,
                cursor: 'pointer', opacity: savingPlayer ? 0.6 : 1,
              }}
            >
              {savingPlayer ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => { setSelectedPlayer(null); setSaveMessage(null) }}
              style={{
                padding: '6px 14px', fontSize: 11, fontWeight: 600,
                background: 'white', border: '1px solid #d1d5db', borderRadius: 6,
                cursor: 'pointer', color: '#333',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Merge mode */}
      {selectedPlayer && !loadingDetail && mergeMode && (
        <div style={{ ...card, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>
              Merge Players
            </span>
            <button
              onClick={() => { setMergeMode(false); setMergeTarget(null); setMergePreview(false); setMergeMessage(null) }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 16, color: '#9ca3af', padding: '2px 6px',
              }}
            >
              &times;
            </button>
          </div>

          {/* Merge message */}
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

          {/* Player A (left column) */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={sectionLabel}>Player A (Keep)</div>
              <div style={{
                padding: 10, border: '1px solid #BBF7D0', borderRadius: 6,
                background: '#F0FDF4',
              }}>
                <div style={{ fontWeight: 600, fontSize: 12, color: '#111' }}>{selectedPlayer.name}</div>
                <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2 }}>
                  {selectedPlayer.country ?? 'No country'} &middot; Rank #{selectedPlayer.ranking ?? '—'} &middot; {selectedMatchCount} matches
                </div>
              </div>
            </div>

            {/* Player B (right column) */}
            <div style={{ flex: 1 }}>
              <div style={sectionLabel}>Player B (Delete)</div>
              {!mergeTarget ? (
                <div>
                  <input
                    type="text"
                    value={mergeSearchQuery}
                    onChange={e => {
                      setMergeSearchQuery(e.target.value)
                      doMergeSearch(e.target.value)
                    }}
                    placeholder="Search for player to merge..."
                    style={{
                      width: '100%', padding: '7px 10px', fontSize: 11,
                      border: '1px solid #d1d5db', borderRadius: 4,
                      boxSizing: 'border-box',
                    }}
                  />
                  {mergeSearching && <div style={{ fontSize: 10, color: '#999', marginTop: 4 }}>Searching...</div>}
                  {mergeSearchResults.length > 0 && (
                    <div style={{
                      border: '1px solid #e5e7eb', borderRadius: 4, marginTop: 4,
                      maxHeight: 180, overflowY: 'auto',
                    }}>
                      {mergeSearchResults.map(r => (
                        <div
                          key={r.id}
                          onClick={() => selectMergeTarget(r.id)}
                          style={{
                            padding: '6px 8px', cursor: 'pointer', fontSize: 11,
                            borderBottom: '1px solid #f3f4f6',
                          }}
                          onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                          <span style={{ fontWeight: 500, color: '#111' }}>{r.name}</span>
                          {r.country && <span style={{ color: '#999', marginLeft: 4 }}>({r.country})</span>}
                          {r.ranking && <span style={{ color: '#888', fontSize: 10, marginLeft: 4 }}>#{r.ranking}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{
                  padding: 10, border: '1px solid #FECACA', borderRadius: 6,
                  background: '#FEF2F2',
                }}>
                  <div style={{ fontWeight: 600, fontSize: 12, color: '#111' }}>{mergeTarget.name}</div>
                  <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2 }}>
                    {mergeTarget.country ?? 'No country'} &middot; Rank #{mergeTarget.ranking ?? '—'} &middot; {mergeTargetMatchCount} matches
                  </div>
                  <button
                    onClick={() => { setMergeTarget(null); setMergePreview(false) }}
                    style={{
                      marginTop: 6, padding: '2px 8px', fontSize: 10, fontWeight: 600,
                      background: 'white', border: '1px solid #d1d5db', borderRadius: 3,
                      cursor: 'pointer', color: '#6B7280',
                    }}
                  >
                    Change
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Side-by-side comparison */}
          {mergeTarget && (
            <>
              <div style={{ ...card, padding: 0, overflow: 'auto', marginBottom: 12, border: '1px solid #e5e7eb' }}>
                <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
                      <th style={{ ...sectionLabel, padding: '6px 8px', textAlign: 'left', marginBottom: 0, width: 100 }}>Field</th>
                      <th style={{ ...sectionLabel, padding: '6px 8px', textAlign: 'left', marginBottom: 0 }}>
                        Player A (Keep)
                      </th>
                      <th style={{ ...sectionLabel, padding: '6px 8px', textAlign: 'center', marginBottom: 0, width: 50 }}>Pick</th>
                      <th style={{ ...sectionLabel, padding: '6px 8px', textAlign: 'left', marginBottom: 0 }}>
                        Player B (Delete)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {MERGE_FIELDS.map(field => {
                      const aVal = selectedPlayer[field]
                      const bVal = mergeTarget[field]
                      const bothNonNull = aVal != null && aVal !== '' && bVal != null && bVal !== ''
                      const isConflict = bothNonNull && String(aVal) !== String(bVal)

                      return (
                        <tr
                          key={field}
                          style={{
                            borderBottom: '1px solid #f3f4f6',
                            background: isConflict ? '#FFF7ED' : undefined,
                          }}
                        >
                          <td style={{ padding: '5px 8px', fontWeight: 600, color: '#6B7280', fontSize: 10 }}>
                            {field}
                          </td>
                          <td
                            style={{
                              padding: '5px 8px', color: '#111',
                              fontWeight: mergeSelections[field] === 'a' ? 600 : 400,
                              opacity: mergeSelections[field] === 'b' ? 0.5 : 1,
                            }}
                          >
                            {aVal != null ? String(aVal) : <span style={{ color: '#d1d5db' }}>null</span>}
                          </td>
                          <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                            {(aVal != null || bVal != null) && (
                              <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                                <label style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
                                  <input
                                    type="radio"
                                    name={`merge-${field}`}
                                    checked={mergeSelections[field] === 'a'}
                                    onChange={() => setMergeSelections(prev => ({ ...prev, [field]: 'a' }))}
                                    style={{ margin: 0 }}
                                  />
                                  A
                                </label>
                                <label style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
                                  <input
                                    type="radio"
                                    name={`merge-${field}`}
                                    checked={mergeSelections[field] === 'b'}
                                    onChange={() => setMergeSelections(prev => ({ ...prev, [field]: 'b' }))}
                                    style={{ margin: 0 }}
                                  />
                                  B
                                </label>
                              </div>
                            )}
                          </td>
                          <td
                            style={{
                              padding: '5px 8px', color: '#111',
                              fontWeight: mergeSelections[field] === 'b' ? 600 : 400,
                              opacity: mergeSelections[field] === 'a' ? 0.5 : 1,
                            }}
                          >
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
                    style={{
                      padding: '6px 14px', fontSize: 11, fontWeight: 600,
                      background: '#F5A623', color: 'white', border: 'none', borderRadius: 6,
                      cursor: 'pointer',
                    }}
                  >
                    Preview Merge
                  </button>
                ) : (
                  <>
                    <div style={{
                      flex: 1, padding: '8px 10px', borderRadius: 6, fontSize: 11,
                      background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B',
                    }}>
                      Will reassign {mergeTargetMatchCount} matches and draw entries from <strong>{mergeTarget.name}</strong> to <strong>{selectedPlayer.name}</strong>. Player B will be deleted.
                    </div>
                    <button
                      onClick={handleMerge}
                      disabled={merging}
                      style={{
                        padding: '6px 14px', fontSize: 11, fontWeight: 600,
                        background: '#FF4655', color: 'white', border: 'none', borderRadius: 6,
                        cursor: 'pointer', opacity: merging ? 0.6 : 1,
                        whiteSpace: 'nowrap',
                      }}
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
    </div>
  )
}

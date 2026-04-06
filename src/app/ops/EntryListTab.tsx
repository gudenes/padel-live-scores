'use client'
// src/app/ops/EntryListTab.tsx
// Entry list seeding UI — ops dashboard tab for uploading PDF/text entry lists and seeding players

import { useEffect, useState, useRef, useCallback, DragEvent } from 'react'

// ── Types ────────────────────────────────────────────────────────

interface Tournament {
  id: string
  name: string
  country: string | null
  level: string | null
  starts_at: string | null
  ends_at: string | null
  entry_list_status?: string
  categories?: string
  hasEntryList?: boolean
  hasDraw?: boolean
}

interface ParsedPlayer {
  name: string
  country: string | null
  ranking: number | null
  points: number | null
  action: 'new' | 'exact' | 'fuzzy'
  matchStatus: 'exact' | 'fuzzy' | 'new'
  matchedPlayerId: string | null
  matchedPlayerName: string | null
  matchedPlayerRanking: number | null
}

interface PlayerSearchResult {
  id: string
  name: string
  country: string | null
  ranking: number | null
}

/** Overrides collected per-player for the seed request */
interface PlayerOverride {
  action: 'link' | 'create'
  playerId: string | undefined
}

interface ParsedTeam {
  teamNumber: number
  drawType: 'main' | 'qualifying'
  isWildCard: boolean
  players: ParsedPlayer[]
}

interface ParseResult {
  teams: ParsedTeam[]
  metadata: {
    filename?: string
    version?: string
    modified?: string
    pages?: number
    lastUpdate?: string    // from PDF text: "29/3/2026 h 03:09 p. m."
    title?: string         // from PDF text: "FIP GOLD ALMATY"
    category?: string      // from PDF text: "Hombres's" or "Mujeres"
  }
  playerCount: number
}

interface SeedResult {
  linked: number
  created: number
  total: number
  errors: string[]
}

interface DrawEntry {
  drawPosition: number
  player1Name: string
  player1Country: string | null
  player2Name: string
  player2Country: string | null
  seed: number | null
  marker: 'Q' | 'WC' | 'LL' | null
  teamPoints: number | null
}

interface DrawParseResult {
  entries: DrawEntry[]
  seededTeams: { seed: number; player1: string; player2: string; points: number }[]
  metadata: { category: 'men' | 'women'; releaseDate: string | null; drawSize: number }
  warnings: string[]
  filename: string
}

interface DrawSeedResult {
  slots: number
  resolved: number
  created: number
  errors: string[]
}

type Stage = 'select' | 'parsing' | 'preview' | 'seeding' | 'done'
type Category = 'men' | 'women'
type InputMode = 'upload' | 'paste'

// ── Shared styles (matching OpsClient.tsx) ───────────────────────

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

// ── Helpers ──────────────────────────────────────────────────────

// Auth note: /api/ops/* routes are protected by middleware via ops_token cookie.
// No explicit auth headers needed — the cookie is sent automatically.

function urgencyDot(tournament: Tournament): { color: string; label: string; sortKey: number } {
  const now = Date.now()
  if (!tournament.starts_at) return { color: '#9ca3af', label: 'Unknown', sortKey: 999 }

  const startsAt = new Date(tournament.starts_at).getTime()
  const endsAt = tournament.ends_at ? new Date(tournament.ends_at).getTime() : null

  // In progress
  if (startsAt <= now && endsAt && endsAt >= now) {
    const daysAgo = Math.floor((now - startsAt) / 86400000)
    return { color: '#9ca3af', label: `started ${daysAgo}d ago`, sortKey: 500 }
  }

  // Already ended
  if (endsAt && endsAt < now) {
    return { color: '#d1d5db', label: 'ended', sortKey: 999 }
  }

  const daysUntil = Math.ceil((startsAt - now) / 86400000)
  if (daysUntil <= 3) return { color: '#ef4444', label: `${daysUntil}d away`, sortKey: daysUntil }
  if (daysUntil <= 7) return { color: '#f59e0b', label: `${daysUntil}d away`, sortKey: daysUntil }
  if (daysUntil <= 30) return { color: '#22c55e', label: `${daysUntil}d away`, sortKey: daysUntil }
  return { color: '#d1d5db', label: `${daysUntil}d away`, sortKey: daysUntil }
}

function statusBadgeStyle(action: ParsedPlayer['action']): React.CSSProperties {
  switch (action) {
    case 'exact': return { background: '#dcfce7', color: '#166534' }
    case 'fuzzy': return { background: '#fef3c7', color: '#92400e' }
    case 'new': return { background: '#dbeafe', color: '#1e40af' }
  }
}

function statusBadgeLabel(action: ParsedPlayer['action']): string {
  switch (action) {
    case 'exact': return 'Exact'
    case 'fuzzy': return 'Fuzzy'
    case 'new': return 'New'
  }
}

// ── Component ────────────────────────────────────────────────────

export default function EntryListTab({ preSelectedTournamentId, onClearPreSelection }: { preSelectedTournamentId?: string | null; onClearPreSelection?: () => void }) {
  const [tournaments, setTournaments] = useState<Tournament[]>([])
  const [loadingTournaments, setLoadingTournaments] = useState(true)
  const [tournamentError, setTournamentError] = useState<string | null>(null)

  const [stage, setStage] = useState<Stage>('select')
  const [selectedTournament, setSelectedTournament] = useState<string>('')
  const [category, setCategory] = useState<Category>('men')
  const [inputMode, setInputMode] = useState<InputMode>('upload')

  const [dragOver, setDragOver] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [pasteText, setPasteText] = useState('')

  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)

  const [seedResult, setSeedResult] = useState<SeedResult | null>(null)
  const [seedError, setSeedError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Typeahead tournament selector state
  const [tournamentSearch, setTournamentSearch] = useState('')
  const [typeaheadOpen, setTypeaheadOpen] = useState(false)
  const typeaheadRef = useRef<HTMLDivElement>(null)

  // Player overrides for enriched preview (keyed by "teamIdx-playerIdx")
  const [playerOverrides, setPlayerOverrides] = useState<Record<string, PlayerOverride>>({})

  // Player search popover state
  const [searchPopoverKey, setSearchPopoverKey] = useState<string | null>(null)
  const [searchPopoverQuery, setSearchPopoverQuery] = useState('')
  const [searchPopoverResults, setSearchPopoverResults] = useState<PlayerSearchResult[]>([])
  const [searchPopoverLoading, setSearchPopoverLoading] = useState(false)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Draw upload state
  const [drawFile, setDrawFile] = useState<File | null>(null)
  const [drawParseResult, setDrawParseResult] = useState<DrawParseResult | null>(null)
  const [drawParseError, setDrawParseError] = useState<string | null>(null)
  const [drawSeedResult, setDrawSeedResult] = useState<DrawSeedResult | null>(null)
  const [drawStage, setDrawStage] = useState<'idle' | 'parsing' | 'preview' | 'seeding' | 'done'>('idle')
  const drawFileInputRef = useRef<HTMLInputElement>(null)

  // Close typeahead on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (typeaheadRef.current && !typeaheadRef.current.contains(e.target as Node)) {
        setTypeaheadOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Close search popover on outside click
  useEffect(() => {
    if (!searchPopoverKey) return
    function handleClickOutside(e: MouseEvent) {
      const popover = document.getElementById('player-search-popover')
      if (popover && !popover.contains(e.target as Node)) {
        setSearchPopoverKey(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [searchPopoverKey])

  // Load tournaments on mount
  useEffect(() => {
    let cancelled = false
    setLoadingTournaments(true)
    fetch('/api/ops/seed-entry-list?action=list-tournaments')
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(`HTTP ${r.status}: ${body.reason ?? body.error ?? 'Unknown'}`)
        }
        return r.json()
      })
      .then(data => {
        if (cancelled) return
        setTournaments(data.tournaments ?? [])
        setTournamentError(null)
      })
      .catch((e) => {
        if (!cancelled) setTournamentError(`Failed to load tournaments: ${e.message}`)
      })
      .finally(() => {
        if (!cancelled) setLoadingTournaments(false)
      })
    return () => { cancelled = true }
  }, [])

  // Auto-select tournament when navigating from Readiness tab
  useEffect(() => {
    if (preSelectedTournamentId && tournaments.length > 0 && !selectedTournament) {
      const found = tournaments.find(t => t.id === preSelectedTournamentId)
      if (found) {
        setSelectedTournament(found.id)
        onClearPreSelection?.()
      }
    }
  }, [preSelectedTournamentId, tournaments, selectedTournament, onClearPreSelection])

  const sortedTournaments = [...tournaments].sort((a, b) => {
    const urgencyDiff = urgencyDot(a).sortKey - urgencyDot(b).sortKey
    if (urgencyDiff !== 0) return urgencyDiff
    // At same urgency, tournaments missing uploads sort higher
    const aReady = (a.hasEntryList ? 1 : 0) + (a.hasDraw ? 1 : 0)
    const bReady = (b.hasEntryList ? 1 : 0) + (b.hasDraw ? 1 : 0)
    return aReady - bReady
  })

  // ── Typeahead helpers ───────────────────────────────────────────

  const filteredTournaments = tournamentSearch.trim()
    ? sortedTournaments.filter(t => {
        const q = tournamentSearch.toLowerCase()
        return (
          t.name.toLowerCase().includes(q) ||
          (t.country ?? '').toLowerCase().includes(q) ||
          (t.level ?? '').toLowerCase().includes(q)
        )
      })
    : sortedTournaments

  const selectedTournamentObj = tournaments.find(t => t.id === selectedTournament) ?? null

  const handleSelectTournament = useCallback((id: string) => {
    setSelectedTournament(id)
    setTypeaheadOpen(false)
    setTournamentSearch('')
  }, [])

  const handleDeselectTournament = useCallback(() => {
    setSelectedTournament('')
    setTournamentSearch('')
    setTypeaheadOpen(true)
  }, [])

  // ── Player override helpers ───────────────────────────────────

  const getPlayerOverride = useCallback((teamIdx: number, playerIdx: number, player: ParsedPlayer): PlayerOverride => {
    const key = `${teamIdx}-${playerIdx}`
    if (playerOverrides[key]) return playerOverrides[key]
    // Default: link for exact/fuzzy, create for new
    return {
      action: player.matchStatus === 'new' ? 'create' : 'link',
      playerId: player.matchedPlayerId ?? undefined,
    }
  }, [playerOverrides])

  const setPlayerOverride = useCallback((teamIdx: number, playerIdx: number, override: Partial<PlayerOverride>) => {
    const key = `${teamIdx}-${playerIdx}`
    setPlayerOverrides(prev => ({
      ...prev,
      [key]: { ...prev[key], ...override } as PlayerOverride,
    }))
  }, [])

  // ── Player search popover handler ─────────────────────────────

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

  // ── File handling ──────────────────────────────────────────────

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) {
      setSelectedFile(file)
      setInputMode('upload')
    }
  }, [])

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => setDragOver(false), [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) setSelectedFile(file)
  }, [])

  // ── Parse ──────────────────────────────────────────────────────

  const handleParse = useCallback(async () => {
    setParseError(null)
    setStage('parsing')

    try {
      let textToSend = pasteText

      // Client-side PDF extraction — parse PDF in browser, send text to API
      if (inputMode === 'upload' && selectedFile) {
        try {
          const arrayBuffer = await selectedFile.arrayBuffer()
          const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
          pdfjsLib.GlobalWorkerOptions.workerSrc = ''
          const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise
          const pages: string[] = []
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i)
            const content = await page.getTextContent()
            const pageText = content.items
              .map((item: any) => ('str' in item ? item.str : ''))
              .join(' ')
            pages.push(pageText)
          }
          textToSend = pages.join('\n')
          if (!textToSend.trim()) {
            throw new Error('No text extracted from PDF. Try pasting the text instead.')
          }
        } catch (pdfErr) {
          throw new Error(`PDF extraction failed: ${pdfErr instanceof Error ? pdfErr.message : String(pdfErr)}`)
        }
      }

      const categoryParam = category ? `?category=${category}` : ''
      const res = await fetch(`/api/ops/parse-entry-list${categoryParam}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: textToSend }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error ?? 'Parse failed')
      }

      const raw = await res.json()
      const data: ParseResult = {
        teams: (raw.teams ?? []).map((t: any, i: number) => ({
          teamNumber: t.position ?? i + 1,
          drawType: t.drawType ?? 'main',
          isWildCard: t.isWildCard ?? false,
          players: [t.player1, t.player2].map((p: any) => ({
            name: p?.name ?? '',
            country: p?.country ?? null,
            ranking: p?.ranking ?? null,
            points: p?.points ?? null,
            action: (p?.matchStatus ?? 'new') as 'new' | 'exact' | 'fuzzy',
            matchStatus: (p?.matchStatus ?? 'new') as 'exact' | 'fuzzy' | 'new',
            matchedPlayerId: p?.matchedPlayerId ?? null,
            matchedPlayerName: p?.matchedPlayerName ?? null,
            matchedPlayerRanking: p?.matchedPlayerRanking ?? null,
          })),
        })),
        metadata: {
          filename: raw.metadata?.filename ?? undefined,
          version: raw.metadata?.version != null ? String(raw.metadata.version) : undefined,
          modified: raw.metadata?.lastModified ?? undefined,
          pages: raw.metadata?.pageCount ?? undefined,
          lastUpdate: raw.metadata?.lastUpdate ?? undefined,
          title: raw.metadata?.title ?? undefined,
          category: raw.metadata?.category ?? undefined,
        },
        playerCount: raw.playerCount ?? 0,
      }
      setParseResult(data)
      setPlayerOverrides({})
      setStage('preview')
    } catch (err: unknown) {
      setParseError(err instanceof Error ? err.message : 'Parse failed')
      setStage('select')
    }
  }, [inputMode, selectedFile, pasteText])

  // ── Seed ───────────────────────────────────────────────────────

  const handleSeed = useCallback(async () => {
    if (!parseResult || !selectedTournament) return
    setSeedError(null)
    setStage('seeding')

    try {
      const allPlayers = parseResult.teams.flatMap((t, teamIdx) =>
        t.players.map((p, playerIdx) => {
          const override = getPlayerOverride(teamIdx, playerIdx, p)
          return {
            name: p.name,
            country: p.country ?? '',
            ranking: p.ranking ?? undefined,
            points: p.points ?? undefined,
            action: override.action,
            playerId: override.playerId,
          }
        })
      )

      // Determine dominant draw type for the seed request (most teams win)
      const mainCount = parseResult.teams.filter(t => t.drawType === 'main').length
      const qualCount = parseResult.teams.filter(t => t.drawType === 'qualifying').length
      const dominantDrawType = qualCount > mainCount ? 'qualifying' : 'main'

      const res = await fetch('/api/ops/seed-entry-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournamentId: selectedTournament,
          category,
          drawType: dominantDrawType,
          players: allPlayers,
          metadata: parseResult.metadata,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error ?? 'Seed failed')
      }

      const data: SeedResult = await res.json()
      setSeedResult(data)
      setStage('done')
    } catch (err: unknown) {
      setSeedError(err instanceof Error ? err.message : 'Seed failed')
      setStage('preview')
    }
  }, [parseResult, selectedTournament, category, getPlayerOverride])
  // Note: drawType removed from deps — now computed from parseResult

  // ── Reset ──────────────────────────────────────────────────────

  // ── Draw handlers ────────────────────────────────────────────────

  const handleDrawFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) setDrawFile(file)
  }, [])

  const handleDrawParse = useCallback(async () => {
    if (!drawFile || !selectedTournament) return
    setDrawParseError(null)
    setDrawStage('parsing')

    try {
      const form = new FormData()
      form.append('file', drawFile)
      const res = await fetch('/api/ops/parse-draw', { method: 'POST', body: form })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error ?? 'Parse failed')
      }

      const data: DrawParseResult = await res.json()
      setDrawParseResult(data)
      setDrawStage('preview')
    } catch (err: unknown) {
      setDrawParseError(err instanceof Error ? err.message : 'Parse failed')
      setDrawStage('idle')
    }
  }, [drawFile, selectedTournament])

  const handleDrawSeed = useCallback(async () => {
    if (!drawParseResult || !selectedTournament) return
    setDrawStage('seeding')

    try {
      // Merge team_points from seededTeams into entries
      const seededMap = new Map(drawParseResult.seededTeams.map(s => [s.seed, s.points]))
      const entries = drawParseResult.entries.map(e => ({
        ...e,
        teamPoints: e.seed ? seededMap.get(e.seed) ?? null : null,
      }))

      const res = await fetch('/api/ops/seed-draw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournamentId: selectedTournament,
          category,
          entries,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error ?? 'Seed failed')
      }

      const data: DrawSeedResult = await res.json()
      setDrawSeedResult(data)
      setDrawStage('done')
    } catch (err: unknown) {
      setDrawParseError(err instanceof Error ? err.message : 'Seed failed')
      setDrawStage('preview')
    }
  }, [drawParseResult, selectedTournament, category])

  const handleDrawReset = useCallback(() => {
    setDrawStage('idle')
    setDrawFile(null)
    setDrawParseResult(null)
    setDrawSeedResult(null)
    setDrawParseError(null)
    if (drawFileInputRef.current) drawFileInputRef.current.value = ''
  }, [])

  const handleReset = useCallback(() => {
    setStage('select')
    setParseResult(null)
    setSeedResult(null)
    setParseError(null)
    setSeedError(null)
    setSelectedFile(null)
    setPasteText('')
    setPlayerOverrides({})
    setSearchPopoverKey(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    // Also reset draw state
    handleDrawReset()
  }, [handleDrawReset])

  const canParse =
    selectedTournament &&
    (inputMode === 'upload' ? !!selectedFile : pasteText.trim().length > 0)

  // ── Render: Select ─────────────────────────────────────────────

  if (stage === 'select' || stage === 'parsing') {
    return (
      <div className="entry-list-tab">
        <style>{`
          .entry-list-tab input, .entry-list-tab select, .entry-list-tab textarea { color: #111 !important; }
        `}</style>
        {parseError && (
          <div style={{ ...card, background: '#fef2f2', border: '1px solid #fecaca', marginBottom: 16, color: '#dc2626', fontSize: 12 }}>
            {parseError}
          </div>
        )}

        {/* Tournament selector — typeahead */}
        <div style={{ ...card, marginBottom: 12 }}>
          <div style={sectionLabel}>Tournament</div>
          {loadingTournaments ? (
            <div style={{ fontSize: 12, color: '#999' }}>Loading tournaments...</div>
          ) : tournamentError ? (
            <div style={{ fontSize: 12, color: '#dc2626' }}>{tournamentError}</div>
          ) : selectedTournamentObj ? (
            /* Selected chip */
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 10px', borderRadius: 6,
              background: '#f0f4ff', border: '1px solid #c7d2fe',
            }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: urgencyDot(selectedTournamentObj).color, flexShrink: 0 }} />
              <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#111' }}>
                {selectedTournamentObj.name}
                {selectedTournamentObj.country && <span style={{ color: '#888', fontWeight: 400, marginLeft: 4 }}>({selectedTournamentObj.country})</span>}
              </div>
              <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 4px', borderRadius: 3, background: selectedTournamentObj.hasEntryList ? '#dcfce7' : '#fef2f2', color: selectedTournamentObj.hasEntryList ? '#166534' : '#dc2626' }}>EL</span>
                <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 4px', borderRadius: 3, background: selectedTournamentObj.hasDraw ? '#dcfce7' : '#fef2f2', color: selectedTournamentObj.hasDraw ? '#166534' : '#dc2626' }}>DR</span>
              </div>
              <select
                value={selectedTournamentObj.categories ?? 'both'}
                onChange={async (e) => {
                  const newCat = e.target.value
                  await fetch('/api/ops/seed-entry-list', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tournamentId: selectedTournament, categories: newCat }),
                  })
                  // Refresh tournament list to reflect updated status
                  setTournaments(prev => prev.map(t => t.id === selectedTournament ? { ...t, categories: newCat } : t))
                }}
                style={{
                  background: '#222', color: '#fff', border: '1px solid #444',
                  borderRadius: 4, fontSize: 10, fontWeight: 700, padding: '2px 4px',
                  cursor: 'pointer',
                }}
                title="Tournament gender categories"
              >
                <option value="both">M+W</option>
                <option value="men_only">Men only</option>
                <option value="women_only">Women only</option>
              </select>
              <button
                onClick={handleDeselectTournament}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#6b7280', padding: '0 2px', lineHeight: 1 }}
                title="Deselect tournament"
              >&times;</button>
            </div>
          ) : (
            /* Typeahead search input + dropdown */
            <div ref={typeaheadRef} style={{ position: 'relative' }}>
              <input
                type="text"
                value={tournamentSearch}
                onChange={e => { setTournamentSearch(e.target.value); setTypeaheadOpen(true) }}
                onFocus={() => setTypeaheadOpen(true)}
                onKeyDown={e => { if (e.key === 'Escape') setTypeaheadOpen(false) }}
                placeholder="Search tournaments by name, country, or level..."
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  border: '1px solid #e5e7eb',
                  borderRadius: 6,
                  fontSize: 13,
                  color: '#111',
                  background: 'white',
                  boxSizing: 'border-box',
                }}
              />
              {typeaheadOpen && filteredTournaments.length > 0 && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0,
                  background: 'white', border: '1px solid #e5e7eb', borderRadius: 6,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 50,
                  maxHeight: 320, overflowY: 'auto', marginTop: 4,
                }}>
                  {filteredTournaments.map(t => {
                    const dot = urgencyDot(t)
                    return (
                      <div
                        key={t.id}
                        onClick={() => handleSelectTournament(t.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '7px 10px', cursor: 'pointer',
                          borderBottom: '1px solid #f3f4f6',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#f9fafb')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: dot.color, flexShrink: 0 }} />
                        <div style={{ flex: 1, fontSize: 12, color: '#111' }}>
                          {t.name}
                          {t.country && <span style={{ color: '#999', marginLeft: 4 }}>({t.country})</span>}
                        </div>
                        <div style={{ fontSize: 10, color: '#888', display: 'flex', gap: 4, alignItems: 'center' }}>
                          {dot.label}
                          <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 4px', borderRadius: 3, background: t.hasEntryList ? '#dcfce7' : '#fef2f2', color: t.hasEntryList ? '#166534' : '#dc2626' }}>EL</span>
                          <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 4px', borderRadius: 3, background: t.hasDraw ? '#dcfce7' : '#fef2f2', color: t.hasDraw ? '#166534' : '#dc2626' }}>DR</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              {typeaheadOpen && tournamentSearch.trim() && filteredTournaments.length === 0 && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0,
                  background: 'white', border: '1px solid #e5e7eb', borderRadius: 6,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 50,
                  padding: '12px 10px', marginTop: 4,
                  fontSize: 12, color: '#999', textAlign: 'center',
                }}>
                  No tournaments match &ldquo;{tournamentSearch}&rdquo;
                </div>
              )}
            </div>
          )}

          {/* Urgency legend */}
          {!loadingTournaments && !tournamentError && sortedTournaments.length > 0 && (
            <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
              {[
                { color: '#ef4444', label: 'Starting soon (3d)' },
                { color: '#f59e0b', label: 'This week (4-7d)' },
                { color: '#22c55e', label: 'Upcoming (8-30d)' },
                { color: '#9ca3af', label: 'In progress' },
              ].map(item => (
                <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 10, color: '#666' }}>{item.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Category toggle */}
        <div style={{ ...card, marginBottom: 12 }}>
          <div style={sectionLabel}>Category</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['men', 'women'] as Category[]).map(c => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                style={{
                  padding: '6px 18px',
                  borderRadius: 999,
                  border: 'none',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: category === c ? '#3b82f6' : '#f3f4f6',
                  color: category === c ? '#fff' : '#374151',
                  transition: 'background 0.15s',
                }}
              >
                {c.charAt(0).toUpperCase() + c.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Input mode tabs */}
        <div style={{ ...card, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 0, marginBottom: 14, borderBottom: '1px solid #e5e7eb' }}>
            {(['upload', 'paste'] as InputMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setInputMode(mode)}
                style={{
                  padding: '6px 16px',
                  fontSize: 12,
                  fontWeight: inputMode === mode ? 700 : 500,
                  color: inputMode === mode ? '#111' : '#888',
                  background: 'none',
                  border: 'none',
                  borderBottom: inputMode === mode ? '2px solid #111' : '2px solid transparent',
                  cursor: 'pointer',
                  marginBottom: -1,
                }}
              >
                {mode === 'upload' ? 'Upload PDF' : 'Paste Text'}
              </button>
            ))}
          </div>

          {inputMode === 'upload' ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
              <div
                onClick={() => fileInputRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                style={{
                  border: `2px dashed ${dragOver ? '#3b82f6' : '#d1d5db'}`,
                  borderRadius: 8,
                  padding: '28px 16px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: dragOver ? '#eff6ff' : '#fafafa',
                  transition: 'all 0.15s',
                }}
              >
                {selectedFile ? (
                  <div>
                    <div style={{ fontSize: 22, marginBottom: 4 }}>📄</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>{selectedFile.name}</div>
                    <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                      {(selectedFile.size / 1024).toFixed(1)} KB · Click to change
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 22, marginBottom: 4 }}>📁</div>
                    <div style={{ fontSize: 13, color: '#555' }}>
                      Drop PDF here or <span style={{ color: '#3b82f6', textDecoration: 'underline' }}>browse</span>
                    </div>
                    <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>PDF files only</div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              placeholder="Paste entry list text here..."
              style={{
                width: '100%',
                minHeight: 160,
                padding: '8px 10px',
                border: '1px solid #e5e7eb',
                borderRadius: 6,
                fontSize: 12,
                fontFamily: 'monospace',
                resize: 'vertical',
                color: '#111',
                boxSizing: 'border-box',
              }}
            />
          )}
        </div>

        {/* Parse button */}
        <button
          onClick={handleParse}
          disabled={!canParse || stage === 'parsing'}
          style={{
            width: '100%',
            padding: '10px 0',
            borderRadius: 8,
            border: 'none',
            fontSize: 14,
            fontWeight: 700,
            cursor: canParse && stage !== 'parsing' ? 'pointer' : 'not-allowed',
            background: canParse && stage !== 'parsing' ? '#3b82f6' : '#e5e7eb',
            color: canParse && stage !== 'parsing' ? '#fff' : '#9ca3af',
            transition: 'background 0.15s',
          }}
        >
          {stage === 'parsing' ? 'Parsing...' : 'Parse Entry List'}
        </button>

        {stage === 'parsing' && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16, color: '#666', fontSize: 13 }}>
            <Spinner />
            Extracting players from entry list...
          </div>
        )}

        {/* ── Draw Upload Section ──────────────────────────────────── */}
        <div style={{ marginTop: 24, borderTop: '1px solid #e5e7eb', paddingTop: 16 }}>
          <div style={sectionLabel}>Upload Draw PDF</div>

          {drawParseError && (
            <div style={{ ...card, background: '#fef2f2', border: '1px solid #fecaca', marginBottom: 12, color: '#dc2626', fontSize: 12 }}>
              {drawParseError}
            </div>
          )}

          {drawStage === 'idle' && (
            <div style={{ ...card, marginBottom: 12 }}>
              <input
                ref={drawFileInputRef}
                type="file"
                accept=".pdf"
                style={{ display: 'none' }}
                onChange={handleDrawFileChange}
              />
              <div
                onClick={() => drawFileInputRef.current?.click()}
                style={{
                  border: '2px dashed #d1d5db',
                  borderRadius: 8,
                  padding: '20px 16px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: '#fafafa',
                }}
              >
                {drawFile ? (
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>{drawFile.name}</div>
                    <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                      {(drawFile.size / 1024).toFixed(1)} KB · Click to change
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 13, color: '#555' }}>
                      Drop draw PDF here or <span style={{ color: '#3b82f6', textDecoration: 'underline' }}>browse</span>
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={handleDrawParse}
                disabled={!drawFile || !selectedTournament}
                style={{
                  width: '100%',
                  marginTop: 8,
                  padding: '8px 0',
                  borderRadius: 8,
                  border: 'none',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: drawFile && selectedTournament ? 'pointer' : 'not-allowed',
                  background: drawFile && selectedTournament ? '#8b5cf6' : '#e5e7eb',
                  color: drawFile && selectedTournament ? '#fff' : '#9ca3af',
                }}
              >
                Parse Draw
              </button>
            </div>
          )}

          {drawStage === 'parsing' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 20, color: '#666', fontSize: 13 }}>
              <Spinner />
              Parsing draw PDF...
            </div>
          )}

          {drawStage === 'preview' && drawParseResult && (
            <div>
              <div style={{ ...card, marginBottom: 12 }}>
                <div style={sectionLabel}>
                  Draw Preview — {drawParseResult.metadata.drawSize} slots
                  {drawParseResult.metadata.releaseDate && (
                    <span style={{ fontWeight: 400, color: '#888', marginLeft: 8 }}>Released {drawParseResult.metadata.releaseDate}</span>
                  )}
                </div>
                <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
                  <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                        <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: '#666', width: 30 }}>#</th>
                        <th style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 600, color: '#666', width: 40 }}>Seed</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Player 1</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Player 2</th>
                        <th style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 600, color: '#666', width: 36 }}>Tag</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drawParseResult.entries.map((entry, i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb', borderBottom: '1px solid #f3f4f6' }}>
                          <td style={{ padding: '5px 8px', color: '#999', fontSize: 10 }}>{entry.drawPosition}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'center', fontWeight: 700, color: '#3b82f6' }}>{entry.seed ?? ''}</td>
                          <td style={{ padding: '5px 8px', color: '#111' }}>
                            {entry.player1Name}
                            {entry.player1Country && <span style={{ color: '#999', marginLeft: 4 }}>({entry.player1Country})</span>}
                          </td>
                          <td style={{ padding: '5px 8px', color: '#111' }}>
                            {entry.player2Name}
                            {entry.player2Country && <span style={{ color: '#999', marginLeft: 4 }}>({entry.player2Country})</span>}
                          </td>
                          <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                            {entry.marker && (
                              <span style={{
                                fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                                background: entry.marker === 'Q' ? '#dbeafe' : entry.marker === 'WC' ? '#fef3c7' : '#f3e8ff',
                                color: entry.marker === 'Q' ? '#1e40af' : entry.marker === 'WC' ? '#92400e' : '#6b21a8',
                              }}>{entry.marker}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleDrawReset} style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'white', color: '#374151' }}>
                  Back
                </button>
                <button onClick={handleDrawSeed} style={{ flex: 2, padding: '8px 0', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', background: '#8b5cf6', color: '#fff' }}>
                  Seed {drawParseResult.entries.length} Draw Slots
                </button>
              </div>
            </div>
          )}

          {drawStage === 'seeding' && (
            <div style={{ textAlign: 'center', padding: 20 }}>
              <Spinner />
              <div style={{ fontSize: 13, color: '#555', marginTop: 8 }}>Seeding draw data...</div>
            </div>
          )}

          {drawStage === 'done' && drawSeedResult && (
            <div style={{ ...card }}>
              <div style={{ textAlign: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 22, marginBottom: 4 }}>✅</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>Draw Seeded</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 9, color: '#aaa', textTransform: 'uppercase' as const, fontWeight: 600 }}>Slots</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#111' }}>{drawSeedResult.slots}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 9, color: '#aaa', textTransform: 'uppercase' as const, fontWeight: 600 }}>Resolved</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#22c55e' }}>{drawSeedResult.resolved}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 9, color: '#aaa', textTransform: 'uppercase' as const, fontWeight: 600 }}>Created</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#3b82f6' }}>{drawSeedResult.created}</div>
                </div>
              </div>
              {drawSeedResult.errors.length > 0 && (
                <div style={{ fontSize: 11, color: '#dc2626' }}>
                  {drawSeedResult.errors.map((err, i) => <div key={i}>• {err}</div>)}
                </div>
              )}
              <button onClick={handleDrawReset} style={{ width: '100%', marginTop: 8, padding: '8px 0', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', background: '#8b5cf6', color: '#fff' }}>
                Upload Another Draw
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Render: Preview ────────────────────────────────────────────

  if (stage === 'preview') {
    const meta = parseResult?.metadata ?? {}
    const teams = parseResult?.teams ?? []
    const mainTeams = teams.filter(t => t.drawType === 'main')
    const qualTeams = teams.filter(t => t.drawType === 'qualifying')

    // Compute global team index offset for override keys
    const teamGlobalIndex = (sectionTeams: ParsedTeam[]) => {
      return sectionTeams.map(t => teams.indexOf(t))
    }

    const renderTeamTable = (sectionTeams: ParsedTeam[], label: string) => {
      const globalIndices = teamGlobalIndex(sectionTeams)
      return (
      <div style={{ ...card, marginBottom: 12, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '8px 10px', background: '#f3f4f6', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, textTransform: 'uppercase' as const,
            background: label === 'Main Draw' ? '#d1fae5' : '#fef3c7',
            color: label === 'Main Draw' ? '#065f46' : '#92400e',
          }}>{label}</span>
          <span style={{ fontSize: 11, color: '#888' }}>{sectionTeams.length} teams · {sectionTeams.length * 2} players</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse', minWidth: 700 }}>
          <thead>
            <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
              <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: '#666', width: 32 }}>#</th>
              <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Name</th>
              <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: '#666', width: 50 }}>Country</th>
              <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: '#666', width: 50 }}>Rank</th>
              <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: '#666', width: 60 }}>Points</th>
              <th style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 600, color: '#666', width: 60 }}>DB Match</th>
              <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: '#666', width: 150 }}>Player ID</th>
              <th style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 600, color: '#666', width: 64 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {sectionTeams.map((team, ti) => {
              const teamBg = ti % 2 === 0 ? '#ffffff' : '#f9fafb'
              const gIdx = globalIndices[ti]
              return team.players.map((player, pi) => {
                const override = getPlayerOverride(gIdx, pi, player)
                const overrideKey = `${gIdx}-${pi}`
                const isNew = player.matchStatus === 'new'
                const currentPlayerId = override.playerId ?? player.matchedPlayerId ?? ''
                return (
                <tr
                  key={`${team.teamNumber}-${team.drawType}-${pi}`}
                  style={{ background: teamBg, borderBottom: '1px solid #f3f4f6' }}
                >
                  <td style={{ padding: '5px 8px', color: '#999', fontSize: 10 }}>
                    {pi === 0 ? (
                      <>
                        {team.teamNumber}
                        {team.isWildCard && (
                          <span style={{ marginLeft: 3, fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 3, background: '#fef3c7', color: '#92400e', verticalAlign: 'middle' }}>WC</span>
                        )}
                      </>
                    ) : ''}
                  </td>
                  <td style={{ padding: '5px 8px', fontWeight: 500, color: '#111' }}>
                    {player.name}
                    {player.ranking !== null && player.ranking <= 100 && isNew && (
                      <span title="Top-100 player not found in DB" style={{ color: '#FF4655', marginLeft: 4, cursor: 'help' }}>&#9888;</span>
                    )}
                  </td>
                  <td style={{ padding: '5px 8px', color: '#555' }}>{player.country ?? '—'}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: '#555' }}>
                    {player.ranking !== null ? player.ranking : '—'}
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: '#555' }}>
                    {player.points !== null ? player.points.toLocaleString() : '—'}
                  </td>
                  {/* DB Match column */}
                  <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                    <span style={{
                      fontSize: 9,
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: 3,
                      clipPath: 'polygon(3% 8%, 97% 0%, 98% 92%, 1% 100%)',
                      display: 'inline-block',
                      ...(player.matchStatus === 'exact'
                        ? { background: '#7ED321', color: '#fff' }
                        : player.matchStatus === 'fuzzy'
                        ? { background: '#F5A623', color: '#fff' }
                        : { background: '#4A9EFF', color: '#fff' }),
                    }}>
                      {player.matchStatus === 'exact' ? 'EXACT' : player.matchStatus === 'fuzzy' ? 'FUZZY' : 'NEW'}
                    </span>
                  </td>
                  {/* Player ID column */}
                  <td style={{ padding: '5px 8px', position: 'relative' }}>
                    {!isNew || override.action === 'link' ? (
                      <span
                        title={`${currentPlayerId}${player.matchedPlayerName ? ' — ' + player.matchedPlayerName : ''}`}
                        style={{ fontSize: 10, fontFamily: 'monospace', color: '#666', cursor: 'help' }}
                      >
                        {currentPlayerId ? currentPlayerId.slice(0, 8) + '...' : '—'}
                      </span>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        <input
                          type="text"
                          value={override.playerId ?? ''}
                          onChange={e => setPlayerOverride(gIdx, pi, { playerId: e.target.value || undefined })}
                          placeholder="paste UUID"
                          style={{
                            width: 110, padding: '3px 5px', fontSize: 10, fontFamily: 'monospace',
                            border: '1px solid #d1d5db', borderRadius: 4, color: '#333',
                          }}
                        />
                        <button
                          onClick={() => {
                            setSearchPopoverKey(overrideKey)
                            setSearchPopoverQuery('')
                            setSearchPopoverResults([])
                          }}
                          title="Search for player"
                          style={{
                            background: 'none', border: '1px solid #d1d5db', borderRadius: 4,
                            cursor: 'pointer', padding: '2px 5px', fontSize: 12, lineHeight: 1,
                          }}
                        >&#128269;</button>
                        {/* Search popover */}
                        {searchPopoverKey === overrideKey && (
                          <div
                            id="player-search-popover"
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
                              value={searchPopoverQuery}
                              onChange={e => handlePlayerSearch(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Escape') setSearchPopoverKey(null) }}
                              placeholder="Search by name..."
                              style={{
                                width: '100%', padding: '5px 7px', fontSize: 11,
                                border: '1px solid #d1d5db', borderRadius: 4, marginBottom: 4,
                                boxSizing: 'border-box',
                              }}
                            />
                            {searchPopoverLoading && <div style={{ fontSize: 10, color: '#888', padding: 4 }}>Searching...</div>}
                            {!searchPopoverLoading && searchPopoverResults.length === 0 && searchPopoverQuery.trim() && (
                              <div style={{ fontSize: 10, color: '#999', padding: 4 }}>No results</div>
                            )}
                            {searchPopoverResults.map(r => (
                              <div
                                key={r.id}
                                onClick={() => {
                                  setPlayerOverride(gIdx, pi, { playerId: r.id, action: 'link' })
                                  setSearchPopoverKey(null)
                                }}
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
                        )}
                      </div>
                    )}
                  </td>
                  {/* Action column */}
                  <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                    <button
                      onClick={() => {
                        const newAction = override.action === 'link' ? 'create' : 'link'
                        setPlayerOverride(gIdx, pi, { action: newAction })
                      }}
                      style={{
                        fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                        border: 'none', cursor: 'pointer',
                        background: override.action === 'link' ? '#7ED321' : '#4A9EFF',
                        color: '#fff',
                      }}
                    >
                      {override.action === 'link' ? 'Link' : 'Create'}
                    </button>
                  </td>
                </tr>
                )
              })
            })}
            {sectionTeams.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: '20px', textAlign: 'center', color: '#999' }}>
                  No players found
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
      )
    }

    return (
      <div>
        {seedError && (
          <div style={{ ...card, background: '#fef2f2', border: '1px solid #fecaca', marginBottom: 16, color: '#dc2626', fontSize: 12 }}>
            {seedError}
          </div>
        )}

        {/* Metadata info bar */}
        <div style={{ ...card, marginBottom: 12 }}>
          <div style={{ ...sectionLabel, display: 'flex', alignItems: 'center', gap: 8 }}>
            {meta.title ?? 'Parsed Entry List'}
            <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: '#dbeafe', color: '#1e40af', textTransform: 'uppercase' }}>{meta.category ?? category}</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            {meta.filename && (
              <div>
                <div style={{ fontSize: 9, color: '#aaa', textTransform: 'uppercase' as const, fontWeight: 600 }}>File</div>
                <div style={{ fontSize: 12, color: '#333', fontWeight: 500 }}>{meta.filename}</div>
              </div>
            )}
            {meta.version && (
              <div>
                <div style={{ fontSize: 9, color: '#aaa', textTransform: 'uppercase' as const, fontWeight: 600 }}>Version</div>
                <div style={{ fontSize: 12, color: '#333', fontWeight: 500 }}>{meta.version}</div>
              </div>
            )}
            {meta.lastUpdate && (
              <div>
                <div style={{ fontSize: 9, color: '#aaa', textTransform: 'uppercase' as const, fontWeight: 600 }}>Last Update</div>
                <div style={{ fontSize: 12, color: '#333', fontWeight: 500 }}>{meta.lastUpdate}</div>
              </div>
            )}
            {meta.modified && (
              <div>
                <div style={{ fontSize: 9, color: '#aaa', textTransform: 'uppercase' as const, fontWeight: 600 }}>PDF Modified</div>
                <div style={{ fontSize: 12, color: '#333', fontWeight: 500 }}>{meta.modified}</div>
              </div>
            )}
            {meta.pages !== undefined && (
              <div>
                <div style={{ fontSize: 9, color: '#aaa', textTransform: 'uppercase' as const, fontWeight: 600 }}>Pages</div>
                <div style={{ fontSize: 12, color: '#333', fontWeight: 500 }}>{meta.pages}</div>
              </div>
            )}
            <div>
              <div style={{ fontSize: 9, color: '#aaa', textTransform: 'uppercase' as const, fontWeight: 600 }}>Teams</div>
              <div style={{ fontSize: 12, color: '#333', fontWeight: 500 }}>
                {teams.length}
                {mainTeams.length > 0 && qualTeams.length > 0 && (
                  <span style={{ color: '#888', fontWeight: 400 }}> ({mainTeams.length} MD + {qualTeams.length} Q)</span>
                )}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: '#aaa', textTransform: 'uppercase' as const, fontWeight: 600 }}>Players</div>
              <div style={{ fontSize: 12, color: '#333', fontWeight: 500 }}>{parseResult?.playerCount ?? 0}</div>
            </div>
          </div>
        </div>

        {/* Player tables grouped by draw type */}
        {mainTeams.length > 0 && renderTeamTable(mainTeams, 'Main Draw')}
        {qualTeams.length > 0 && renderTeamTable(qualTeams, 'Qualifying')}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleReset}
            style={{
              flex: 1,
              padding: '10px 0',
              borderRadius: 8,
              border: '1px solid #e5e7eb',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              background: 'white',
              color: '#374151',
            }}
          >
            Back
          </button>
          <button
            onClick={handleSeed}
            disabled={teams.length === 0}
            style={{
              flex: 2,
              padding: '10px 0',
              borderRadius: 8,
              border: 'none',
              fontSize: 14,
              fontWeight: 700,
              cursor: teams.length > 0 ? 'pointer' : 'not-allowed',
              background: teams.length > 0 ? '#22c55e' : '#e5e7eb',
              color: teams.length > 0 ? '#fff' : '#9ca3af',
              transition: 'background 0.15s',
            }}
          >
            Seed {parseResult?.playerCount ?? 0} Players
          </button>
        </div>
      </div>
    )
  }

  // ── Render: Seeding ────────────────────────────────────────────

  if (stage === 'seeding') {
    return (
      <div style={{ ...card, textAlign: 'center', padding: '40px 20px' }}>
        <Spinner size={32} />
        <div style={{ fontSize: 14, color: '#555', marginTop: 16 }}>Seeding players to database...</div>
        <div style={{ fontSize: 11, color: '#aaa', marginTop: 6 }}>This may take a moment</div>
      </div>
    )
  }

  // ── Render: Done ───────────────────────────────────────────────

  if (stage === 'done' && seedResult) {
    return (
      <div>
        <div style={{ ...card, textAlign: 'center', padding: '32px 20px', marginBottom: 12 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#111', marginBottom: 4 }}>Seeding Complete</div>
          <div style={{ fontSize: 13, color: '#666' }}>Entry list has been seeded successfully</div>
        </div>

        {/* Summary tiles */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
          <div style={{ ...card, textAlign: 'center' }}>
            <div style={{ fontSize: 9, color: '#aaa', textTransform: 'uppercase' as const, fontWeight: 600, marginBottom: 4 }}>Linked</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: '#22c55e' }}>{seedResult.linked}</div>
          </div>
          <div style={{ ...card, textAlign: 'center' }}>
            <div style={{ fontSize: 9, color: '#aaa', textTransform: 'uppercase' as const, fontWeight: 600, marginBottom: 4 }}>Created</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: '#3b82f6' }}>{seedResult.created}</div>
          </div>
          <div style={{ ...card, textAlign: 'center' }}>
            <div style={{ fontSize: 9, color: '#aaa', textTransform: 'uppercase' as const, fontWeight: 600, marginBottom: 4 }}>Total</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: '#111' }}>{seedResult.total}</div>
          </div>
        </div>

        {/* Errors */}
        {seedResult.errors.length > 0 && (
          <div style={{ ...card, background: '#fef2f2', border: '1px solid #fecaca', marginBottom: 16 }}>
            <div style={{ ...sectionLabel, color: '#dc2626' }}>Errors ({seedResult.errors.length})</div>
            {seedResult.errors.map((err, i) => (
              <div key={i} style={{ fontSize: 11, color: '#dc2626', marginBottom: 2 }}>• {err}</div>
            ))}
          </div>
        )}

        <button
          onClick={handleReset}
          style={{
            width: '100%',
            padding: '10px 0',
            borderRadius: 8,
            border: 'none',
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
            background: '#3b82f6',
            color: '#fff',
          }}
        >
          Seed Another
        </button>
      </div>
    )
  }

  return null
}

// ── Spinner ──────────────────────────────────────────────────────

function Spinner({ size = 18 }: { size?: number }) {
  return (
    <span style={{
      display: 'inline-block',
      width: size,
      height: size,
      border: `${Math.max(2, Math.round(size / 8))}px solid #e5e7eb`,
      borderTop: `${Math.max(2, Math.round(size / 8))}px solid #3b82f6`,
      borderRadius: '50%',
      animation: 'spin 0.7s linear infinite',
      verticalAlign: 'middle',
    }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </span>
  )
}

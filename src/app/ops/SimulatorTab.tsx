'use client'
// src/app/ops/SimulatorTab.tsx
// Simulator tab: tournament management and referee scoring panel.

import { useState, useEffect, useCallback } from 'react'
import {
  createInitialState,
  addPoint,
  undoPoint,
  quickGame,
  stateToRelayPayload,
  type MatchState,
} from '@/lib/padel-scoring'

// ── Types ─────────────────────────────────────────────────────────

interface SimTournament {
  id: string
  name: string
  category: string
  match_count: number
}

interface SimMatch {
  id: string
  external_id: string
  pair1: string
  pair2: string
  status: 'scheduled' | 'live' | 'finished'
  score: string | null
  round: string | null
}

interface SimPlayer {
  id: string
  name: string
  country: string | null
  ranking: number | null
}

// ── Shared styles ─────────────────────────────────────────────────

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
  letterSpacing: '1px',
  marginBottom: 8,
}

const btnBase: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  border: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
}

const btnGreen: React.CSSProperties = { ...btnBase, background: '#22c55e', color: 'white' }
const btnRed: React.CSSProperties = { ...btnBase, background: '#ef4444', color: 'white' }
const btnGray: React.CSSProperties = { ...btnBase, background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb' }

// ── Sub-components ────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  const color = status === 'live' ? '#22c55e' : status === 'finished' ? '#9ca3af' : '#9ca3af'
  return <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
}

// ── Component ─────────────────────────────────────────────────────

export default function SimulatorTab() {
  // Tournament state
  const [tournaments, setTournaments] = useState<SimTournament[]>([])
  const [selectedTournamentId, setSelectedTournamentId] = useState<string>('')
  const [matches, setMatches] = useState<SimMatch[]>([])
  const [loadingTournaments, setLoadingTournaments] = useState(false)
  const [loadingMatches, setLoadingMatches] = useState(false)

  // New tournament form
  const [showNewForm, setShowNewForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState<'men' | 'women'>('men')
  const [newMatchCount, setNewMatchCount] = useState(4)
  const [newRound, setNewRound] = useState('R16')
  const [availablePlayers, setAvailablePlayers] = useState<SimPlayer[]>([])
  const [playerSearch, setPlayerSearch] = useState('')
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([])
  const [loadingPlayers, setLoadingPlayers] = useState(false)
  const [creating, setCreating] = useState(false)

  // Purge modal
  const [showPurgeModal, setShowPurgeModal] = useState(false)
  const [purgeText, setPurgeText] = useState('')
  const [purging, setPurging] = useState(false)

  // Match scoring
  const [scoringMatchId, setScoringMatchId] = useState<string | null>(null)
  const [scoringExternalId, setScoringExternalId] = useState<string | null>(null)
  const [matchState, setMatchState] = useState<MatchState>(createInitialState())
  const [history, setHistory] = useState<MatchState[]>([])
  const [sending, setSending] = useState(false)

  // ── Data fetching ──────────────────────────────────────────────

  const fetchTournaments = useCallback(async () => {
    setLoadingTournaments(true)
    try {
      const res = await fetch('/api/ops/simulator/tournaments')
      if (res.ok) {
        const json = await res.json()
        setTournaments(json.tournaments ?? [])
      }
    } catch { /* silent */ }
    setLoadingTournaments(false)
  }, [])

  const fetchMatches = useCallback(async (tournamentId: string) => {
    if (!tournamentId) { setMatches([]); return }
    setLoadingMatches(true)
    try {
      const res = await fetch(`/api/ops/simulator/tournaments?id=${tournamentId}`)
      if (res.ok) {
        const json = await res.json()
        setMatches(json.matches ?? [])
      }
    } catch { /* silent */ }
    setLoadingMatches(false)
  }, [])

  const fetchPlayers = useCallback(async (category: string) => {
    setLoadingPlayers(true)
    try {
      const res = await fetch(`/api/ops/simulator/tournaments?players=${category}`)
      if (res.ok) {
        const json = await res.json()
        setAvailablePlayers(json.players ?? [])
      }
    } catch { /* silent */ }
    setLoadingPlayers(false)
  }, [])

  useEffect(() => { fetchTournaments() }, [fetchTournaments])

  useEffect(() => {
    if (selectedTournamentId) fetchMatches(selectedTournamentId)
    else setMatches([])
  }, [selectedTournamentId, fetchMatches])

  useEffect(() => {
    if (showNewForm) {
      fetchPlayers(newCategory)
      setSelectedPlayerIds([])
    }
  }, [showNewForm, newCategory, fetchPlayers])

  // ── Actions ────────────────────────────────────────────────────

  async function handleCreateTournament() {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const res = await fetch('/api/ops/simulator/create-tournament', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          category: newCategory,
          matchCount: newMatchCount,
          round: newRound,
          playerIds: selectedPlayerIds,
        }),
      })
      if (res.ok) {
        const json = await res.json()
        await fetchTournaments()
        setSelectedTournamentId(json.tournament?.id ?? '')
        setShowNewForm(false)
        setNewName('')
        setSelectedPlayerIds([])
      }
    } catch { /* silent */ }
    setCreating(false)
  }

  async function handlePurge() {
    if (purgeText !== 'PURGE') return
    setPurging(true)
    try {
      const res = await fetch('/api/ops/simulator/purge', { method: 'POST' })
      if (res.ok) {
        await fetchTournaments()
        setSelectedTournamentId('')
        setMatches([])
        setScoringMatchId(null)
      }
    } catch { /* silent */ }
    setPurging(false)
    setShowPurgeModal(false)
    setPurgeText('')
  }

  async function sendToRelay(state: MatchState, action: string) {
    if (!scoringMatchId || !scoringExternalId) return
    setSending(true)
    try {
      const payload = stateToRelayPayload(state, scoringMatchId, scoringExternalId, action)
      await fetch('/api/ops/simulator/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      // Refresh match list to reflect new status/score
      if (selectedTournamentId) await fetchMatches(selectedTournamentId)
    } catch { /* silent */ }
    setSending(false)
  }

  async function handleStartMatch(match: SimMatch) {
    setScoringMatchId(match.id)
    setScoringExternalId(match.external_id)
    const initial = createInitialState()
    setMatchState(initial)
    setHistory([])
    // Send start event
    setSending(true)
    try {
      const payload = stateToRelayPayload(initial, match.id, match.external_id, 'start_match')
      await fetch('/api/ops/simulator/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (selectedTournamentId) await fetchMatches(selectedTournamentId)
    } catch { /* silent */ }
    setSending(false)
  }

  async function handlePoint(pair: 1 | 2) {
    if (matchState.status === 'finished') return
    const prevState = matchState
    const newState = addPoint(matchState, pair)
    setHistory(h => [...h, prevState])
    setMatchState(newState)
    const action = newState.status === 'finished' ? 'finish_match' : 'point'
    await sendToRelay(newState, action)
    if (newState.status === 'finished') {
      // Clear scoring panel — match done
      setScoringMatchId(null)
    }
  }

  async function handleQuickGame(pair: 1 | 2) {
    if (matchState.status === 'finished') return
    const { state: newState, history: addedHistory } = quickGame(matchState, pair)
    setHistory(h => [...h, ...addedHistory])
    setMatchState(newState)
    const action = newState.status === 'finished' ? 'finish_match' : 'point'
    await sendToRelay(newState, action)
    if (newState.status === 'finished') {
      setScoringMatchId(null)
    }
  }

  function handleUndo() {
    const { state: prevState, history: newHistory } = undoPoint(matchState, history)
    setMatchState(prevState)
    setHistory(newHistory)
    // No relay call for undo — just local rollback
  }

  async function handleFinishMatch() {
    const finished = { ...matchState, status: 'finished' as const }
    setMatchState(finished)
    await sendToRelay(finished, 'finish_match')
    setScoringMatchId(null)
  }

  // ── Derived values ─────────────────────────────────────────────

  const neededPlayers = newMatchCount * 4
  const filteredPlayers = availablePlayers.filter(p =>
    p.name.toLowerCase().includes(playerSearch.toLowerCase())
  )

  function togglePlayer(id: string) {
    setSelectedPlayerIds(ids =>
      ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]
    )
  }

  const currentSetState = matchState.sets[matchState.currentSet - 1]
  const currentGameState = currentSetState?.games[matchState.currentGame - 1]
  const setsWonP1 = matchState.sets.filter(s => s.winner === 1).length
  const setsWonP2 = matchState.sets.filter(s => s.winner === 2).length
  const canFinish = setsWonP1 > 0 || setsWonP2 > 0

  // Last 8 points for history breadcrumb
  const recentPoints = currentGameState?.points.slice(-8) ?? []

  const scoringMatch = matches.find(m => m.id === scoringMatchId)

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Section 1: Tournament Setup ── */}
      <div>
        <div style={sectionLabel}>Tournament Setup</div>
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {/* Dropdown */}
            <select
              value={selectedTournamentId}
              onChange={e => setSelectedTournamentId(e.target.value)}
              style={{
                padding: '6px 10px', borderRadius: 6, border: '1px solid #e5e7eb',
                fontSize: 13, flex: 1, minWidth: 200, background: 'white',
              }}
              disabled={loadingTournaments}
            >
              <option value="">— Select simulated tournament —</option>
              {tournaments.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.category}, {t.match_count} matches)
                </option>
              ))}
            </select>

            {/* New button */}
            <button
              style={btnGreen}
              onClick={() => { setShowNewForm(v => !v); setPurgeText('') }}
            >
              + New
            </button>

            {/* Purge button */}
            <button
              style={btnRed}
              onClick={() => setShowPurgeModal(true)}
            >
              Purge All
            </button>
          </div>

          {/* New tournament inline form */}
          {showNewForm && (
            <div style={{
              marginTop: 14,
              padding: 14,
              background: '#f9fafb',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#555', marginBottom: 10 }}>
                New Simulated Tournament
              </div>

              {/* Row 1: name + round */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 10, marginBottom: 10 }}>
                <div>
                  <label style={{ fontSize: 11, color: '#666', display: 'block', marginBottom: 3 }}>Name</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder="Sim Tournament 1"
                    style={{ width: '100%', padding: '6px 8px', borderRadius: 5, border: '1px solid #d1d5db', fontSize: 12, boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#666', display: 'block', marginBottom: 3 }}>Round</label>
                  <select
                    value={newRound}
                    onChange={e => setNewRound(e.target.value)}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: 5, border: '1px solid #d1d5db', fontSize: 12, background: 'white' }}
                  >
                    {['QF', 'SF', 'F', 'R16', 'R32', 'RR'].map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Row 2: category + match count */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 10, marginBottom: 12 }}>
                <div>
                  <label style={{ fontSize: 11, color: '#666', display: 'block', marginBottom: 3 }}>Category</label>
                  <select
                    value={newCategory}
                    onChange={e => setNewCategory(e.target.value as 'men' | 'women')}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: 5, border: '1px solid #d1d5db', fontSize: 12, background: 'white' }}
                  >
                    <option value="men">Men</option>
                    <option value="women">Women</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#666', display: 'block', marginBottom: 3 }}>Match count</label>
                  <input
                    type="number"
                    min={1}
                    max={16}
                    value={newMatchCount}
                    onChange={e => setNewMatchCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: 5, border: '1px solid #d1d5db', fontSize: 12, boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              {/* Player picker */}
              <div>
                <div style={{ fontSize: 11, color: '#666', marginBottom: 5, display: 'flex', justifyContent: 'space-between' }}>
                  <span>Players</span>
                  <span style={{ color: selectedPlayerIds.length === neededPlayers ? '#22c55e' : '#f59e0b', fontWeight: 600 }}>
                    {selectedPlayerIds.length} / {neededPlayers} needed
                  </span>
                </div>
                <input
                  type="text"
                  placeholder="Search players..."
                  value={playerSearch}
                  onChange={e => setPlayerSearch(e.target.value)}
                  style={{ width: '100%', padding: '5px 8px', borderRadius: 5, border: '1px solid #d1d5db', fontSize: 12, marginBottom: 6, boxSizing: 'border-box' }}
                />
                {loadingPlayers ? (
                  <div style={{ fontSize: 11, color: '#aaa', padding: '8px 0' }}>Loading players...</div>
                ) : (
                  <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 5, background: 'white' }}>
                    {filteredPlayers.length === 0 && (
                      <div style={{ fontSize: 11, color: '#aaa', padding: 10 }}>No players found</div>
                    )}
                    {filteredPlayers.map(p => {
                      const selected = selectedPlayerIds.includes(p.id)
                      return (
                        <div
                          key={p.id}
                          onClick={() => togglePlayer(p.id)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '6px 10px',
                            cursor: 'pointer',
                            background: selected ? 'rgba(34,197,94,0.08)' : 'transparent',
                            borderBottom: '1px solid #f3f4f6',
                            transition: 'background 0.1s',
                          }}
                        >
                          <div style={{
                            width: 14, height: 14, borderRadius: 3,
                            border: `2px solid ${selected ? '#22c55e' : '#d1d5db'}`,
                            background: selected ? '#22c55e' : 'transparent',
                            flexShrink: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            {selected && <span style={{ color: 'white', fontSize: 9, lineHeight: 1 }}>✓</span>}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 500, color: '#111' }}>{p.name}</div>
                          </div>
                          <div style={{ fontSize: 10, color: '#999', display: 'flex', gap: 6, flexShrink: 0 }}>
                            {p.country && <span>{p.country}</span>}
                            {p.ranking && <span>#{p.ranking}</span>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Form actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                <button
                  style={btnGray}
                  onClick={() => { setShowNewForm(false); setNewName(''); setSelectedPlayerIds([]) }}
                >
                  Cancel
                </button>
                <button
                  style={{ ...btnGreen, opacity: !newName.trim() || creating ? 0.6 : 1 }}
                  disabled={!newName.trim() || creating}
                  onClick={handleCreateTournament}
                >
                  {creating ? 'Creating...' : 'Create'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Section 2: Match List ── */}
      {selectedTournamentId && (
        <div>
          <div style={sectionLabel}>Matches</div>
          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            {loadingMatches ? (
              <div style={{ padding: 16, fontSize: 12, color: '#aaa', textAlign: 'center' }}>
                Loading matches...
              </div>
            ) : matches.length === 0 ? (
              <div style={{ padding: 16, fontSize: 12, color: '#aaa', textAlign: 'center' }}>
                No matches in this tournament
              </div>
            ) : (
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                    <th style={{ padding: '7px 12px', textAlign: 'left', fontWeight: 600, color: '#666', width: 20 }}></th>
                    <th style={{ padding: '7px 12px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Pair 1</th>
                    <th style={{ padding: '7px 12px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Pair 2</th>
                    <th style={{ padding: '7px 12px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Score</th>
                    <th style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 600, color: '#666' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map(m => {
                    const isScoring = m.id === scoringMatchId
                    const [p1a, p1b] = (m.pair1 ?? '').split(' / ')
                    const [p2a, p2b] = (m.pair2 ?? '').split(' / ')
                    return (
                      <tr
                        key={m.id}
                        style={{
                          borderBottom: '1px solid #f3f4f6',
                          background: isScoring ? 'rgba(34,197,94,0.04)' : 'transparent',
                          outline: isScoring ? '1px solid rgba(34,197,94,0.3)' : 'none',
                          opacity: m.status === 'finished' && !isScoring ? 0.55 : 1,
                        }}
                      >
                        <td style={{ padding: '8px 12px' }}>
                          <StatusDot status={m.status} />
                        </td>
                        <td style={{ padding: '8px 12px', color: '#111', lineHeight: 1.4 }}>
                          <div>{p1a}</div>
                          {p1b && <div style={{ color: '#666' }}>{p1b}</div>}
                        </td>
                        <td style={{ padding: '8px 12px', color: '#111', lineHeight: 1.4 }}>
                          <div>{p2a}</div>
                          {p2b && <div style={{ color: '#666' }}>{p2b}</div>}
                        </td>
                        <td style={{ padding: '8px 12px', color: '#555', fontFamily: 'monospace', fontSize: 11 }}>
                          {m.score ?? '—'}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                          {isScoring ? (
                            <span style={{
                              fontSize: 10, fontWeight: 700, color: '#22c55e',
                              background: 'rgba(34,197,94,0.1)', padding: '2px 7px', borderRadius: 4,
                              textTransform: 'uppercase' as const,
                            }}>
                              SCORING
                            </span>
                          ) : m.status === 'live' ? (
                            <button
                              style={{ ...btnGray, fontSize: 11, padding: '4px 10px' }}
                              onClick={() => {
                                setScoringMatchId(m.id)
                                setScoringExternalId(m.external_id)
                                setMatchState(createInitialState())
                                setHistory([])
                              }}
                            >
                              Resume
                            </button>
                          ) : m.status === 'scheduled' ? (
                            <button
                              style={{ ...btnGreen, fontSize: 11, padding: '4px 10px' }}
                              onClick={() => handleStartMatch(m)}
                            >
                              Start
                            </button>
                          ) : (
                            <span style={{
                              fontSize: 10, color: '#9ca3af', background: '#f3f4f6',
                              padding: '2px 7px', borderRadius: 4, fontWeight: 500,
                            }}>
                              Finished
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── Section 3: Referee Panel ── */}
      {scoringMatchId && scoringMatch && (
        <div>
          <div style={sectionLabel}>
            Referee Panel
            {sending && (
              <span style={{ marginLeft: 8, fontSize: 9, color: '#f59e0b', fontWeight: 500 }}>
                Sending to relay...
              </span>
            )}
          </div>
          <div style={{ ...card, background: '#fafafa' }}>

            {/* Match header */}
            <div style={{ textAlign: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
                {scoringMatch.round && <span style={{ marginRight: 6 }}>{scoringMatch.round}</span>}
                {matchState.status === 'live'
                  ? <span style={{ color: '#22c55e', fontWeight: 600 }}>● LIVE</span>
                  : matchState.status === 'finished'
                    ? <span style={{ color: '#9ca3af' }}>Finished</span>
                    : <span style={{ color: '#9ca3af' }}>Scheduled</span>
                }
              </div>
            </div>

            {/* Pair labels row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'center', marginBottom: 10 }}>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#b45309' }}>Pair 1</div>
                <div style={{ fontSize: 11, color: '#666', marginTop: 1 }}>{scoringMatch.pair1}</div>
              </div>
              <div style={{ textAlign: 'center', fontSize: 14, color: '#aaa', fontWeight: 300 }}>vs</div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0d9488' }}>Pair 2</div>
                <div style={{ fontSize: 11, color: '#666', marginTop: 1 }}>{scoringMatch.pair2}</div>
              </div>
            </div>

            {/* Scoreboard */}
            <div style={{
              background: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              padding: '10px 14px',
              marginBottom: 14,
            }}>
              {/* Sets header */}
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${matchState.sets.length + 1}, 1fr)`, gap: 4, textAlign: 'center', marginBottom: 6 }}>
                <div style={{ fontSize: 10, color: '#aaa', fontWeight: 600 }}></div>
                {matchState.sets.map((s, i) => (
                  <div key={i} style={{ fontSize: 10, color: s.winner ? '#9ca3af' : '#22c55e', fontWeight: 600 }}>
                    Set {s.setNumber}{s.isTiebreak ? ' TB' : ''}
                  </div>
                ))}
              </div>

              {/* Pair 1 scores */}
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${matchState.sets.length + 1}, 1fr)`, gap: 4, textAlign: 'center', marginBottom: 4 }}>
                <div style={{ fontSize: 11, color: '#b45309', fontWeight: 700, textAlign: 'left' }}>P1</div>
                {matchState.sets.map((s, i) => (
                  <div key={i} style={{
                    fontSize: 20,
                    fontWeight: 700,
                    color: s.winner === 1 ? '#22c55e' : s.winner === 2 ? '#9ca3af' : '#111',
                  }}>
                    {s.winner !== null ? s.pair1Games : (
                      i === matchState.currentSet - 1
                        ? <span>{s.pair1Games}<span style={{ fontSize: 13, color: '#9ca3af' }}>{currentGameState ? ` (${currentGameState.pair1Points})` : ''}</span></span>
                        : s.pair1Games
                    )}
                  </div>
                ))}
              </div>

              {/* Pair 2 scores */}
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${matchState.sets.length + 1}, 1fr)`, gap: 4, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#0d9488', fontWeight: 700, textAlign: 'left' }}>P2</div>
                {matchState.sets.map((s, i) => (
                  <div key={i} style={{
                    fontSize: 20,
                    fontWeight: 700,
                    color: s.winner === 2 ? '#22c55e' : s.winner === 1 ? '#9ca3af' : '#111',
                  }}>
                    {s.winner !== null ? s.pair2Games : (
                      i === matchState.currentSet - 1
                        ? <span>{s.pair2Games}<span style={{ fontSize: 13, color: '#9ca3af' }}>{currentGameState ? ` (${currentGameState.pair2Points})` : ''}</span></span>
                        : s.pair2Games
                    )}
                  </div>
                ))}
              </div>

              {/* Sets won indicator */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTop: '1px solid #f3f4f6' }}>
                <span style={{ fontSize: 11, color: '#b45309', fontWeight: 600 }}>{setsWonP1} set{setsWonP1 !== 1 ? 's' : ''} won</span>
                <span style={{ fontSize: 11, color: '#0d9488', fontWeight: 600 }}>{setsWonP2} set{setsWonP2 !== 1 ? 's' : ''} won</span>
              </div>
            </div>

            {/* Serving indicator */}
            <div style={{ textAlign: 'center', fontSize: 11, color: '#888', marginBottom: 12 }}>
              Serving: <strong style={{ color: matchState.servingPair === 1 ? '#b45309' : '#0d9488' }}>
                Pair {matchState.servingPair}
              </strong>
            </div>

            {/* Point buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 10 }}>
              <button
                style={{
                  padding: '20px 12px',
                  borderRadius: 10,
                  border: `2px solid rgba(245,158,11,0.3)`,
                  background: `rgba(245,158,11,0.1)`,
                  cursor: matchState.status === 'finished' ? 'not-allowed' : 'pointer',
                  opacity: matchState.status === 'finished' ? 0.4 : 1,
                  textAlign: 'center' as const,
                  transition: 'background 0.1s',
                }}
                disabled={matchState.status === 'finished' || sending}
                onClick={() => handlePoint(1)}
              >
                <div style={{ fontSize: 11, color: '#b45309', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                  POINT
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#f59e0b' }}>Pair 1</div>
              </button>

              <button
                style={{
                  padding: '20px 12px',
                  borderRadius: 10,
                  border: `2px solid rgba(20,184,166,0.3)`,
                  background: `rgba(20,184,166,0.1)`,
                  cursor: matchState.status === 'finished' ? 'not-allowed' : 'pointer',
                  opacity: matchState.status === 'finished' ? 0.4 : 1,
                  textAlign: 'center' as const,
                  transition: 'background 0.1s',
                }}
                disabled={matchState.status === 'finished' || sending}
                onClick={() => handlePoint(2)}
              >
                <div style={{ fontSize: 11, color: '#0d9488', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                  POINT
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#14b8a6' }}>Pair 2</div>
              </button>
            </div>

            {/* Quick actions row */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
              <button
                style={{ ...btnBase, background: 'rgba(245,158,11,0.1)', color: '#b45309', border: '1px solid rgba(245,158,11,0.3)', fontSize: 11 }}
                disabled={matchState.status === 'finished' || sending}
                onClick={() => handleQuickGame(1)}
              >
                Quick Game P1
              </button>
              <button
                style={{ ...btnBase, background: 'rgba(20,184,166,0.1)', color: '#0d9488', border: '1px solid rgba(20,184,166,0.3)', fontSize: 11 }}
                disabled={matchState.status === 'finished' || sending}
                onClick={() => handleQuickGame(2)}
              >
                Quick Game P2
              </button>
              <button
                style={{ ...btnBase, background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', fontSize: 11 }}
                disabled={history.length === 0 || sending}
                onClick={handleUndo}
              >
                ↩ Undo Last
              </button>
            </div>

            {/* Point history breadcrumb */}
            {recentPoints.length > 0 && (
              <div style={{
                padding: '6px 10px',
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: 6,
                marginBottom: 10,
              }}>
                <div style={{ fontSize: 9, color: '#aaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                  Point history (last {recentPoints.length})
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {recentPoints.map((pt, i) => (
                    <span key={i} style={{
                      fontFamily: 'monospace',
                      fontSize: 11,
                      background: 'white',
                      border: '1px solid #e5e7eb',
                      borderRadius: 4,
                      padding: '2px 6px',
                      color: '#555',
                    }}>
                      {pt}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Finish Match */}
            {canFinish && matchState.status !== 'finished' && (
              <div style={{ textAlign: 'center', marginTop: 4 }}>
                <button
                  style={{ ...btnRed, padding: '8px 20px', fontSize: 12 }}
                  disabled={sending}
                  onClick={handleFinishMatch}
                >
                  Finish Match
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Purge modal ── */}
      {showPurgeModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ background: 'white', borderRadius: 12, padding: 24, width: 340, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#111', marginBottom: 8 }}>
              Purge All Simulated Data
            </div>
            <div style={{ fontSize: 12, color: '#666', lineHeight: 1.5, marginBottom: 16 }}>
              This will permanently delete all simulated tournaments, matches, sets, and game data.
              Type <strong>PURGE</strong> to confirm.
            </div>
            <input
              type="text"
              value={purgeText}
              onChange={e => setPurgeText(e.target.value)}
              placeholder="Type PURGE to confirm"
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 6,
                border: `1px solid ${purgeText === 'PURGE' ? '#ef4444' : '#d1d5db'}`,
                fontSize: 13, marginBottom: 14, boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                style={btnGray}
                onClick={() => { setShowPurgeModal(false); setPurgeText('') }}
              >
                Cancel
              </button>
              <button
                style={{ ...btnRed, opacity: purgeText !== 'PURGE' || purging ? 0.5 : 1 }}
                disabled={purgeText !== 'PURGE' || purging}
                onClick={handlePurge}
              >
                {purging ? 'Purging...' : 'Purge All'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

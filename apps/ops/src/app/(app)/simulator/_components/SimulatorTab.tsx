'use client'
// src/app/ops/SimulatorTab.tsx
// Simulator tab: tournament management and referee scoring panel.

import { useState, useEffect, useCallback } from 'react'
import { PageHeader, Section, Button, Field } from '@/components/ui'
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
  scheduled_at: string | null
}


// ── Shared styles ─────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--r-lg)',
  padding: 12,
}

const btnBase: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: 'var(--r-sm)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  border: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
}

const btnGreen: React.CSSProperties = { ...btnBase, background: 'var(--lime)', color: 'var(--lime-ink)' }
const btnRed: React.CSSProperties = { ...btnBase, background: 'var(--live)', color: '#fff' }
const btnGray: React.CSSProperties = { ...btnBase, background: 'var(--bg-card-2)', color: 'var(--text-2)', border: '1px solid var(--border-card)' }

// Pair accent tokens — pair 1 = orange, pair 2 = blue (men) so the two
// sides stay distinguishable in both light + dark themes.
const PAIR1 = 'var(--orange-text)'
const PAIR2 = 'var(--men)'

// ── Sub-components ────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  const color = status === 'live' ? 'var(--lime)' : 'var(--text-3)'
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
  const [newDate, setNewDate] = useState(() => new Date().toISOString().split('T')[0])
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
      const res = await fetch('/api/internal/simulator/tournaments')
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
      const res = await fetch(`/api/internal/simulator/tournaments?id=${tournamentId}`)
      if (res.ok) {
        const json = await res.json()
        // Transform nested player objects into display names
        const transformed = (json.matches ?? []).map((m: any) => {
          const lastName = (p: any) => p?.name?.split(' ').pop() ?? '?'
          return {
            id: m.id,
            external_id: m.external_id,
            status: m.status,
            round: m.round,
            scheduled_at: m.scheduled_at,
            pair1: `${lastName(m.pair1_player1)} / ${lastName(m.pair1_player2)}`,
            pair2: `${lastName(m.pair2_player1)} / ${lastName(m.pair2_player2)}`,
            score: m.sets?.filter((s: any) => s.set_score).map((s: any) => s.set_score).join(' ') || null,
          }
        })
        setMatches(transformed)
      }
    } catch { /* silent */ }
    setLoadingMatches(false)
  }, [])

  useEffect(() => { fetchTournaments() }, [fetchTournaments])

  useEffect(() => {
    if (selectedTournamentId) fetchMatches(selectedTournamentId)
    else setMatches([])
  }, [selectedTournamentId, fetchMatches])

  // ── Actions ────────────────────────────────────────────────────

  async function handleCreateTournament() {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const res = await fetch('/api/internal/simulator/create-tournament', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          category: newCategory,
          matchCount: newMatchCount,
          round: newRound,
          date: newDate,
        }),
      })
      if (res.ok) {
        const json = await res.json()
        await fetchTournaments()
        setSelectedTournamentId(json.tournament?.id ?? '')
        setShowNewForm(false)
        setNewName('')
      } else {
        const json = await res.json()
        console.error('[Simulator] Create failed:', json.error)
      }
    } catch { /* silent */ }
    setCreating(false)
  }

  async function handlePurge() {
    if (purgeText !== 'PURGE') return
    setPurging(true)
    try {
      const res = await fetch('/api/internal/simulator/purge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: purgeText }),
      })
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
      await fetch('/api/internal/simulator/score', {
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
      await fetch('/api/internal/simulator/score', {
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
    <div className="ui-page">
      <PageHeader title="Simulator" subtitle="Tournament management and referee scoring panel." />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Section 1: Tournament Setup ── */}
      <Section label="Tournament Setup">
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {/* Dropdown */}
            <select
              value={selectedTournamentId}
              onChange={e => setSelectedTournamentId(e.target.value)}
              className="ui-select"
              style={{ flex: 1, minWidth: 200 }}
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
            <Button
              variant="primary"
              size="sm"
              onClick={() => { setShowNewForm(v => !v); setPurgeText('') }}
            >
              + New
            </Button>

            {/* Purge button */}
            <Button variant="danger" size="sm" onClick={() => setShowPurgeModal(true)}>
              Purge All
            </Button>
          </div>

          {/* New tournament inline form */}
          {showNewForm && (
            <div style={{
              marginTop: 14,
              padding: 14,
              background: 'var(--bg-card-2)',
              border: '1px solid var(--border-card)',
              borderRadius: 'var(--r-lg)',
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)', marginBottom: 10 }}>
                New Simulated Tournament
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 12 }}>
                Players are auto-picked from top-ranked players and randomly paired into matches.
              </div>

              {/* Row 1: name + date */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px', gap: 10, marginBottom: 10 }}>
                <Field label="Name">
                  <input
                    type="text"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder="Sim Tournament 1"
                    className="ui-input"
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                </Field>
                <Field label="Date">
                  <input
                    type="date"
                    value={newDate}
                    onChange={e => setNewDate(e.target.value)}
                    className="ui-input"
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                </Field>
              </div>

              {/* Row 2: category + round + match count */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 100px', gap: 10, marginBottom: 12 }}>
                <Field label="Category">
                  <select
                    value={newCategory}
                    onChange={e => setNewCategory(e.target.value as 'men' | 'women')}
                    className="ui-select"
                    style={{ width: '100%' }}
                  >
                    <option value="men">Men</option>
                    <option value="women">Women</option>
                  </select>
                </Field>
                <Field label="Round">
                  <select
                    value={newRound}
                    onChange={e => setNewRound(e.target.value)}
                    className="ui-select"
                    style={{ width: '100%' }}
                  >
                    {['R32', 'R16', 'QF', 'SF', 'F'].map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Matches">
                  <input
                    type="number"
                    min={1}
                    max={16}
                    value={newMatchCount}
                    onChange={e => setNewMatchCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="ui-input"
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                </Field>
              </div>

              {/* Form actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <Button size="sm" onClick={() => { setShowNewForm(false); setNewName('') }}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!newName.trim() || creating}
                  onClick={handleCreateTournament}
                >
                  {creating ? 'Creating...' : `Create (${newMatchCount * 4} players auto-picked)`}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* ── Section 2: Match List ── */}
      {selectedTournamentId && (
        <Section label="Matches">
          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            {loadingMatches ? (
              <div style={{ padding: 16, fontSize: 12, color: 'var(--text-3)', textAlign: 'center' }}>
                Loading matches...
              </div>
            ) : matches.length === 0 ? (
              <div style={{ padding: 16, fontSize: 12, color: 'var(--text-3)', textAlign: 'center' }}>
                No matches in this tournament
              </div>
            ) : (
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-card-2)', borderBottom: '1px solid var(--border-card)' }}>
                    <th style={{ padding: '7px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--text-3)', width: 20 }}></th>
                    <th style={{ padding: '7px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--text-3)' }}>Pair 1</th>
                    <th style={{ padding: '7px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--text-3)' }}>Pair 2</th>
                    <th style={{ padding: '7px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--text-3)' }}>Time</th>
                    <th style={{ padding: '7px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--text-3)' }}>Score</th>
                    <th style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--text-3)' }}>Action</th>
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
                          borderBottom: '1px solid var(--border-inner)',
                          background: isScoring ? 'var(--lime-bg)' : 'transparent',
                          outline: isScoring ? '1px solid var(--lime-border)' : 'none',
                          opacity: m.status === 'finished' && !isScoring ? 0.55 : 1,
                        }}
                      >
                        <td style={{ padding: '8px 12px' }}>
                          <StatusDot status={m.status} />
                        </td>
                        <td style={{ padding: '8px 12px', color: 'var(--text-1)', lineHeight: 1.4 }}>
                          <div>{p1a}</div>
                          {p1b && <div style={{ color: 'var(--text-3)' }}>{p1b}</div>}
                        </td>
                        <td style={{ padding: '8px 12px', color: 'var(--text-1)', lineHeight: 1.4 }}>
                          <div>{p2a}</div>
                          {p2b && <div style={{ color: 'var(--text-3)' }}>{p2b}</div>}
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <input
                            type="datetime-local"
                            value={m.scheduled_at ? m.scheduled_at.slice(0, 16) : ''}
                            onChange={async (e) => {
                              const val = e.target.value
                              if (!val) return
                              const iso = new Date(val).toISOString()
                              // Optimistic update
                              setMatches(prev => prev.map(x => x.id === m.id ? { ...x, scheduled_at: iso } : x))
                              await fetch('/api/internal/simulator/tournaments', {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ matchId: m.id, scheduled_at: iso }),
                              })
                            }}
                            className="ui-input"
                            style={{ fontSize: 11, width: 155, padding: '3px 5px' }}
                          />
                        </td>
                        <td style={{ padding: '8px 12px', color: 'var(--text-2)', fontFamily: 'monospace', fontSize: 11 }}>
                          {m.score ?? '—'}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                          {isScoring ? (
                            <span style={{
                              fontSize: 10, fontWeight: 700, color: 'var(--lime-text)',
                              background: 'var(--lime-bg)', padding: '2px 7px', borderRadius: 'var(--r-sm)',
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
                              fontSize: 10, color: 'var(--text-3)', background: 'var(--bg-card-2)',
                              padding: '2px 7px', borderRadius: 'var(--r-sm)', fontWeight: 500,
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
        </Section>
      )}

      {/* ── Section 3: Referee Panel ── */}
      {scoringMatchId && scoringMatch && (
        <Section
          label="Referee Panel"
          actions={sending ? (
            <span style={{ fontSize: 9, color: 'var(--orange-text)', fontWeight: 500 }}>
              Sending to relay...
            </span>
          ) : undefined}
        >
          <div style={{ ...card, background: 'var(--bg-card-2)' }}>

            {/* Match header */}
            <div style={{ textAlign: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>
                {scoringMatch.round && <span style={{ marginRight: 6 }}>{scoringMatch.round}</span>}
                {matchState.status === 'live'
                  ? <span style={{ color: 'var(--lime)', fontWeight: 600 }}>● LIVE</span>
                  : matchState.status === 'finished'
                    ? <span style={{ color: 'var(--text-3)' }}>Finished</span>
                    : <span style={{ color: 'var(--text-3)' }}>Scheduled</span>
                }
              </div>
            </div>

            {/* Pair labels row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'center', marginBottom: 10 }}>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: PAIR1 }}>Pair 1</div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>{scoringMatch.pair1}</div>
              </div>
              <div style={{ textAlign: 'center', fontSize: 14, color: 'var(--text-4)', fontWeight: 300 }}>vs</div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: PAIR2 }}>Pair 2</div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>{scoringMatch.pair2}</div>
              </div>
            </div>

            {/* Scoreboard */}
            <div style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-card)',
              borderRadius: 'var(--r-lg)',
              padding: '10px 14px',
              marginBottom: 14,
            }}>
              {/* Sets header */}
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${matchState.sets.length + 1}, 1fr)`, gap: 4, textAlign: 'center', marginBottom: 6 }}>
                <div style={{ fontSize: 10, color: 'var(--text-4)', fontWeight: 600 }}></div>
                {matchState.sets.map((s, i) => (
                  <div key={i} style={{ fontSize: 10, color: s.winner ? 'var(--text-3)' : 'var(--lime)', fontWeight: 600 }}>
                    Set {s.setNumber}{s.isTiebreak ? ' TB' : ''}
                  </div>
                ))}
              </div>

              {/* Pair 1 scores */}
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${matchState.sets.length + 1}, 1fr)`, gap: 4, textAlign: 'center', marginBottom: 4 }}>
                <div style={{ fontSize: 11, color: PAIR1, fontWeight: 700, textAlign: 'left' }}>{scoringMatch.pair1}</div>
                {matchState.sets.map((s, i) => (
                  <div key={i} style={{
                    fontSize: 20,
                    fontWeight: 700,
                    color: s.winner === 1 ? 'var(--lime)' : s.winner === 2 ? 'var(--text-3)' : 'var(--text-1)',
                  }}>
                    {s.winner !== null ? s.pair1Games : (
                      i === matchState.currentSet - 1
                        ? <span>{s.pair1Games}<span style={{ fontSize: 13, color: 'var(--text-3)' }}>{currentGameState ? ` (${currentGameState.pair1Points})` : ''}</span></span>
                        : s.pair1Games
                    )}
                  </div>
                ))}
              </div>

              {/* Pair 2 scores */}
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${matchState.sets.length + 1}, 1fr)`, gap: 4, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: PAIR2, fontWeight: 700, textAlign: 'left' }}>{scoringMatch.pair2}</div>
                {matchState.sets.map((s, i) => (
                  <div key={i} style={{
                    fontSize: 20,
                    fontWeight: 700,
                    color: s.winner === 2 ? 'var(--lime)' : s.winner === 1 ? 'var(--text-3)' : 'var(--text-1)',
                  }}>
                    {s.winner !== null ? s.pair2Games : (
                      i === matchState.currentSet - 1
                        ? <span>{s.pair2Games}<span style={{ fontSize: 13, color: 'var(--text-3)' }}>{currentGameState ? ` (${currentGameState.pair2Points})` : ''}</span></span>
                        : s.pair2Games
                    )}
                  </div>
                ))}
              </div>

              {/* Sets won indicator */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-inner)' }}>
                <span style={{ fontSize: 11, color: PAIR1, fontWeight: 600 }}>{setsWonP1} set{setsWonP1 !== 1 ? 's' : ''} won</span>
                <span style={{ fontSize: 11, color: PAIR2, fontWeight: 600 }}>{setsWonP2} set{setsWonP2 !== 1 ? 's' : ''} won</span>
              </div>
            </div>

            {/* Serving indicator */}
            <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-3)', marginBottom: 12 }}>
              Serving: <strong style={{ color: matchState.servingPair === 1 ? PAIR1 : PAIR2 }}>
                Pair {matchState.servingPair}
              </strong>
            </div>

            {/* Point buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 10 }}>
              <button
                style={{
                  padding: '20px 12px',
                  borderRadius: 'var(--r-md)',
                  border: `2px solid var(--orange-border)`,
                  background: `var(--orange-bg)`,
                  cursor: matchState.status === 'finished' ? 'not-allowed' : 'pointer',
                  opacity: matchState.status === 'finished' ? 0.4 : 1,
                  textAlign: 'center' as const,
                  transition: 'background 0.1s',
                }}
                disabled={matchState.status === 'finished' || sending}
                onClick={() => handlePoint(1)}
              >
                <div style={{ fontSize: 11, color: PAIR1, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                  POINT
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--orange)' }}>Pair 1</div>
              </button>

              <button
                style={{
                  padding: '20px 12px',
                  borderRadius: 'var(--r-md)',
                  border: `2px solid var(--men-border)`,
                  background: `var(--men-bg)`,
                  cursor: matchState.status === 'finished' ? 'not-allowed' : 'pointer',
                  opacity: matchState.status === 'finished' ? 0.4 : 1,
                  textAlign: 'center' as const,
                  transition: 'background 0.1s',
                }}
                disabled={matchState.status === 'finished' || sending}
                onClick={() => handlePoint(2)}
              >
                <div style={{ fontSize: 11, color: PAIR2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                  POINT
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--men)' }}>Pair 2</div>
              </button>
            </div>

            {/* Quick actions row */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
              <button
                style={{ ...btnBase, background: 'var(--orange-bg)', color: PAIR1, border: '1px solid var(--orange-border)', fontSize: 11 }}
                disabled={matchState.status === 'finished' || sending}
                onClick={() => handleQuickGame(1)}
              >
                Quick Game P1
              </button>
              <button
                style={{ ...btnBase, background: 'var(--men-bg)', color: PAIR2, border: '1px solid var(--men-border)', fontSize: 11 }}
                disabled={matchState.status === 'finished' || sending}
                onClick={() => handleQuickGame(2)}
              >
                Quick Game P2
              </button>
              <button
                style={{ ...btnBase, background: 'var(--live-bg)', color: 'var(--live-text)', border: '1px solid var(--live-border)', fontSize: 11 }}
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
                background: 'var(--bg-card-2)',
                border: '1px solid var(--border-card)',
                borderRadius: 'var(--r-sm)',
                marginBottom: 10,
              }}>
                <div style={{ fontSize: 9, color: 'var(--text-4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                  Point history (last {recentPoints.length})
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {recentPoints.map((pt, i) => (
                    <span key={i} style={{
                      fontFamily: 'monospace',
                      fontSize: 11,
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border-card)',
                      borderRadius: 'var(--r-sm)',
                      padding: '2px 6px',
                      color: 'var(--text-2)',
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
        </Section>
      )}

      {/* ── Purge modal ── */}
      {showPurgeModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-card)', borderRadius: 'var(--r-lg)', padding: 24, width: 340, boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', marginBottom: 8 }}>
              Purge All Simulated Data
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5, marginBottom: 16 }}>
              This will permanently delete all simulated tournaments, matches, sets, and game data.
              Type <strong>PURGE</strong> to confirm.
            </div>
            <input
              type="text"
              value={purgeText}
              onChange={e => setPurgeText(e.target.value)}
              placeholder="Type PURGE to confirm"
              className="ui-input"
              style={{
                width: '100%', marginBottom: 14, boxSizing: 'border-box',
                borderColor: purgeText === 'PURGE' ? 'var(--live)' : undefined,
              }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button size="sm" onClick={() => { setShowPurgeModal(false); setPurgeText('') }}>
                Cancel
              </Button>
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
    </div>
  )
}

'use client'
// src/app/ops/ScheduleTab.tsx
// Schedule Review UI — fetches OOP from MatchScorer, previews against DB matches,
// operator approves changes, then writes schedule times to DB.

import React, { useState, useCallback } from 'react'

interface ScheduleMatch {
  oopIndex: number
  court: string
  scheduleLabel: string
  category: 'men' | 'women' | null
  matchCode: string | null
  team1Display: string
  team2Display: string
  dbMatchId: string | null
  dbMatchRound: string | null
  dbScheduledAt: string | null
  dbHasTime: boolean
  confidence: 'high' | 'medium' | 'low' | 'none'
  proposedScheduledAt: string | null
  proposedCourt: string | null
  proposedScheduleLabel: string | null
}

interface FetchResult {
  day: number
  dayDate: string | null
  timezone: string
  totalOopMatches: number
  matched: number
  unmatched: number
  matches: ScheduleMatch[]
}

const card: React.CSSProperties = {
  background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12,
}

const confidenceColor: Record<string, { bg: string; text: string; label: string }> = {
  high: { bg: '#dcfce7', text: '#166534', label: 'HIGH' },
  medium: { bg: '#fef3c7', text: '#92400e', label: 'MEDIUM' },
  low: { bg: '#fee2e2', text: '#991b1b', label: 'LOW' },
  none: { bg: '#f3f4f6', text: '#666', label: 'NO MATCH' },
}

export default function ScheduleTab() {
  // Input state
  const [tournamentId, setTournamentId] = useState('')
  const [matchscorerCode, setMatchscorerCode] = useState('')
  const [day, setDay] = useState('3')
  const [dateOverride, setDateOverride] = useState('')

  // Result state
  const [result, setResult] = useState<FetchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Selection state — which matches to approve
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState<{ updated: number; skipped: number; errors: string[] } | null>(null)

  // Manual overrides — operator can link NO MATCH entries to a DB match ID
  const [manualLinks, setManualLinks] = useState<Record<number, string>>({})

  // Fetch OOP and match against DB
  const handleFetch = useCallback(async () => {
    if (!tournamentId || !matchscorerCode || !day) return
    setLoading(true)
    setError(null)
    setResult(null)
    setSelected(new Set())
    setApplyResult(null)
    try {
      const dateParam = dateOverride ? `&date=${dateOverride}` : ''
      const res = await fetch(`/api/ops/schedule-review?tournament_id=${tournamentId}&code=${encodeURIComponent(matchscorerCode)}&day=${day}${dateParam}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const data: FetchResult = await res.json()
      setResult(data)
      // Auto-select all high-confidence matches that don't already have a time
      const autoSelect = new Set<number>()
      data.matches.forEach((m, i) => {
        if (m.dbMatchId && m.confidence === 'high' && !m.dbHasTime && m.proposedScheduledAt) {
          autoSelect.add(i)
        }
      })
      setSelected(autoSelect)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch')
    }
    setLoading(false)
  }, [tournamentId, matchscorerCode, day])

  // Apply selected schedule changes
  const handleApply = useCallback(async () => {
    if (!result) return
    setApplying(true)
    setApplyResult(null)
    const updates = result.matches
      .filter((_, i) => selected.has(i))
      .map((m, i) => {
        const matchId = manualLinks[i] || m.dbMatchId
        if (!matchId || !m.proposedScheduledAt) return null
        return {
          matchId,
          scheduledAt: m.proposedScheduledAt,
          court: m.proposedCourt,
          scheduleLabel: m.proposedScheduleLabel,
        }
      })
      .filter(Boolean) as { matchId: string; scheduledAt: string; court: string | null; scheduleLabel: string | null }[]

    try {
      const res = await fetch('/api/ops/schedule-review', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      })
      const data = await res.json()
      setApplyResult(data)
    } catch (e) {
      setApplyResult({ updated: 0, skipped: 0, errors: [e instanceof Error ? e.message : 'Failed'] })
    }
    setApplying(false)
  }, [result, selected])

  const toggleAll = useCallback(() => {
    if (!result) return
    const eligible = result.matches
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => m.dbMatchId && !m.dbHasTime && m.proposedScheduledAt)

    if (selected.size >= eligible.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(eligible.map(({ i }) => i)))
    }
  }, [result, selected])

  return (
    <div>
      {/* Input form */}
      <div style={{ ...card, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 10, color: '#999', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Tournament ID</div>
          <input
            type="text"
            value={tournamentId}
            onChange={e => setTournamentId(e.target.value)}
            placeholder="UUID from Supabase"
            style={{ width: 280, padding: '6px 8px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4, color: '#111', fontFamily: 'monospace' }}
          />
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#999', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>MatchScorer Code</div>
          <input
            type="text"
            value={matchscorerCode}
            onChange={e => setMatchscorerCode(e.target.value)}
            placeholder="e.g. FIP-2026-4401"
            style={{ width: 180, padding: '6px 8px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4, color: '#111' }}
          />
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#999', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Day #</div>
          <input
            type="number"
            value={day}
            onChange={e => setDay(e.target.value)}
            min={1} max={10}
            style={{ width: 60, padding: '6px 8px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4, color: '#111' }}
          />
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#999', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Actual Date</div>
          <input
            type="date"
            value={dateOverride}
            onChange={e => setDateOverride(e.target.value)}
            style={{ width: 150, padding: '6px 8px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4, color: '#111' }}
          />
        </div>
        <button
          onClick={handleFetch}
          disabled={loading || !tournamentId || !matchscorerCode}
          style={{
            padding: '6px 16px', fontSize: 12, fontWeight: 600, borderRadius: 4,
            border: 'none', cursor: loading ? 'default' : 'pointer',
            background: '#3b82f6', color: '#fff', opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? 'Fetching...' : 'Fetch Schedule'}
        </button>
      </div>

      {/* Quick fill for NewGiza */}
      <div style={{ marginBottom: 12, fontSize: 11, color: '#888' }}>
        Quick fill:{' '}
        <button
          onClick={() => {
            setTournamentId('7204f4ac-5ced-4b2f-b9c0-5fb81a497a90')
            setMatchscorerCode('FIP-2026-4401')
            setDay('3')
            setDateOverride('2026-04-13')
          }}
          style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: 3, padding: '2px 8px', fontSize: 10, cursor: 'pointer', color: '#3b82f6', fontWeight: 600 }}
        >
          NewGiza Day 3 = Apr 13 (R32)
        </button>
        {' '}
        <button
          onClick={() => {
            setTournamentId('7204f4ac-5ced-4b2f-b9c0-5fb81a497a90')
            setMatchscorerCode('FIP-2026-4401')
            setDay('4')
            setDateOverride('2026-04-14')
          }}
          style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: 3, padding: '2px 8px', fontSize: 10, cursor: 'pointer', color: '#3b82f6', fontWeight: 600 }}
        >
          NewGiza Day 4 = Apr 14 (R16)
        </button>
        {' '}
        <button
          onClick={() => {
            setTournamentId('7204f4ac-5ced-4b2f-b9c0-5fb81a497a90')
            setMatchscorerCode('FIP-2026-4401')
            setDay('5')
            setDateOverride('2026-04-15')
          }}
          style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: 3, padding: '2px 8px', fontSize: 10, cursor: 'pointer', color: '#3b82f6', fontWeight: 600 }}
        >
          NewGiza Day 5 = Apr 15 (QF)
        </button>
      </div>

      {error && (
        <div style={{ ...card, background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', fontSize: 12, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div>
          {/* Summary bar */}
          <div style={{ ...card, marginBottom: 12, display: 'flex', gap: 16, alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 10, color: '#999', fontWeight: 600, textTransform: 'uppercase' }}>Day</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>{result.dayDate || `Day ${result.day}`}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#999', fontWeight: 600, textTransform: 'uppercase' }}>Timezone</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#333' }}>{result.timezone}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#999', fontWeight: 600, textTransform: 'uppercase' }}>OOP Matches</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>{result.totalOopMatches}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#999', fontWeight: 600, textTransform: 'uppercase' }}>Matched</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#22c55e' }}>{result.matched}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#999', fontWeight: 600, textTransform: 'uppercase' }}>Unmatched</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: result.unmatched > 0 ? '#f59e0b' : '#999' }}>{result.unmatched}</div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button onClick={toggleAll} style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 4, border: '1px solid #d1d5db', cursor: 'pointer', background: '#fff', color: '#333' }}>
                {selected.size > 0 ? 'Deselect All' : 'Select All Matched'}
              </button>
              <button
                onClick={handleApply}
                disabled={selected.size === 0 || applying}
                style={{
                  padding: '4px 16px', fontSize: 11, fontWeight: 600, borderRadius: 4,
                  border: 'none', cursor: selected.size === 0 || applying ? 'default' : 'pointer',
                  background: '#22c55e', color: '#fff', opacity: selected.size === 0 || applying ? 0.5 : 1,
                }}
              >
                {applying ? 'Applying...' : `Apply ${selected.size} Changes`}
              </button>
            </div>
          </div>

          {/* Apply result */}
          {applyResult && (
            <div style={{
              ...card, marginBottom: 12,
              background: applyResult.errors.length > 0 ? '#fef2f2' : '#f0fdf4',
              border: `1px solid ${applyResult.errors.length > 0 ? '#fecaca' : '#86efac'}`,
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: applyResult.errors.length > 0 ? '#dc2626' : '#166534' }}>
                ✓ Updated: {applyResult.updated} | Skipped: {applyResult.skipped} | Errors: {applyResult.errors.length}
              </div>
              {applyResult.errors.map((e, i) => (
                <div key={i} style={{ fontSize: 11, color: '#dc2626' }}>• {e}</div>
              ))}
            </div>
          )}

          {/* Match table */}
          <div style={{ ...card, padding: 0, overflow: 'auto' }}>
            <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb', background: '#f9fafb' }}>
                  <th style={{ padding: '6px 8px', width: 30 }}>✓</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Court</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Time</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Cat</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Team 1</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Team 2</th>
                  <th style={{ padding: '6px 8px', textAlign: 'center', color: '#666', fontWeight: 600 }}>Match</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', color: '#666', fontWeight: 600 }}>DB Round</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Proposed UTC</th>
                </tr>
              </thead>
              <tbody>
                {result.matches.map((m, i) => {
                  const hasManualLink = !!manualLinks[i]
                  const effectiveConf = hasManualLink ? 'high' : m.confidence
                  const conf = confidenceColor[effectiveConf]
                  const isSelected = selected.has(i)
                  const effectiveMatchId = manualLinks[i] || m.dbMatchId
                  const canSelect = effectiveMatchId && !m.dbHasTime && m.proposedScheduledAt

                  return (
                    <tr key={i} style={{
                      borderBottom: '1px solid #f3f4f6',
                      background: isSelected ? '#f0fdf4' : i % 2 === 0 ? '#fff' : '#f9fafb',
                    }}>
                      <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                        {canSelect ? (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {
                              const next = new Set(selected)
                              if (isSelected) next.delete(i)
                              else next.add(i)
                              setSelected(next)
                            }}
                          />
                        ) : (
                          m.dbHasTime ? <span title="Already has time" style={{ color: '#999' }}>—</span> : null
                        )}
                      </td>
                      <td style={{ padding: '5px 8px', fontWeight: 500, color: '#333', whiteSpace: 'nowrap' }}>{m.court}</td>
                      <td style={{ padding: '5px 8px', color: '#3b82f6', fontWeight: 600, whiteSpace: 'nowrap' }}>{m.scheduleLabel}</td>
                      <td style={{ padding: '5px 8px' }}>
                        <span style={{
                          fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 3,
                          background: m.category === 'men' ? '#dbeafe' : m.category === 'women' ? '#fce7f3' : '#f3f4f6',
                          color: m.category === 'men' ? '#1e40af' : m.category === 'women' ? '#9d174d' : '#666',
                        }}>
                          {m.matchCode || (m.category === 'men' ? 'M' : m.category === 'women' ? 'W' : '?')}
                        </span>
                      </td>
                      <td style={{ padding: '5px 8px', color: '#111', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.team1Display}
                      </td>
                      <td style={{ padding: '5px 8px', color: '#111', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.team2Display}
                      </td>
                      <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                        {m.confidence === 'none' && !hasManualLink ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            <input
                              type="text"
                              placeholder="paste match UUID"
                              value={manualLinks[i] || ''}
                              onChange={e => {
                                const val = e.target.value.trim()
                                setManualLinks(prev => val ? { ...prev, [i]: val } : (() => { const n = { ...prev }; delete n[i]; return n })())
                              }}
                              style={{ width: 90, padding: '2px 4px', fontSize: 9, fontFamily: 'monospace', border: '1px solid #d1d5db', borderRadius: 3, color: '#333' }}
                            />
                          </div>
                        ) : (
                          <span style={{
                            fontSize: 8, fontWeight: 700, padding: '2px 5px', borderRadius: 3,
                            background: conf.bg, color: conf.text,
                          }}>
                            {hasManualLink ? 'MANUAL' : conf.label}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '5px 8px', color: '#666', fontSize: 10 }}>{m.dbMatchRound || '—'}</td>
                      <td style={{ padding: '5px 8px', fontFamily: 'monospace', fontSize: 10, color: '#555' }}>
                        {m.proposedScheduledAt ? new Date(m.proposedScheduledAt).toISOString().replace('T', ' ').slice(0, 16) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'
// src/app/ops/ScheduleTab.tsx
// Schedule Review UI — fetches OOP from MatchScorer, previews against DB matches,
// operator approves changes, then writes schedule times to DB.

import React, { useState, useCallback, useEffect } from 'react'

type PlayerSlotKey =
  | 'pair1_player1_id'
  | 'pair1_player2_id'
  | 'pair2_player1_id'
  | 'pair2_player2_id'

interface PlayerSlotDiff {
  slot: PlayerSlotKey
  currentId: string | null
  oopName: string | null
  resolvedNewId: string | null
}

interface ScheduleMatch {
  oopIndex: number
  court: string
  scheduleLabel: string
  category: 'men' | 'women' | null
  matchCode: string | null
  team1Display: string
  team2Display: string
  dbMatchId: string | null
  oopRound: string | null
  dbMatchRound: string | null
  dbScheduledAt: string | null
  dbHasTime: boolean
  dbCourt: string | null
  confidence: 'high' | 'medium' | 'low' | 'none'
  // Per-field diff flags (PR #14) — at least one must be true for the row
  // to be selectable. Replaces the old "dbHasTime blocks everything" rule.
  needsTimeChange: boolean
  needsCourtChange: boolean
  needsPlayersChange: boolean
  playerSlots: PlayerSlotDiff[]
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
  // Provenance (added when reading from padelgod.oop_snapshots)
  source?: string
  capturedAt?: string | null
  exactMatchCount?: number
  /** Rows where at least one field will actually change on apply. PR #14. */
  needsUpdateCount?: number
}

/**
 * Format a human-readable "X ago" for a past ISO timestamp. Used to surface
 * how stale the padelgod OOP snapshot is (hourly scrape cadence). Returns
 * "—" for null inputs or ">24h" for anything older than a day.
 */
function formatAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (!isFinite(ms) || ms < 0) return '—'
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return '>24h ago'
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

interface OopChange {
  tournament_name: string
  day: number
  date: string
  match_count: number
  change_type: string
  created_at: string
  tournament_id: string
  matchscorer_code?: string
}

export default function ScheduleTab() {
  // OOP change alerts
  const [oopChanges, setOopChanges] = useState<OopChange[]>([])

  useEffect(() => {
    // Fetch recent OOP changes from ops_events (last 24h)
    fetch('/api/ops/schedule-review/changes')
      .then(r => r.ok ? r.json() : { changes: [] })
      .then(d => setOopChanges(d.changes || []))
      .catch(() => {})
  }, [])

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
      // Auto-select all high-confidence matches with at least one resolvable
      // diff. Replaces the old "dbHasTime blocks everything" rule — now we
      // include rows where time is already set but court is wrong, or where
      // players are TBD and the OOP resolved them.
      const autoSelect = new Set<number>()
      data.matches.forEach((m, i) => {
        if (
          m.dbMatchId &&
          m.confidence === 'high' &&
          (m.needsTimeChange || m.needsCourtChange || m.needsPlayersChange)
        ) {
          autoSelect.add(i)
        }
      })
      setSelected(autoSelect)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch')
    }
    setLoading(false)
  }, [tournamentId, matchscorerCode, day])

  // Apply selected schedule changes — builds a per-field PATCH payload so
  // the server only touches the fields that actually differ. Covers three
  // independent changes per row (time / court / players), mixed freely
  // across selected rows.
  const handleApply = useCallback(async () => {
    if (!result) return
    setApplying(true)
    setApplyResult(null)
    const updates = result.matches
      .filter((_, i) => selected.has(i))
      .map((m) => {
        const matchId = manualLinks[m.oopIndex] || m.dbMatchId
        if (!matchId) return null

        // Only include fields in the payload when the diff flag says they
        // should change. Omitted fields are left untouched by the server.
        const update: {
          matchId: string
          scheduledAt?: string
          court?: string
          scheduleLabel?: string
          playerUpdates?: Partial<Record<PlayerSlotKey, string>>
        } = { matchId }

        if (m.needsTimeChange && m.proposedScheduledAt) {
          update.scheduledAt = m.proposedScheduledAt
          // scheduleLabel follows time — always overwrite together.
          if (m.proposedScheduleLabel) update.scheduleLabel = m.proposedScheduleLabel
        }
        if (m.needsCourtChange && m.proposedCourt) {
          update.court = m.proposedCourt
        }
        if (m.needsPlayersChange) {
          const pu: Partial<Record<PlayerSlotKey, string>> = {}
          for (const slot of m.playerSlots) {
            if (slot.currentId === null && slot.resolvedNewId) {
              pu[slot.slot] = slot.resolvedNewId
            }
          }
          if (Object.keys(pu).length > 0) update.playerUpdates = pu
        }

        // Empty update (nothing to change) — skip.
        const hasWork =
          update.scheduledAt !== undefined ||
          update.court !== undefined ||
          update.scheduleLabel !== undefined ||
          update.playerUpdates !== undefined
        return hasWork ? update : null
      })
      .filter(Boolean) as Array<{
        matchId: string
        scheduledAt?: string
        court?: string
        scheduleLabel?: string
        playerUpdates?: Partial<Record<PlayerSlotKey, string>>
      }>

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
  }, [result, selected, manualLinks])

  const toggleAll = useCallback(() => {
    if (!result) return
    const eligible = result.matches
      .map((m, i) => ({ m, i }))
      .filter(({ m }) =>
        m.dbMatchId &&
        (m.needsTimeChange || m.needsCourtChange || m.needsPlayersChange),
      )

    if (selected.size >= eligible.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(eligible.map(({ i }) => i)))
    }
  }, [result, selected])

  return (
    <div>
      {/* OOP Change Alerts */}
      {oopChanges.length > 0 && (
        <div style={{ ...card, marginBottom: 12, background: '#fffbeb', border: '1px solid #fbbf24' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#92400e', marginBottom: 6 }}>
            ⚠️ {oopChanges.length} OOP change{oopChanges.length !== 1 ? 's' : ''} detected — review needed
          </div>
          {oopChanges.map((c, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#666', marginBottom: 4 }}>
              <span style={{
                fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 3,
                background: c.change_type === 'NEW' ? '#dbeafe' : '#fef3c7',
                color: c.change_type === 'NEW' ? '#1e40af' : '#92400e',
              }}>
                {c.change_type}
              </span>
              <span><strong>{c.tournament_name}</strong> Day {c.day} ({c.date}) — {c.match_count} matches</span>
              <span style={{ color: '#999', fontSize: 10 }}>{new Date(c.created_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}

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
        {[
          { day: '3', date: '2026-04-13', label: 'Day 3 → Apr 13 (Q3/R32)' },
          { day: '4', date: '2026-04-14', label: 'Day 4 → Apr 14 (R32)' },
          { day: '5', date: '2026-04-15', label: 'Day 5 → Apr 15 (R16)' },
          { day: '6', date: '2026-04-16', label: 'Day 6 → Apr 16 (QF)' },
          { day: '7', date: '2026-04-17', label: 'Day 7 → Apr 17 (SF)' },
          { day: '8', date: '2026-04-18', label: 'Day 8 → Apr 18 (F)' },
        ].map(qf => (
          <button
            key={qf.day}
            onClick={() => {
              setTournamentId('7204f4ac-5ced-4b2f-b9c0-5fb81a497a90')
              setMatchscorerCode('FIP-2026-4401')
              setDay(qf.day)
              setDateOverride(qf.date)
            }}
            style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: 3, padding: '2px 8px', fontSize: 10, cursor: 'pointer', color: '#3b82f6', fontWeight: 600, marginRight: 4 }}
          >
            NewGiza {qf.label}
          </button>
        ))}
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
            {/* Needs-update counter (PR #14) — rows where at least one field
                differs vs DB. Replaces the "must have dbHasTime=false" filter
                that wrongly hid rows with good time but wrong court. */}
            {typeof result.needsUpdateCount === 'number' && (
              <div>
                <div style={{ fontSize: 10, color: '#999', fontWeight: 600, textTransform: 'uppercase' }}>Needs Update</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: result.needsUpdateCount > 0 ? '#1e40af' : '#999' }}>
                  {result.needsUpdateCount}
                </div>
              </div>
            )}
            {/* Provenance indicator — shows how stale the snapshot is. Data
                comes from padelgod's hourly oop-fetcher; up to ~1h old is
                expected. Exact count shows how many rows linked via widget
                id (skipping fuzzy matching entirely). */}
            {result.source === 'padelgod.oop_snapshots' && (
              <div>
                <div style={{ fontSize: 10, color: '#999', fontWeight: 600, textTransform: 'uppercase' }}>Snapshot</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#333' }}>
                  {formatAgo(result.capturedAt)}
                  {typeof result.exactMatchCount === 'number' && result.exactMatchCount > 0 && (
                    <span style={{ marginLeft: 6, fontSize: 10, color: '#166534', fontWeight: 500 }}>
                      · {result.exactMatchCount} exact
                    </span>
                  )}
                </div>
              </div>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button onClick={toggleAll} style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 4, border: '1px solid #d1d5db', cursor: 'pointer', background: '#fff', color: '#333' }}>
                {selected.size > 0 ? 'Deselect All' : 'Select All With Changes'}
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
                  <th style={{ padding: '6px 8px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Changes</th>
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
                  // PR #14: selectable if ANY field would change. Replaces the
                  // old !dbHasTime blanket block that was over-restrictive.
                  const anyDiff =
                    m.needsTimeChange || m.needsCourtChange || m.needsPlayersChange
                  const canSelect = effectiveMatchId && anyDiff
                  // Count fillable TBD slots so the chip says "2/4 missing".
                  const fillableSlotCount = m.playerSlots.filter(
                    (s) => s.currentId === null && s.resolvedNewId !== null,
                  ).length
                  const nullSlotCount = m.playerSlots.filter((s) => s.currentId === null).length

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
                          {m.category === 'men' ? 'M' : m.category === 'women' ? 'W' : '?'}{m.oopRound ? ` ${m.oopRound}` : ''}
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
                      {/* Changes column — per-field diff chips so operators
                          can see WHAT will change on apply. Empty cell when
                          row is in sync. Chip colors: blue = time, amber =
                          court, green = players. */}
                      <td style={{ padding: '5px 8px' }}>
                        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                          {m.needsTimeChange && (
                            <span
                              title={
                                m.dbScheduledAt
                                  ? `Time: ${new Date(m.dbScheduledAt).toISOString().slice(11, 16)} → ${m.proposedScheduledAt ? new Date(m.proposedScheduledAt).toISOString().slice(11, 16) : '?'}`
                                  : 'Will set time'
                              }
                              style={{
                                fontSize: 9, fontWeight: 700, padding: '1px 5px',
                                borderRadius: 3, background: '#dbeafe', color: '#1e40af',
                                letterSpacing: '0.03em',
                              }}
                            >
                              ↻ TIME
                            </span>
                          )}
                          {m.needsCourtChange && (
                            <span
                              title={`Court: ${m.dbCourt ?? '(none)'} → ${m.proposedCourt ?? '?'}`}
                              style={{
                                fontSize: 9, fontWeight: 700, padding: '1px 5px',
                                borderRadius: 3, background: '#fef3c7', color: '#92400e',
                                letterSpacing: '0.03em',
                              }}
                            >
                              ↻ COURT
                            </span>
                          )}
                          {m.needsPlayersChange && (
                            <span
                              title={`Players: will fill ${fillableSlotCount} of ${nullSlotCount} TBD slot${nullSlotCount === 1 ? '' : 's'} (Option A — null-only writes)`}
                              style={{
                                fontSize: 9, fontWeight: 700, padding: '1px 5px',
                                borderRadius: 3, background: '#dcfce7', color: '#166534',
                                letterSpacing: '0.03em',
                              }}
                            >
                              ↻ {fillableSlotCount}/{nullSlotCount} TBD
                            </span>
                          )}
                          {!anyDiff && m.dbMatchId && (
                            <span
                              title="All fields match DB — nothing to apply"
                              style={{
                                fontSize: 9, fontWeight: 500, padding: '1px 5px',
                                color: '#9ca3af', letterSpacing: '0.03em',
                              }}
                            >
                              ✓ in sync
                            </span>
                          )}
                        </div>
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

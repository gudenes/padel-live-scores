'use client'
// src/app/ops/tournament/ScheduleReviewPanel.tsx
//
// Extracted from the former standalone src/app/ops/ScheduleTab.tsx so the
// Tournament Explorer's Matches subtab (OOP tab) can embed the
// Schedule Review Apply UX alongside the read-only OOP snapshot list.
//
// The operator never needs to look up a tournament UUID or MatchScorer
// code manually anymore — both are threaded in as props from the parent
// (which already has them in scope). Day selection is also driven by
// the parent's day picker, so the panel only owns:
//
//   1. Fetching /api/ops/schedule-review for the selected (tournament, day)
//   2. Rendering per-field diff chips (↻ TIME / ↻ COURT / ↻ N/M TBD)
//   3. Auto-selecting high-confidence rows with diffs
//   4. Committing selected diffs via PATCH /api/ops/schedule-review
//
// Behaviour parity with the old ScheduleTab is the goal — the extracted
// table + apply flow is byte-for-byte identical. If this page diverges
// from the old one in the future, prefer keeping BOTH branches behind a
// prop rather than forking — the embedded + standalone surfaces should
// stay visually aligned.

import React, { useCallback, useEffect, useState } from 'react'

// ── Types (shared with the API — keep in sync with schedule-review/route.ts) ─

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
  source?: string
  capturedAt?: string | null
  exactMatchCount?: number
  needsUpdateCount?: number
}

// ── Styles (match the rest of the ops dashboard) ────────────────────────

const card: React.CSSProperties = {
  background: 'white',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 12,
}

const confidenceColor: Record<string, { bg: string; text: string; label: string }> = {
  high: { bg: '#dcfce7', text: '#166534', label: 'HIGH' },
  medium: { bg: '#fef3c7', text: '#92400e', label: 'MEDIUM' },
  low: { bg: '#fee2e2', text: '#991b1b', label: 'LOW' },
  none: { bg: '#f3f4f6', text: '#666', label: 'NO MATCH' },
}

// ── Props ────────────────────────────────────────────────────────────────

export interface ScheduleReviewPanelProps {
  /** Public.tournaments.id — UUID. Required. */
  tournamentId: string
  /** Crionet tournament widget code (e.g. "FIP-2026-1701"). Required —
   *  parent should hide this panel when null. */
  matchscorerCode: string
  /** OOP day_number (1-indexed). Required. */
  day: number
  /** YYYY-MM-DD calendar date override for the day. Optional — without it
   *  the server falls back to `starts_at + (day - 1)` which can be wrong
   *  when qualifier days precede the stored starts_at. The Matches subtab
   *  already computes dayDates, so it should pass the real date in. */
  dayDate?: string | null
}

// ── Component ────────────────────────────────────────────────────────────

export default function ScheduleReviewPanel({
  tournamentId,
  matchscorerCode,
  day,
  dayDate,
}: ScheduleReviewPanelProps) {
  const [result, setResult] = useState<FetchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState<{
    updated: number
    skipped: number
    errors: string[]
  } | null>(null)
  const [manualLinks, setManualLinks] = useState<Record<number, string>>({})

  // Fetch whenever the panel's inputs change. Wiping selected + applyResult
  // on every load so a stale selection from a previous day/tournament
  // doesn't silently get Applied.
  useEffect(() => {
    if (!tournamentId || !matchscorerCode || !day) {
      setResult(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setSelected(new Set())
    setApplyResult(null)
    const dateParam = dayDate ? `&date=${dayDate}` : ''
    fetch(
      `/api/ops/schedule-review?tournament_id=${tournamentId}&code=${encodeURIComponent(
        matchscorerCode,
      )}&day=${day}${dateParam}`,
    )
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body.error || `HTTP ${r.status}`)
        }
        return r.json() as Promise<FetchResult>
      })
      .then((data) => {
        if (cancelled) return
        setResult(data)
        // Auto-select all high-confidence matches with at least one resolvable
        // diff — same rule as the old standalone tab.
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
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Failed to fetch schedule review')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tournamentId, matchscorerCode, day, dayDate])

  const handleApply = useCallback(async () => {
    if (!result) return
    setApplying(true)
    setApplyResult(null)
    const updates = result.matches
      .filter((_, i) => selected.has(i))
      .map((m) => {
        const matchId = manualLinks[m.oopIndex] || m.dbMatchId
        if (!matchId) return null

        const update: {
          matchId: string
          scheduledAt?: string
          court?: string
          scheduleLabel?: string
          playerUpdates?: Partial<Record<PlayerSlotKey, string>>
        } = { matchId }

        if (m.needsTimeChange && m.proposedScheduledAt) {
          update.scheduledAt = m.proposedScheduledAt
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
      // Refresh after a successful apply so the panel shows the new DB state.
      // We just trigger a refetch via state bump; cheapest reliable signal.
      if (data && data.errors?.length === 0 && data.updated > 0) {
        // Re-fetch with the same inputs to show updated dbAt / "in sync" state.
        setTimeout(() => {
          const dateParam = dayDate ? `&date=${dayDate}` : ''
          fetch(
            `/api/ops/schedule-review?tournament_id=${tournamentId}&code=${encodeURIComponent(
              matchscorerCode,
            )}&day=${day}${dateParam}`,
          )
            .then((r) => r.json())
            .then((d) => {
              setResult(d)
              setSelected(new Set())
            })
            .catch(() => {})
        }, 400)
      }
    } catch (e) {
      setApplyResult({
        updated: 0,
        skipped: 0,
        errors: [e instanceof Error ? e.message : 'Failed'],
      })
    }
    setApplying(false)
  }, [result, selected, manualLinks, tournamentId, matchscorerCode, day, dayDate])

  const toggleAll = useCallback(() => {
    if (!result) return
    const eligible = result.matches
      .map((m, i) => ({ m, i }))
      .filter(
        ({ m }) =>
          m.dbMatchId &&
          (m.needsTimeChange || m.needsCourtChange || m.needsPlayersChange),
      )
    if (selected.size >= eligible.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(eligible.map(({ i }) => i)))
    }
  }, [result, selected])

  if (!tournamentId || !matchscorerCode) return null

  return (
    <div style={{ marginTop: 16 }}>
      <div
        style={{
          marginBottom: 8,
          fontSize: 11,
          fontWeight: 600,
          color: '#666',
          textTransform: 'uppercase',
          letterSpacing: 0.4,
        }}
      >
        Apply OOP → public.matches (day {day}
        {dayDate ? ` · ${dayDate}` : ''})
      </div>

      {loading && (
        <div style={{ ...card, color: '#666', fontSize: 12 }}>
          Loading schedule review…
        </div>
      )}

      {error && (
        <div
          style={{
            ...card,
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#dc2626',
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      {result && !loading && (
        <div>
          {/* Summary / actions bar */}
          <div
            style={{
              ...card,
              marginBottom: 8,
              display: 'flex',
              gap: 16,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <SummaryTile
              label="OOP"
              value={result.totalOopMatches}
              color="#111"
            />
            <SummaryTile label="Matched" value={result.matched} color="#22c55e" />
            <SummaryTile
              label="Unmatched"
              value={result.unmatched}
              color={result.unmatched > 0 ? '#f59e0b' : '#999'}
            />
            {typeof result.needsUpdateCount === 'number' && (
              <SummaryTile
                label="Needs Update"
                value={result.needsUpdateCount}
                color={result.needsUpdateCount > 0 ? '#1e40af' : '#999'}
              />
            )}
            <SummaryTile label="TZ" value={result.timezone} color="#333" monospace />

            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button
                onClick={toggleAll}
                style={{
                  padding: '4px 12px',
                  fontSize: 11,
                  fontWeight: 600,
                  borderRadius: 4,
                  border: '1px solid #d1d5db',
                  cursor: 'pointer',
                  background: '#fff',
                  color: '#333',
                }}
              >
                {selected.size > 0 ? 'Deselect All' : 'Select All With Changes'}
              </button>
              <button
                onClick={handleApply}
                disabled={selected.size === 0 || applying}
                style={{
                  padding: '4px 16px',
                  fontSize: 11,
                  fontWeight: 600,
                  borderRadius: 4,
                  border: 'none',
                  cursor: selected.size === 0 || applying ? 'default' : 'pointer',
                  background: '#22c55e',
                  color: '#fff',
                  opacity: selected.size === 0 || applying ? 0.5 : 1,
                }}
              >
                {applying ? 'Applying…' : `Apply ${selected.size} Changes`}
              </button>
            </div>
          </div>

          {/* Apply result */}
          {applyResult && (
            <div
              style={{
                ...card,
                marginBottom: 8,
                background: applyResult.errors.length > 0 ? '#fef2f2' : '#f0fdf4',
                border: `1px solid ${
                  applyResult.errors.length > 0 ? '#fecaca' : '#86efac'
                }`,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: applyResult.errors.length > 0 ? '#dc2626' : '#166534',
                }}
              >
                ✓ Updated: {applyResult.updated} | Skipped: {applyResult.skipped} |
                Errors: {applyResult.errors.length}
              </div>
              {applyResult.errors.map((e, i) => (
                <div key={i} style={{ fontSize: 11, color: '#dc2626' }}>
                  • {e}
                </div>
              ))}
            </div>
          )}

          {/* Review table */}
          <div style={{ ...card, padding: 0, overflow: 'auto' }}>
            <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb', background: '#f9fafb' }}>
                  <th style={{ padding: '6px 8px', width: 30 }}>✓</th>
                  <th style={{ ...th }}>Court</th>
                  <th style={{ ...th }}>Time</th>
                  <th style={{ ...th }}>Cat</th>
                  <th style={{ ...th }}>Team 1</th>
                  <th style={{ ...th }}>Team 2</th>
                  <th style={{ ...th, textAlign: 'center' }}>Match</th>
                  <th style={{ ...th }}>Changes</th>
                  <th style={{ ...th }}>DB Round</th>
                  <th style={{ ...th }}>Proposed UTC</th>
                </tr>
              </thead>
              <tbody>
                {result.matches.map((m, i) => {
                  const hasManualLink = !!manualLinks[i]
                  const effectiveConf = hasManualLink ? 'high' : m.confidence
                  const conf = confidenceColor[effectiveConf]
                  const isSelected = selected.has(i)
                  const effectiveMatchId = manualLinks[i] || m.dbMatchId
                  const anyDiff =
                    m.needsTimeChange || m.needsCourtChange || m.needsPlayersChange
                  const canSelect = effectiveMatchId && anyDiff
                  const fillableSlotCount = m.playerSlots.filter(
                    (s) => s.currentId === null && s.resolvedNewId !== null,
                  ).length
                  const nullSlotCount = m.playerSlots.filter(
                    (s) => s.currentId === null,
                  ).length

                  return (
                    <tr
                      key={i}
                      style={{
                        borderBottom: '1px solid #f3f4f6',
                        background: isSelected
                          ? '#f0fdf4'
                          : i % 2 === 0
                            ? '#fff'
                            : '#f9fafb',
                      }}
                    >
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
                        ) : m.dbHasTime ? (
                          <span title="Already has time" style={{ color: '#999' }}>
                            —
                          </span>
                        ) : null}
                      </td>
                      <td
                        style={{
                          padding: '5px 8px',
                          fontWeight: 500,
                          color: '#333',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {m.court}
                      </td>
                      <td
                        style={{
                          padding: '5px 8px',
                          color: '#3b82f6',
                          fontWeight: 600,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {m.scheduleLabel}
                      </td>
                      <td style={{ padding: '5px 8px' }}>
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 600,
                            padding: '1px 5px',
                            borderRadius: 3,
                            background:
                              m.category === 'men'
                                ? '#dbeafe'
                                : m.category === 'women'
                                  ? '#fce7f3'
                                  : '#f3f4f6',
                            color:
                              m.category === 'men'
                                ? '#1e40af'
                                : m.category === 'women'
                                  ? '#9d174d'
                                  : '#666',
                          }}
                        >
                          {m.category === 'men'
                            ? 'M'
                            : m.category === 'women'
                              ? 'W'
                              : '?'}
                          {m.oopRound ? ` ${m.oopRound}` : ''}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: '5px 8px',
                          color: '#111',
                          maxWidth: 260,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {m.team1Display}
                      </td>
                      <td
                        style={{
                          padding: '5px 8px',
                          color: '#111',
                          maxWidth: 260,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {m.team2Display}
                      </td>
                      <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                        {m.confidence === 'none' && !hasManualLink ? (
                          <input
                            type="text"
                            placeholder="paste UUID"
                            value={manualLinks[i] || ''}
                            onChange={(e) => {
                              const val = e.target.value.trim()
                              setManualLinks((prev) =>
                                val
                                  ? { ...prev, [i]: val }
                                  : (() => {
                                      const n = { ...prev }
                                      delete n[i]
                                      return n
                                    })(),
                              )
                            }}
                            style={{
                              width: 110,
                              padding: '2px 4px',
                              fontSize: 9,
                              fontFamily: 'monospace',
                              border: '1px solid #d1d5db',
                              borderRadius: 3,
                              color: '#333',
                            }}
                          />
                        ) : (
                          <span
                            style={{
                              fontSize: 8,
                              fontWeight: 700,
                              padding: '2px 5px',
                              borderRadius: 3,
                              background: conf.bg,
                              color: conf.text,
                            }}
                          >
                            {hasManualLink ? 'MANUAL' : conf.label}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '5px 8px' }}>
                        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                          {m.needsTimeChange && (
                            <span
                              title={
                                m.dbScheduledAt
                                  ? `Time: ${new Date(m.dbScheduledAt)
                                      .toISOString()
                                      .slice(11, 16)} → ${
                                      m.proposedScheduledAt
                                        ? new Date(m.proposedScheduledAt)
                                            .toISOString()
                                            .slice(11, 16)
                                        : '?'
                                    }`
                                  : 'Will set time'
                              }
                              style={chipBlue}
                            >
                              ↻ TIME
                            </span>
                          )}
                          {m.needsCourtChange && (
                            <span
                              title={`Court: ${m.dbCourt ?? '(none)'} → ${
                                m.proposedCourt ?? '?'
                              }`}
                              style={chipAmber}
                            >
                              ↻ COURT
                            </span>
                          )}
                          {m.needsPlayersChange && (
                            <span
                              title={`Players: will fill ${fillableSlotCount} of ${nullSlotCount} TBD slot${
                                nullSlotCount === 1 ? '' : 's'
                              } (Option A — null-only writes)`}
                              style={chipGreen}
                            >
                              ↻ {fillableSlotCount}/{nullSlotCount} TBD
                            </span>
                          )}
                          {!anyDiff && m.dbMatchId && (
                            <span
                              title="All fields match DB — nothing to apply"
                              style={{
                                fontSize: 9,
                                fontWeight: 500,
                                padding: '1px 5px',
                                color: '#9ca3af',
                                letterSpacing: '0.03em',
                              }}
                            >
                              ✓ in sync
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '5px 8px', color: '#666', fontSize: 10 }}>
                        {m.dbMatchRound || '—'}
                      </td>
                      <td
                        style={{
                          padding: '5px 8px',
                          fontFamily: 'monospace',
                          fontSize: 10,
                          color: '#555',
                        }}
                      >
                        {m.proposedScheduledAt
                          ? new Date(m.proposedScheduledAt)
                              .toISOString()
                              .replace('T', ' ')
                              .slice(0, 16)
                          : '—'}
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

// ── Small atoms ─────────────────────────────────────────────────────────

const th: React.CSSProperties = {
  padding: '6px 8px',
  textAlign: 'left',
  color: '#666',
  fontWeight: 600,
}

const chipBlue: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  padding: '1px 5px',
  borderRadius: 3,
  background: '#dbeafe',
  color: '#1e40af',
  letterSpacing: '0.03em',
}

const chipAmber: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  padding: '1px 5px',
  borderRadius: 3,
  background: '#fef3c7',
  color: '#92400e',
  letterSpacing: '0.03em',
}

const chipGreen: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  padding: '1px 5px',
  borderRadius: 3,
  background: '#dcfce7',
  color: '#166534',
  letterSpacing: '0.03em',
}

function SummaryTile({
  label,
  value,
  color,
  monospace,
}: {
  label: string
  value: string | number
  color: string
  monospace?: boolean
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          color: '#999',
          fontWeight: 600,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 700,
          color,
          fontFamily: monospace ? 'monospace' : undefined,
        }}
      >
        {value}
      </div>
    </div>
  )
}

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
//   1. Fetching /api/internal/schedule-review for the selected (tournament, day)
//   2. Rendering per-field diff chips (↻ TIME / ↻ COURT / ↻ N/M TBD)
//   3. Auto-selecting high-confidence rows with diffs
//   4. Committing selected diffs via PATCH /api/internal/schedule-review
//
// Behaviour parity with the old ScheduleTab is the goal — the extracted
// table + apply flow is byte-for-byte identical. If this page diverges
// from the old one in the future, prefer keeping BOTH branches behind a
// prop rather than forking — the embedded + standalone surfaces should
// stay visually aligned.

import React, { useCallback, useEffect, useState } from 'react'
import { PlayerLink } from '@/components/PlayerLink'

// ── Types (shared with the API — keep in sync with schedule-review/route.ts) ─

type PlayerSlotKey =
  | 'pair1_player1_id'
  | 'pair1_player2_id'
  | 'pair2_player1_id'
  | 'pair2_player2_id'

/** Per-slot player payload — see route.ts for shape provenance.
 *  Optional in the type so older (cached) responses without the nested
 *  block fall back to the legacy team1Display / team2Display strings
 *  without crashing. */
interface ExplorerPlayer {
  id: string | null
  name: string
  avatar_url: string | null
  ranking: number | null
  padelapi_id: string | null
  fip_id: string | null
  /** Resolved player's country — feeds PlayerLink hover card flag (T3 of Plan 8).
   *  Falls back to the OOP-side country code when the slot didn't resolve. */
  country: string | null
}

interface PlayerSlotDiff {
  slot: PlayerSlotKey
  currentId: string | null
  oopName: string | null
  resolvedNewId: string | null
  country?: string | null
  player?: ExplorerPlayer | null
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
  background: 'var(--bg-card)',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--r-lg)',
  padding: 12,
}

const confidenceColor: Record<string, { bg: string; text: string; label: string }> = {
  high: { bg: 'var(--lime-bg)', text: 'var(--lime-text)', label: 'HIGH' },
  medium: { bg: 'var(--orange-bg)', text: 'var(--orange-text)', label: 'MEDIUM' },
  low: { bg: 'var(--live-bg)', text: 'var(--live-text)', label: 'LOW' },
  none: { bg: 'var(--bg-card-2)', text: 'var(--text-3)', label: 'NO MATCH' },
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
      `/api/internal/schedule-review?tournament_id=${tournamentId}&code=${encodeURIComponent(
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
      const res = await fetch('/api/internal/schedule-review', {
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
            `/api/internal/schedule-review?tournament_id=${tournamentId}&code=${encodeURIComponent(
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
          color: 'var(--text-3)',
          textTransform: 'uppercase',
          letterSpacing: 0.4,
        }}
      >
        Apply OOP → public.matches (day {day}
        {dayDate ? ` · ${dayDate}` : ''})
      </div>

      {loading && (
        <div style={{ ...card, color: 'var(--text-3)', fontSize: 12 }}>
          Loading schedule review…
        </div>
      )}

      {error && (
        <div
          style={{
            ...card,
            background: 'var(--live-bg)',
            border: '1px solid var(--live-border)',
            color: 'var(--live-text)',
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
              color="var(--text-1)"
            />
            <SummaryTile label="Matched" value={result.matched} color="var(--lime-text)" />
            <SummaryTile
              label="Unmatched"
              value={result.unmatched}
              color={result.unmatched > 0 ? 'var(--orange-text)' : 'var(--text-3)'}
            />
            {typeof result.needsUpdateCount === 'number' && (
              <SummaryTile
                label="Needs Update"
                value={result.needsUpdateCount}
                color={result.needsUpdateCount > 0 ? 'var(--men)' : 'var(--text-3)'}
              />
            )}
            <SummaryTile label="TZ" value={result.timezone} color="var(--text-2)" monospace />

            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button
                onClick={toggleAll}
                style={{
                  padding: '4px 12px',
                  fontSize: 11,
                  fontWeight: 600,
                  borderRadius: 'var(--r-sm)',
                  border: '1px solid var(--border-card)',
                  cursor: 'pointer',
                  background: 'var(--bg-card)',
                  color: 'var(--text-2)',
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
                  borderRadius: 'var(--r-sm)',
                  border: 'none',
                  cursor: selected.size === 0 || applying ? 'default' : 'pointer',
                  background: 'var(--lime)',
                  color: 'var(--lime-ink)',
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
                background: applyResult.errors.length > 0 ? 'var(--live-bg)' : 'var(--lime-bg)',
                border: `1px solid ${
                  applyResult.errors.length > 0 ? 'var(--live-border)' : 'var(--lime-border)'
                }`,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: applyResult.errors.length > 0 ? 'var(--live-text)' : 'var(--lime-text)',
                }}
              >
                ✓ Updated: {applyResult.updated} | Skipped: {applyResult.skipped} |
                Errors: {applyResult.errors.length}
              </div>
              {applyResult.errors.map((e, i) => (
                <div key={i} style={{ fontSize: 11, color: 'var(--live-text)' }}>
                  • {e}
                </div>
              ))}
            </div>
          )}

          {/* Review table */}
          <div style={{ ...card, padding: 0, overflow: 'auto' }}>
            <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-card)', background: 'var(--bg-card-2)' }}>
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
                        borderBottom: '1px solid var(--border-inner)',
                        background: isSelected
                          ? 'var(--lime-bg)'
                          : i % 2 === 0
                            ? 'var(--bg-card)'
                            : 'var(--bg-card-2)',
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
                          <span title="Already has time" style={{ color: 'var(--text-3)' }}>
                            —
                          </span>
                        ) : null}
                      </td>
                      <td
                        style={{
                          padding: '5px 8px',
                          fontWeight: 500,
                          color: 'var(--text-2)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {m.court}
                      </td>
                      <td
                        style={{
                          padding: '5px 8px',
                          color: 'var(--men)',
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
                            borderRadius: 'var(--r-xs)',
                            background:
                              m.category === 'men'
                                ? 'var(--men-bg)'
                                : m.category === 'women'
                                  ? 'var(--women-bg)'
                                  : 'var(--bg-card-2)',
                            color:
                              m.category === 'men'
                                ? 'var(--men)'
                                : m.category === 'women'
                                  ? 'var(--women)'
                                  : 'var(--text-3)',
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
                          color: 'var(--text-1)',
                          maxWidth: 260,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <TeamCell
                          p1={m.playerSlots[0]}
                          p2={m.playerSlots[1]}
                          fallback={m.team1Display}
                        />
                      </td>
                      <td
                        style={{
                          padding: '5px 8px',
                          color: 'var(--text-1)',
                          maxWidth: 260,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <TeamCell
                          p1={m.playerSlots[2]}
                          p2={m.playerSlots[3]}
                          fallback={m.team2Display}
                        />
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
                            className="ui-input"
                            style={{
                              width: 110,
                              padding: '2px 4px',
                              fontSize: 9,
                              fontFamily: 'monospace',
                            }}
                          />
                        ) : (
                          <span
                            style={{
                              fontSize: 8,
                              fontWeight: 700,
                              padding: '2px 5px',
                              borderRadius: 'var(--r-xs)',
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
                                color: 'var(--text-3)',
                                letterSpacing: '0.03em',
                              }}
                            >
                              ✓ in sync
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '5px 8px', color: 'var(--text-3)', fontSize: 10 }}>
                        {m.dbMatchRound || '—'}
                      </td>
                      <td
                        style={{
                          padding: '5px 8px',
                          fontFamily: 'monospace',
                          fontSize: 10,
                          color: 'var(--text-2)',
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
  color: 'var(--text-3)',
  fontWeight: 600,
}

const chipBlue: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  padding: '1px 5px',
  borderRadius: 'var(--r-xs)',
  background: 'var(--men-bg)',
  color: 'var(--men)',
  letterSpacing: '0.03em',
}

const chipAmber: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  padding: '1px 5px',
  borderRadius: 'var(--r-xs)',
  background: 'var(--orange-bg)',
  color: 'var(--orange-text)',
  letterSpacing: '0.03em',
}

const chipGreen: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  padding: '1px 5px',
  borderRadius: 'var(--r-xs)',
  background: 'var(--lime-bg)',
  color: 'var(--lime-text)',
  letterSpacing: '0.03em',
}

/**
 * Render a pair as "Player1 / Player2", each name routed through PlayerLink
 * (status-dot + deep-link to /players/[id] when resolved). Country code
 * (when present on the OOP row) is appended in muted gray, matching the
 * legacy "(ESP)" annotation in team1Display.
 *
 * Falls back to the legacy concatenated `fallback` string when the
 * `playerSlots` block is missing on the API response (older cache hits or
 * if a slot didn't have a name at all).
 */
function TeamCell({
  p1,
  p2,
  fallback,
}: {
  p1: PlayerSlotDiff | undefined
  p2: PlayerSlotDiff | undefined
  fallback: string
}) {
  const slot1 = p1?.player ?? null
  const slot2 = p2?.player ?? null
  if (!slot1 && !slot2) return <>{fallback}</>
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
      {slot1 && (
        <>
          <PlayerLink player={slot1} />
          {p1?.country && (
            <span style={{ fontSize: 10, color: 'var(--text-3)' }}>({p1.country})</span>
          )}
        </>
      )}
      {slot1 && slot2 && <span style={{ color: 'var(--text-3)' }}>/</span>}
      {slot2 && (
        <>
          <PlayerLink player={slot2} />
          {p2?.country && (
            <span style={{ fontSize: 10, color: 'var(--text-3)' }}>({p2.country})</span>
          )}
        </>
      )}
    </span>
  )
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
          color: 'var(--text-3)',
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

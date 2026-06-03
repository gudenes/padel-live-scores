// Shared client core for refreshing one tournament: POST the existing refresh
// endpoint, re-check that tournament's readiness, and classify the outcome.
// Used by both the single RefreshRowButton and the bulk orchestrator so they
// behave identically.

import type { ReadinessRow } from './types'

export type RefreshOutcome = 'added' | 'no-data' | 'error'

export interface RefreshResult {
  outcome: RefreshOutcome
  label: string
  added: boolean
  row?: ReadinessRow
  message?: string
}

export type RowRunPhase = 'queued' | 'running' | 'done' | 'error'
export interface RowRunStatus { phase: RowRunPhase; label?: string; added?: boolean; message?: string }

interface StepResult { name?: string; summary?: Record<string, unknown> }

export function summarizeRefresh(steps: StepResult[] | undefined): { total: number; matches: number } {
  let total = 0
  let matches = 0
  for (const s of steps ?? []) {
    const sum = s?.summary ?? {}
    for (const [k, v] of Object.entries(sum)) {
      if (typeof v !== 'number') continue
      if (/inserted$|written$|resolved$/i.test(k) || k === 'inserted') {
        total += v
        if (/match/i.test(k)) matches += v
      }
    }
    // fip-draw-populator's `inserted` counter is matches inserted from the draw.
    if (s?.name === 'fip-draw-populator' && typeof sum.inserted === 'number') matches += sum.inserted
  }
  return { total, matches }
}

export function buildRefreshLabel(total: number, matches: number): { label: string; added: boolean; outcome: RefreshOutcome } {
  if (matches > 0) return { label: `✓ +${matches} ${matches === 1 ? 'match' : 'matches'}`, added: true, outcome: 'added' }
  if (total > 0) return { label: `✓ ${total} updated`, added: true, outcome: 'added' }
  return { label: '✓ no new data', added: false, outcome: 'no-data' }
}

/** POST refresh for one tournament, then re-check its readiness. Never throws. */
export async function refreshAndRecheck(tournamentId: string): Promise<RefreshResult> {
  try {
    const res = await fetch('/api/internal/refresh-tournament', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tournamentId }),
      credentials: 'same-origin',
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      const reason = json?.error?.message || json?.error || `HTTP ${res.status}`
      return { outcome: 'error', label: 'error', added: false, message: typeof reason === 'string' ? reason : JSON.stringify(reason) }
    }
    const { total, matches } = summarizeRefresh(json?.data?.stepResults as StepResult[] | undefined)
    const { label, added, outcome } = buildRefreshLabel(total, matches)

    const rc = await fetch(`/api/internal/tournament-readiness?id=${encodeURIComponent(tournamentId)}`, { credentials: 'same-origin' })
    const rcJson = (await rc.json().catch(() => ({}))) as { rows?: ReadinessRow[]; error?: string }
    if (!rc.ok) {
      return { outcome: 'error', label: 'error', added, message: rcJson.error || `re-check HTTP ${rc.status}` }
    }
    return { outcome, label, added, row: (rcJson.rows ?? [])[0] }
  } catch (err) {
    return { outcome: 'error', label: 'error', added: false, message: err instanceof Error ? err.message : String(err) }
  }
}

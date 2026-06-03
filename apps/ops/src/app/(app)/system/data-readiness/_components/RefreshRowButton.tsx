'use client'

import { useState, type MouseEvent } from 'react'
import type { ReadinessRow } from './types'

// Per-row refresh: triggers padelgod's on-demand ingestion for this one
// tournament (the existing /api/internal/refresh-tournament endpoint), then
// re-checks that tournament's readiness (?id=) and hands the fresh row back
// so the table updates in place. Lets an operator kick a fetch for a single
// "scraped, not populated" tournament and immediately see whether it filled.

type State = 'idle' | 'running' | 'done' | 'error'

interface StepResult { name?: string; summary?: Record<string, unknown> }

// Sum the rows padelgod actually wrote, from the refresh stepResults. padelgod
// returns ok=true even when every worker was a no-op (out-of-scope tournament,
// not in the populate allowlist, nothing on Crionet), so a bare "✓ Refreshed"
// is misleading. We count additive fields (…Inserted / …Written / …Resolved /
// the draw-populator's `inserted`) and split out matches as the headline.
function summarizeRefresh(steps: StepResult[] | undefined): { total: number; matches: number } {
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

export default function RefreshRowButton({
  tournamentId,
  onRefreshed,
}: {
  tournamentId: string
  onRefreshed: (row: ReadinessRow) => void
}) {
  const [state, setState] = useState<State>('idle')
  const [msg, setMsg] = useState<string | null>(null)
  const [doneLabel, setDoneLabel] = useState('✓ Done')
  const [doneAdded, setDoneAdded] = useState(false)

  async function onClick(e: MouseEvent) {
    e.stopPropagation() // don't toggle the row's expand
    if (state === 'running') return
    setState('running')
    setMsg(null)
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
        setState('error')
        setMsg(typeof reason === 'string' ? reason : JSON.stringify(reason))
        return
      }
      // Honest outcome from what padelgod actually wrote.
      const { total, matches } = summarizeRefresh(json?.data?.stepResults as StepResult[] | undefined)
      const label = matches > 0
        ? `✓ +${matches} ${matches === 1 ? 'match' : 'matches'}`
        : total > 0
          ? `✓ ${total} updated`
          : '✓ no new data'
      setDoneLabel(label)
      setDoneAdded(matches > 0 || total > 0)
      // Re-check this one tournament's readiness and update the row.
      const rc = await fetch(`/api/internal/tournament-readiness?id=${encodeURIComponent(tournamentId)}`, {
        credentials: 'same-origin',
      })
      const rcJson = (await rc.json().catch(() => ({}))) as { rows?: ReadinessRow[]; error?: string }
      if (!rc.ok) {
        setState('error')
        setMsg(rcJson.error || `re-check HTTP ${rc.status}`)
        return
      }
      const updated = (rcJson.rows ?? [])[0]
      if (updated) onRefreshed(updated)
      setState('done')
    } catch (err) {
      setState('error')
      setMsg(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
      <button
        type="button"
        onClick={onClick}
        disabled={state === 'running'}
        title="Trigger a padelgod fetch for this tournament, then re-check its readiness"
        style={{
          padding: '4px 10px',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '.4px',
          textTransform: 'uppercase',
          color: state === 'running'
            ? 'var(--text-3)'
            : state === 'done'
              ? (doneAdded ? 'var(--rd-ok)' : 'var(--rd-gap)')
              : 'var(--text-1)',
          background: 'var(--bg-hover)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--r-sm)',
          cursor: state === 'running' ? 'wait' : 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {state === 'running' ? 'Refreshing…' : state === 'done' ? doneLabel : 'Refresh'}
      </button>
      {state === 'error' && msg && (
        <span style={{ fontSize: 10, color: 'var(--rd-bad)', maxWidth: 240, textAlign: 'right' }}>{msg}</span>
      )}
    </span>
  )
}

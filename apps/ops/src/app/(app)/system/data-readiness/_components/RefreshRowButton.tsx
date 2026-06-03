'use client'

import { useState, type MouseEvent } from 'react'
import type { ReadinessRow } from './types'

// Per-row refresh: triggers padelgod's on-demand ingestion for this one
// tournament (the existing /api/internal/refresh-tournament endpoint), then
// re-checks that tournament's readiness (?id=) and hands the fresh row back
// so the table updates in place. Lets an operator kick a fetch for a single
// "scraped, not populated" tournament and immediately see whether it filled.

type State = 'idle' | 'running' | 'done' | 'error'

export default function RefreshRowButton({
  tournamentId,
  onRefreshed,
}: {
  tournamentId: string
  onRefreshed: (row: ReadinessRow) => void
}) {
  const [state, setState] = useState<State>('idle')
  const [msg, setMsg] = useState<string | null>(null)

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
          color: state === 'running' ? 'var(--text-3)' : state === 'done' ? 'var(--rd-ok)' : 'var(--text-1)',
          background: 'var(--bg-hover)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--r-sm)',
          cursor: state === 'running' ? 'wait' : 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {state === 'running' ? 'Refreshing…' : state === 'done' ? '✓ Refreshed' : 'Refresh'}
      </button>
      {state === 'error' && msg && (
        <span style={{ fontSize: 10, color: 'var(--rd-bad)', maxWidth: 240, textAlign: 'right' }}>{msg}</span>
      )}
    </span>
  )
}

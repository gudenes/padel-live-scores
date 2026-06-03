'use client'

import { useState, type MouseEvent } from 'react'
import type { ReadinessRow } from './types'
import { refreshAndRecheck, type RowRunStatus } from './refresh-tournament-client'

export default function RefreshRowButton({
  tournamentId,
  onRefreshed,
  externalStatus,
}: {
  tournamentId: string
  onRefreshed: (row: ReadinessRow) => void
  externalStatus?: RowRunStatus   // when set (bulk run), the button reflects this instead of its own state
}) {
  const [localStatus, setLocalStatus] = useState<RowRunStatus>({ phase: 'queued' })
  const [touched, setTouched] = useState(false) // has the single button been clicked?

  const status: RowRunStatus = externalStatus ?? localStatus
  const running = status.phase === 'running'

  async function onClick(e: MouseEvent) {
    e.stopPropagation()
    if (running || externalStatus) return // don't allow single-click while bulk drives this row
    setTouched(true)
    setLocalStatus({ phase: 'running' })
    const r = await refreshAndRecheck(tournamentId)
    if (r.outcome === 'error') {
      setLocalStatus({ phase: 'error', message: r.message })
      return
    }
    if (r.row) onRefreshed(r.row)
    setLocalStatus({ phase: 'done', label: r.label, added: r.added })
  }

  const showStatus = externalStatus ?? (touched ? localStatus : null)
  const labelText =
    showStatus?.phase === 'running' ? 'Refreshing…'
    : showStatus?.phase === 'done' ? (showStatus.label ?? '✓ Done')
    : showStatus?.phase === 'error' ? 'error'
    : 'Refresh'
  const color =
    showStatus?.phase === 'running' ? 'var(--text-3)'
    : showStatus?.phase === 'done' ? (showStatus.added ? 'var(--rd-ok)' : 'var(--rd-gap)')
    : showStatus?.phase === 'error' ? 'var(--rd-bad)'
    : 'var(--text-1)'

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
      <button
        type="button"
        onClick={onClick}
        disabled={running || Boolean(externalStatus)}
        title="Trigger a padelgod fetch for this tournament, then re-check its readiness"
        style={{
          padding: '4px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase',
          color, background: 'var(--bg-hover)', border: '1px solid var(--border-strong)',
          borderRadius: 'var(--r-sm)', cursor: running ? 'wait' : externalStatus ? 'default' : 'pointer', whiteSpace: 'nowrap',
        }}
      >
        {labelText}
      </button>
      {showStatus?.phase === 'error' && showStatus.message && (
        <span style={{ fontSize: 10, color: 'var(--rd-bad)', maxWidth: 240, textAlign: 'right' }}>{showStatus.message}</span>
      )}
    </span>
  )
}

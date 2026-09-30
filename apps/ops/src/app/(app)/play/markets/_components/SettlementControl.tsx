'use client'
import { useState } from 'react'

export default function SettlementControl({ marketId, onSaved }: { marketId: string; onSaved: () => void }) {
  const [revision, setRevision] = useState<number | null>(null)
  const [outcome, setOutcome] = useState('yes')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function open() {
    setBusy(true); setError('')
    try {
      const res = await fetch(`/api/internal/play-settlement?marketId=${marketId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setRevision(data.settlement_revision)
      setOutcome(data.status === 'void' ? 'void' : data.outcome === false ? 'no' : 'yes')
    } catch (e) { setError(e instanceof Error ? e.message : 'Unavailable') }
    finally { setBusy(false) }
  }
  async function save() {
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/internal/play-settlement', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketId, outcome, reason, revision }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setRevision(null); setReason(''); onSaved()
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save') }
    finally { setBusy(false) }
  }
  return <div style={{ marginTop: 8 }}>
    {revision === null ? <button className="ui-btn" data-size="sm" disabled={busy} onClick={() => void open()}>Resolve / correct</button>
      : <div style={{ display: 'grid', gap: 8, minWidth: 200 }}>
        <label>Final outcome <select value={outcome} onChange={e => setOutcome(e.target.value)}><option value="yes">Yes</option><option value="no">No</option><option value="void">Void · refund</option></select></label>
        <label>Reason <textarea value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} /></label>
        <small>Updates balances and notifies affected players. An already-spent payout can leave a negative balance.</small>
        <button className="ui-btn" disabled={busy || reason.trim().length < 10} onClick={() => void save()}>Apply result and notify</button>
        <button className="ui-btn" disabled={busy} onClick={() => setRevision(null)}>Cancel</button>
      </div>}
    {error && <p role="alert">{error}</p>}
  </div>
}

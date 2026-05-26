'use client'
// src/app/ops/yt-channels/YtChannelsTable.tsx
//
// Table view: avatar + name + channel ID (truncated) + active toggle
// + live? badge + actions (Edit / Delete / Test).

import { useState } from 'react'
import type { OpsChannel } from './types'

export default function YtChannelsTable({
  channels,
  onEdit,
  onRefresh,
}: {
  channels: OpsChannel[]
  onEdit: (c: OpsChannel) => void
  onRefresh: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, string>>({})

  async function onDelete(c: OpsChannel) {
    if (!confirm(`Delete channel "${c.name}"? Cascade-deletes its live rows.`)) return
    setBusy(c.id)
    try {
      const res = await fetch(`/api/internal/youtube-channels/${c.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`delete failed: ${res.status}`)
      onRefresh()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally { setBusy(null) }
  }

  async function onTest(c: OpsChannel) {
    setBusy(c.id)
    setTestResult(prev => ({ ...prev, [c.id]: 'testing...' }))
    try {
      const res = await fetch(`/api/internal/youtube-channels/${c.id}/test`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `test failed: ${res.status}`)
      setTestResult(prev => ({ ...prev, [c.id]: `${json.liveCount} live` }))
    } catch (e) {
      setTestResult(prev => ({ ...prev, [c.id]: `error: ${e instanceof Error ? e.message : String(e)}` }))
    } finally { setBusy(null) }
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'left' }}>
          <th style={{ padding: '8px 6px', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: '#9CA3AF' }}></th>
          <th style={{ padding: '8px 6px', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: '#9CA3AF' }}>Name</th>
          <th style={{ padding: '8px 6px', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: '#9CA3AF' }}>Channel ID</th>
          <th style={{ padding: '8px 6px', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: '#9CA3AF' }}>Order</th>
          <th style={{ padding: '8px 6px', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: '#9CA3AF' }}>Active</th>
          <th style={{ padding: '8px 6px', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: '#9CA3AF' }}>Live now</th>
          <th style={{ padding: '8px 6px', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: '#9CA3AF' }}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {channels.map(c => (
          <tr key={c.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <td style={{ padding: '10px 6px' }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                background: c.color_hex, display: 'inline-flex',
                alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: 11, fontWeight: 800,
              }}>{c.abbreviation}</div>
            </td>
            <td style={{ padding: '10px 6px' }}>{c.name}</td>
            <td style={{ padding: '10px 6px', fontFamily: 'monospace', fontSize: 11, color: '#9CA3AF' }}>
              {c.channel_id.slice(0, 6)}...{c.channel_id.slice(-4)}
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(c.channel_id)}
                style={{ marginLeft: 6, background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#9CA3AF', fontSize: 9, padding: '1px 4px', cursor: 'pointer' }}
              >COPY</button>
            </td>
            <td style={{ padding: '10px 6px', fontFamily: 'monospace' }}>{c.display_order}</td>
            <td style={{ padding: '10px 6px' }}>
              {c.is_active
                ? <span style={{ color: '#7ED321', fontWeight: 700 }}>YES</span>
                : <span style={{ color: '#6B7280' }}>NO</span>}
            </td>
            <td style={{ padding: '10px 6px' }}>
              {c.live.length > 0
                ? <span style={{ color: '#FF4655', fontWeight: 800 }}>&#9679; {c.live.length}</span>
                : <span style={{ color: '#6B7280' }}>&#8212;</span>}
              {testResult[c.id] && (
                <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>{testResult[c.id]}</div>
              )}
            </td>
            <td style={{ padding: '10px 6px' }}>
              <button onClick={() => onEdit(c)} disabled={busy === c.id}
                style={{ marginRight: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}>EDIT</button>
              <button onClick={() => onTest(c)} disabled={busy === c.id}
                style={{ marginRight: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}>TEST</button>
              <button onClick={() => onDelete(c)} disabled={busy === c.id}
                style={{ padding: '4px 8px', fontSize: 11, color: '#FF4655', cursor: 'pointer' }}>DELETE</button>
            </td>
          </tr>
        ))}
        {channels.length === 0 && (
          <tr><td colSpan={7} style={{ padding: 16, color: '#6B7280', textAlign: 'center' }}>
            No channels yet. Add one above.
          </td></tr>
        )}
      </tbody>
    </table>
  )
}

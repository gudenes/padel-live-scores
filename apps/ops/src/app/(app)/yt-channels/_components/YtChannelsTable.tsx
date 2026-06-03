'use client'
// src/app/ops/yt-channels/YtChannelsTable.tsx
//
// Table view: avatar + name + channel ID (truncated) + active toggle
// + live? badge + actions (Edit / Delete / Test).

import { useState } from 'react'
import type { OpsChannel } from './types'
import { DataTable, Button, Pill } from '@/components/ui'

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
    <DataTable>
      <thead>
        <tr>
          <th></th>
          <th>Name</th>
          <th>Channel ID</th>
          <th>Order</th>
          <th>Active</th>
          <th>Live now</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {channels.map(c => (
          <tr key={c.id}>
            <td>
              <div style={{
                width: 32, height: 32, borderRadius: 'var(--r-full)',
                background: c.color_hex, display: 'inline-flex',
                alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: 11, fontWeight: 800,
              }}>{c.abbreviation}</div>
            </td>
            <td>{c.name}</td>
            <td style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-3)' }}>
              {c.channel_id.slice(0, 6)}...{c.channel_id.slice(-4)}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigator.clipboard.writeText(c.channel_id)}
                style={{ marginLeft: 6, fontSize: 9, padding: '1px 4px' }}
              >COPY</Button>
            </td>
            <td style={{ fontFamily: 'var(--mono)' }}>{c.display_order}</td>
            <td>
              {c.is_active
                ? <Pill tone="lime">YES</Pill>
                : <Pill tone="neutral">NO</Pill>}
            </td>
            <td>
              {c.live.length > 0
                ? <Pill tone="live" dot pulse>{c.live.length}</Pill>
                : <span style={{ color: 'var(--text-3)' }}>&#8212;</span>}
              {testResult[c.id] && (
                <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>{testResult[c.id]}</div>
              )}
            </td>
            <td>
              <div style={{ display: 'flex', gap: 6 }}>
                <Button size="sm" onClick={() => onEdit(c)} disabled={busy === c.id}>EDIT</Button>
                <Button size="sm" onClick={() => onTest(c)} disabled={busy === c.id}>TEST</Button>
                <Button size="sm" variant="danger" onClick={() => onDelete(c)} disabled={busy === c.id}>DELETE</Button>
              </div>
            </td>
          </tr>
        ))}
        {channels.length === 0 && (
          <tr><td colSpan={7} style={{ color: 'var(--text-3)', textAlign: 'center' }}>
            No channels yet. Add one above.
          </td></tr>
        )}
      </tbody>
    </DataTable>
  )
}

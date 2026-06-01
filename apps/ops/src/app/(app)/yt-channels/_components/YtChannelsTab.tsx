'use client'
// src/app/ops/yt-channels/YtChannelsTab.tsx
//
// "YT Channels" tab in the ops dashboard. Owns the list-fetch state
// and the open/close state for the add modal + edit drawer.

import { useCallback, useEffect, useState } from 'react'
import type { OpsChannel } from './types'
import YtChannelsTable from './YtChannelsTable'
import YtChannelAddModal from './YtChannelAddModal'
import YtChannelEditDrawer from './YtChannelEditDrawer'
import { PageHeader, Button, Skeleton } from '@/components/ui'

export default function YtChannelsTab() {
  const [channels, setChannels] = useState<OpsChannel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<OpsChannel | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/internal/youtube-channels')
      if (!res.ok) throw new Error(`list failed: ${res.status}`)
      const json = (await res.json()) as { channels: OpsChannel[] }
      setChannels(json.channels)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  return (
    <div className="ui-page">
      <PageHeader
        title="YouTube Channels"
        actions={
          <Button variant="primary" onClick={() => setAddOpen(true)}>+ Add channel</Button>
        }
      />

      {loading && <Skeleton rows={4} />}
      {error && <div style={{ color: 'var(--live-text)', fontSize: 13 }}>Error: {error}</div>}
      {!loading && !error && (
        <YtChannelsTable channels={channels} onEdit={setEditing} onRefresh={refresh} />
      )}

      {addOpen && (
        <YtChannelAddModal onClose={() => setAddOpen(false)} onCreated={() => { setAddOpen(false); refresh() }} />
      )}
      {editing && (
        <YtChannelEditDrawer
          channel={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh() }}
          onDeleted={() => { setEditing(null); refresh() }}
        />
      )}
    </div>
  )
}

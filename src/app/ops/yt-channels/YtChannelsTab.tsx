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

export default function YtChannelsTab() {
  const [channels, setChannels] = useState<OpsChannel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<OpsChannel | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/ops/youtube-channels')
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
    <div style={{ padding: '16px 4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>YouTube Channels</h2>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          style={{
            padding: '8px 14px', background: '#7ED321', color: '#0A0A0A',
            border: 0, fontWeight: 800, cursor: 'pointer',
          }}
        >+ ADD CHANNEL</button>
      </div>

      {loading && <div style={{ color: '#9CA3AF', fontSize: 13 }}>Loading...</div>}
      {error && <div style={{ color: '#FF4655', fontSize: 13 }}>Error: {error}</div>}
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

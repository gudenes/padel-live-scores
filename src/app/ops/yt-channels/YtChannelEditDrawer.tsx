'use client'
// src/app/ops/yt-channels/YtChannelEditDrawer.tsx
//
// Right-side drawer for editing an existing channel. Allows changing
// name, abbreviation, color, display order, and active state. Channel
// ID and uploads playlist ID are read-only (immutable post-creation).

import { useState } from 'react'
import type { OpsChannel } from './types'

export default function YtChannelEditDrawer({
  channel,
  onClose,
  onSaved,
  onDeleted,
}: {
  channel: OpsChannel
  onClose: () => void
  onSaved: () => void
  onDeleted: () => void
}) {
  const [name, setName] = useState(channel.name)
  const [abbreviation, setAbbreviation] = useState(channel.abbreviation)
  const [colorHex, setColorHex] = useState(channel.color_hex)
  const [displayOrder, setDisplayOrder] = useState(channel.display_order)
  const [isActive, setIsActive] = useState(channel.is_active)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSave(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true); setError(null)
    try {
      const res = await fetch(`/api/ops/youtube-channels/${channel.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, abbreviation, colorHex, displayOrder, isActive }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `save failed: ${res.status}`)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  async function onDelete() {
    if (!confirm(`Delete channel "${channel.name}"? Cascade-deletes its live rows.`)) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/ops/youtube-channels/${channel.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`delete failed: ${res.status}`)
      onDeleted()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000 }}
    >
      <form
        onClick={e => e.stopPropagation()}
        onSubmit={onSave}
        style={{
          position: 'absolute', top: 0, right: 0, height: '100%',
          width: 'min(420px, 92vw)',
          background: '#1A1A1A', padding: 20,
          borderLeft: '1px solid rgba(255,255,255,0.08)',
          color: '#fff', fontSize: 13,
          overflowY: 'auto',
        }}
      >
        <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>Edit Channel</h3>

        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={{ display: 'block', fontSize: 11, color: '#9CA3AF', marginBottom: 4 }}>Channel ID (immutable)</span>
          <input type="text" value={channel.channel_id} readOnly
            style={{ width: '100%', padding: '8px 10px', background: '#0A0A0A', border: '1px solid rgba(255,255,255,0.05)', color: '#6B7280', fontSize: 12, fontFamily: 'monospace' }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={{ display: 'block', fontSize: 11, color: '#9CA3AF', marginBottom: 4 }}>Display name</span>
          <input type="text" value={name} onChange={e => setName(e.target.value)} required
            style={{ width: '100%', padding: '8px 10px', background: '#0A0A0A', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 13 }}
          />
        </label>

        <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
          <label style={{ flex: 1 }}>
            <span style={{ display: 'block', fontSize: 11, color: '#9CA3AF', marginBottom: 4 }}>Abbreviation</span>
            <input type="text" value={abbreviation} onChange={e => setAbbreviation(e.target.value.toUpperCase().slice(0, 3))} required maxLength={3}
              style={{ width: '100%', padding: '8px 10px', background: '#0A0A0A', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 13 }}
            />
          </label>
          <label>
            <span style={{ display: 'block', fontSize: 11, color: '#9CA3AF', marginBottom: 4 }}>Color</span>
            <input type="color" value={colorHex} onChange={e => setColorHex(e.target.value.toUpperCase())}
              style={{ width: 40, height: 36, background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }}
            />
          </label>
          <label style={{ width: 80 }}>
            <span style={{ display: 'block', fontSize: 11, color: '#9CA3AF', marginBottom: 4 }}>Order</span>
            <input type="number" value={displayOrder} onChange={e => setDisplayOrder(parseInt(e.target.value, 10) || 100)}
              style={{ width: '100%', padding: '8px 10px', background: '#0A0A0A', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 13 }}
            />
          </label>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
          <span>Active (cron polls this channel)</span>
        </label>

        {error && <div style={{ color: '#FF4655', fontSize: 12, marginBottom: 10 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <button type="button" onClick={onDelete} disabled={submitting}
            style={{ padding: '8px 14px', background: 'transparent', border: '1px solid rgba(255,70,85,0.5)', color: '#FF4655', cursor: 'pointer' }}
          >Delete</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={onClose} disabled={submitting}
              style={{ padding: '8px 14px', background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', cursor: 'pointer' }}
            >Cancel</button>
            <button type="submit" disabled={submitting}
              style={{ padding: '8px 14px', background: '#7ED321', color: '#0A0A0A', border: 0, fontWeight: 800, cursor: 'pointer' }}
            >{submitting ? 'Saving...' : 'Save'}</button>
          </div>
        </div>
      </form>
    </div>
  )
}

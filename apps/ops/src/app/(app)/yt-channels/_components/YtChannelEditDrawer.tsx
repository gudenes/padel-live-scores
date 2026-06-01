'use client'
// src/app/ops/yt-channels/YtChannelEditDrawer.tsx
//
// Right-side drawer for editing an existing channel. Allows changing
// name, abbreviation, color, display order, and active state. Channel
// ID and uploads playlist ID are read-only (immutable post-creation).

import { useState } from 'react'
import type { OpsChannel } from './types'
import { Field, Button } from '@/components/ui'

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
      const res = await fetch(`/api/internal/youtube-channels/${channel.id}`, {
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
      const res = await fetch(`/api/internal/youtube-channels/${channel.id}`, { method: 'DELETE' })
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
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000 }}
    >
      <form
        onClick={e => e.stopPropagation()}
        onSubmit={onSave}
        style={{
          position: 'absolute', top: 0, right: 0, height: '100%',
          width: 'min(420px, 92vw)',
          background: 'var(--bg-surface)', padding: 20,
          borderLeft: '1px solid var(--border-card)',
          color: 'var(--text-1)', fontSize: 13,
          overflowY: 'auto',
        }}
      >
        <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700, color: 'var(--text-1)' }}>Edit Channel</h3>

        <div style={{ marginBottom: 10 }}>
          <Field label="Channel ID (immutable)">
            <input type="text" value={channel.channel_id} readOnly
              className="ui-input"
              style={{ color: 'var(--text-3)', fontFamily: 'var(--mono)', fontSize: 12 }}
            />
          </Field>
        </div>

        <div style={{ marginBottom: 10 }}>
          <Field label="Display name">
            <input type="text" value={name} onChange={e => setName(e.target.value)} required
              className="ui-input"
            />
          </Field>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
          <div style={{ flex: 1 }}>
            <Field label="Abbreviation">
              <input type="text" value={abbreviation} onChange={e => setAbbreviation(e.target.value.toUpperCase().slice(0, 3))} required maxLength={3}
                className="ui-input"
              />
            </Field>
          </div>
          <Field label="Color">
            <input type="color" value={colorHex} onChange={e => setColorHex(e.target.value.toUpperCase())}
              style={{ width: 40, height: 36, background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', cursor: 'pointer' }}
            />
          </Field>
          <div style={{ width: 80 }}>
            <Field label="Order">
              <input type="number" value={displayOrder} onChange={e => setDisplayOrder(parseInt(e.target.value, 10) || 100)}
                className="ui-input"
              />
            </Field>
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, color: 'var(--text-2)' }}>
          <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} style={{ accentColor: 'var(--lime)' }} />
          <span>Active (cron polls this channel)</span>
        </label>

        {error && <div style={{ color: 'var(--live-text)', fontSize: 12, marginBottom: 10 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <Button type="button" variant="danger" onClick={onDelete} disabled={submitting}>Delete</Button>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={submitting}>{submitting ? 'Saving...' : 'Save'}</Button>
          </div>
        </div>
      </form>
    </div>
  )
}

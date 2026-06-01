'use client'
// src/app/ops/yt-channels/YtChannelAddModal.tsx
//
// Form: paste handle / URL / channel ID + name + abbreviation + color +
// display order. POSTs to /api/internal/youtube-channels which resolves the
// channel ID and inserts the row.

import { useState } from 'react'
import { Field, Button } from '@/components/ui'

export default function YtChannelAddModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [input, setInput] = useState('')
  const [name, setName] = useState('')
  const [abbreviation, setAbbreviation] = useState('')
  const [colorHex, setColorHex] = useState('#FF0000')
  const [displayOrder, setDisplayOrder] = useState(100)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true); setError(null)
    try {
      const res = await fetch('/api/internal/youtube-channels', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input, name, abbreviation, colorHex, displayOrder }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `create failed: ${res.status}`)
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <form
        onClick={e => e.stopPropagation()}
        onSubmit={onSubmit}
        style={{
          background: 'var(--bg-surface)', padding: 20,
          width: 'min(440px, 92vw)',
          border: '1px solid var(--border-card)', borderRadius: 'var(--r-lg)',
          color: 'var(--text-1)', fontSize: 13,
        }}
      >
        <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700, color: 'var(--text-1)' }}>Add YouTube Channel</h3>

        <div style={{ marginBottom: 10 }}>
          <Field label="Handle, URL, or channel ID">
            <input
              type="text" value={input} onChange={e => setInput(e.target.value)}
              placeholder="@PremierPadelOfficial"
              required
              className="ui-input"
            />
          </Field>
        </div>

        <div style={{ marginBottom: 10 }}>
          <Field label="Display name">
            <input
              type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="Premier Padel"
              required
              className="ui-input"
            />
          </Field>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <Field label="Abbreviation (2-3 chars)">
              <input
                type="text" value={abbreviation} onChange={e => setAbbreviation(e.target.value.toUpperCase().slice(0, 3))}
                placeholder="PP" required maxLength={3}
                className="ui-input"
              />
            </Field>
          </div>
          <Field label="Color">
            <input
              type="color" value={colorHex} onChange={e => setColorHex(e.target.value.toUpperCase())}
              style={{ width: 40, height: 36, background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', cursor: 'pointer' }}
            />
          </Field>
          <div style={{ width: 80 }}>
            <Field label="Order">
              <input
                type="number" value={displayOrder} onChange={e => setDisplayOrder(parseInt(e.target.value, 10) || 100)}
                className="ui-input"
              />
            </Field>
          </div>
        </div>

        {error && <div style={{ color: 'var(--live-text)', fontSize: 12, marginTop: 10 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={submitting}>{submitting ? 'Adding...' : 'Add'}</Button>
        </div>
      </form>
    </div>
  )
}

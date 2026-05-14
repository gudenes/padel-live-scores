'use client'
// src/app/ops/yt-channels/YtChannelAddModal.tsx
//
// Form: paste handle / URL / channel ID + name + abbreviation + color +
// display order. POSTs to /api/ops/youtube-channels which resolves the
// channel ID and inserts the row.

import { useState } from 'react'

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
      const res = await fetch('/api/ops/youtube-channels', {
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
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <form
        onClick={e => e.stopPropagation()}
        onSubmit={onSubmit}
        style={{
          background: '#1A1A1A', padding: 20,
          width: 'min(440px, 92vw)',
          border: '1px solid rgba(255,255,255,0.08)',
          color: '#fff', fontSize: 13,
        }}
      >
        <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>Add YouTube Channel</h3>

        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={{ display: 'block', fontSize: 11, color: '#9CA3AF', marginBottom: 4 }}>
            Handle, URL, or channel ID
          </span>
          <input
            type="text" value={input} onChange={e => setInput(e.target.value)}
            placeholder="@PremierPadelOfficial"
            required
            style={{ width: '100%', padding: '8px 10px', background: '#0A0A0A', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 13 }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={{ display: 'block', fontSize: 11, color: '#9CA3AF', marginBottom: 4 }}>Display name</span>
          <input
            type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="Premier Padel"
            required
            style={{ width: '100%', padding: '8px 10px', background: '#0A0A0A', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 13 }}
          />
        </label>

        <div style={{ display: 'flex', gap: 10 }}>
          <label style={{ flex: 1 }}>
            <span style={{ display: 'block', fontSize: 11, color: '#9CA3AF', marginBottom: 4 }}>Abbreviation (2-3 chars)</span>
            <input
              type="text" value={abbreviation} onChange={e => setAbbreviation(e.target.value.toUpperCase().slice(0, 3))}
              placeholder="PP" required maxLength={3}
              style={{ width: '100%', padding: '8px 10px', background: '#0A0A0A', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 13 }}
            />
          </label>
          <label>
            <span style={{ display: 'block', fontSize: 11, color: '#9CA3AF', marginBottom: 4 }}>Color</span>
            <input
              type="color" value={colorHex} onChange={e => setColorHex(e.target.value.toUpperCase())}
              style={{ width: 40, height: 36, background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }}
            />
          </label>
          <label style={{ width: 80 }}>
            <span style={{ display: 'block', fontSize: 11, color: '#9CA3AF', marginBottom: 4 }}>Order</span>
            <input
              type="number" value={displayOrder} onChange={e => setDisplayOrder(parseInt(e.target.value, 10) || 100)}
              style={{ width: '100%', padding: '8px 10px', background: '#0A0A0A', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 13 }}
            />
          </label>
        </div>

        {error && <div style={{ color: '#FF4655', fontSize: 12, marginTop: 10 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onClose} disabled={submitting}
            style={{ padding: '8px 14px', background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', cursor: 'pointer' }}
          >Cancel</button>
          <button type="submit" disabled={submitting}
            style={{ padding: '8px 14px', background: '#7ED321', color: '#0A0A0A', border: 0, fontWeight: 800, cursor: 'pointer' }}
          >{submitting ? 'Adding...' : 'Add'}</button>
        </div>
      </form>
    </div>
  )
}

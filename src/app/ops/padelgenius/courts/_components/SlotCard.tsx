'use client'
import { useRef, useState } from 'react'
import type { SlotConfig, BrandingSlots } from '@/lib/padelgenius/types'

type Slot = keyof BrandingSlots

export function SlotCard({
  slug, slot, label, dimsHint, value, onChange,
}: {
  slug: string; slot: Slot; label: string; dimsHint: string;
  value: SlotConfig | null;
  onChange: (next: SlotConfig | null) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const upload = async (file: File) => {
    setBusy(true)
    const fd = new FormData()
    fd.append('slot', slot)
    fd.append('logo', file)
    fd.append('scale', String(value?.scale ?? 1.0))
    const r = await fetch(`/api/ops/padelgenius/courts/${slug}/sponsor`, { method: 'POST', body: fd })
    setBusy(false)
    if (!r.ok) { alert('Upload failed'); return }
    const j = await r.json()
    onChange({ logoUrl: j.logoUrl, scale: j.scale })
  }
  const remove = async () => {
    setBusy(true)
    await fetch(`/api/ops/padelgenius/courts/${slug}/sponsor`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot }),
    })
    setBusy(false)
    onChange(null)
  }

  const on = !!value
  return (
    <div style={{ background: '#1a1a2e', border: `2px solid ${on ? '#22c55e' : '#2a2a3e'}`, borderRadius: 8, padding: 10 }}>
      <input ref={ref} type="file" accept="image/png,image/svg+xml" hidden onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ color: '#fde047', fontSize: 10, fontWeight: 800, letterSpacing: 0.5 }}>{label}</div>
        <div style={{ background: on ? '#22c55e' : '#475569', color: on ? '#0a0a14' : '#fff', fontSize: 8, fontWeight: 900, padding: '2px 6px', borderRadius: 8 }}>{on ? 'ON' : 'OFF'}</div>
      </div>
      <div style={{ width: '100%', height: 38, background: on ? `url("${value!.logoUrl}") center/contain no-repeat #0e0e1a` : '#0e0e1a', border: '1px dashed #2a2a3e', borderRadius: 4, marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: 10 }}>
        {!on && 'Click below to upload'}
      </div>
      <div style={{ color: '#94a3b8', fontSize: 9, marginBottom: 6 }}>{dimsHint}</div>
      <div style={{ display: 'flex', gap: 4 }}>
        <button onClick={() => ref.current?.click()} disabled={busy} style={{ flex: 1, background: '#0e0e1a', border: '1px solid #2a2a3e', borderRadius: 4, padding: '4px 0', color: '#aaa', fontSize: 9, fontWeight: 700, cursor: 'pointer' }}>{on ? 'REPLACE' : 'UPLOAD'}</button>
        {on && <button onClick={remove} disabled={busy} style={{ flex: 1, background: '#0e0e1a', border: '1px solid #2a2a3e', borderRadius: 4, padding: '4px 0', color: '#ef4444', fontSize: 9, fontWeight: 700, cursor: 'pointer' }}>REMOVE</button>}
      </div>
      {on && (
        <div style={{ marginTop: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#888', fontSize: 9, marginBottom: 1 }}><span>scale</span><span style={{ color: '#fff' }}>{value!.scale.toFixed(2)}x</span></div>
          <input type="range" min={0.5} max={2.0} step={0.05} value={value!.scale} onChange={e => onChange({ ...value!, scale: parseFloat(e.target.value) })} style={{ width: '100%', accentColor: '#7dd3fc' }} />
        </div>
      )}
    </div>
  )
}

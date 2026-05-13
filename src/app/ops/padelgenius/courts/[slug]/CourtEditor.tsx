'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { CourtConfig } from '@/lib/padelgenius/types'
import { DimensionsTab } from '../_components/DimensionsTab'
import { ZonesTab } from '../_components/ZonesTab'
import { BrandingTab } from '../_components/BrandingTab'
import { TrajectoriesTab } from '../_components/TrajectoriesTab'

type Tab = 'dimensions' | 'zones' | 'branding' | 'trajectories'

export function CourtEditor({ slug, initial }: { slug: string; initial: CourtConfig }) {
  const [config, setConfig] = useState<CourtConfig>(initial)
  const [tab, setTab] = useState<Tab>('dimensions')
  const [busy, setBusy] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const save = async () => {
    setBusy(true)
    const r = await fetch(`/api/ops/padelgenius/courts/${slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
    setBusy(false)
    if (!r.ok) { alert('Save failed'); return }
    router.refresh()
  }

  const reset = () => setConfig(initial)

  const replaceImage = async (file: File) => {
    if (!confirm(`Replace the court image for "${config.name}"?\n\nThe new PNG will overwrite the existing one. Existing calibration (bounds, zones, branding) is kept — you may need to retune dimensions after the swap.`)) return
    setReplacing(true)
    const fd = new FormData()
    fd.append('court', file)
    const r = await fetch(`/api/ops/padelgenius/courts/${slug}/image`, { method: 'POST', body: fd })
    setReplacing(false)
    if (!r.ok) { alert('Replace failed'); return }
    // Append a cache-buster to imageUrl so live previews (which read the
    // CourtConfig in local state) refetch the new PNG immediately.
    setConfig(c => ({ ...c, imageUrl: c.imageUrl.split('?')[0] + `?v=${Date.now()}` }))
    router.refresh()
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a14', color: '#e2e8f0', padding: 16 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <Link href="/ops/padelgenius/courts" style={{ color: '#94a3b8', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <svg width={10} height={10} viewBox="-5 -5 10 10" aria-hidden="true">
            <path d="M 3 0 L -3 0 M -3 0 L 0 -3 M -3 0 L 0 3" stroke="currentColor" strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Courts
        </Link>
        <h1 style={{ fontSize: 18, fontWeight: 900, margin: 0 }}>{config.name}</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg"
            hidden
            onChange={e => e.target.files?.[0] && replaceImage(e.target.files[0])}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={replacing}
            title="Upload a new PNG to overwrite this court's image — calibration is preserved"
            style={{ background: '#1a1a2e', border: '1px solid #2a2a3e', borderRadius: 6, padding: '6px 12px', color: '#7dd3fc', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}
          >{replacing ? 'REPLACING...' : 'REPLACE IMAGE'}</button>
          <button onClick={reset} style={{ background: '#1a1a2e', border: '1px solid #2a2a3e', borderRadius: 6, padding: '6px 12px', color: '#aaa', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>RESET</button>
          <button onClick={save} disabled={busy} style={{ background: '#22c55e', border: '1px solid #15803d', borderRadius: 6, padding: '6px 12px', color: '#0a0a14', fontSize: 11, fontWeight: 900, cursor: 'pointer' }}>{busy ? 'SAVING...' : 'SAVE'}</button>
        </div>
      </header>
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: '1px solid #2a2a3e' }}>
        {(['dimensions', 'zones', 'branding', 'trajectories'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: 'transparent', border: 'none', padding: '8px 14px',
            fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase',
            color: tab === t ? '#fde047' : '#94a3b8',
            borderBottom: tab === t ? '2px solid #fde047' : '2px solid transparent',
            cursor: 'pointer',
          }}>{t}</button>
        ))}
      </div>
      {tab === 'dimensions' && <DimensionsTab config={config} onChange={setConfig} />}
      {tab === 'zones' && <ZonesTab config={config} onChange={setConfig} />}
      {tab === 'branding' && <BrandingTab slug={slug} config={config} onChange={setConfig} />}
      {tab === 'trajectories' && <TrajectoriesTab slug={slug} config={config} onChange={setConfig} />}
    </div>
  )
}

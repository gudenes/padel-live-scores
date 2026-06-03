// apps/ops/src/app/(app)/ads/_components/AdsTab.tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface Banner {
  id: string
  name: string
  country_code: string | null
  slot: string
  image_url: string
  click_url: string
  active: boolean
  weight: number
}
interface NetworkConfig {
  web_enabled: boolean
  adsense_publisher_id: string | null
  adsense_slot_id: string | null
  native_enabled: boolean
  admob_ios_app_id: string | null
  admob_android_app_id: string | null
  admob_banner_unit_id: string | null
}

type Draft = Omit<Banner, 'id'> & { id?: string }

const EMPTY: Draft = {
  name: '', country_code: null, slot: 'sticky-bottom',
  image_url: '', click_url: '', active: true, weight: 1,
}

export default function AdsTab() {
  const [banners, setBanners] = useState<Banner[]>([])
  const [editing, setEditing] = useState<Draft | null>(null)
  const [config, setConfig] = useState<NetworkConfig | null>(null)
  const [msg, setMsg] = useState<string>('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    const [b, c] = await Promise.all([
      fetch('/api/internal/ad-banners').then((r) => r.json()),
      fetch('/api/internal/ad-network-config').then((r) => r.json()),
    ])
    setBanners(b.banners ?? [])
    setConfig(c.config ?? null)
  }, [])
  // Mount-time data load; state is set after the async fetch resolves.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh() }, [refresh])

  async function saveBanner() {
    if (!editing) return
    const isNew = !editing.id
    const res = isNew
      ? await fetch('/api/internal/ad-banners', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editing) })
      : await fetch('/api/internal/ad-banners', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editing.id, updates: editing }) })
    const data = await res.json()
    if (!res.ok) { setMsg(data.error ?? 'save failed'); return }
    setMsg('Saved.')
    setEditing(null)
    await refresh()
  }

  async function uploadImage(file: File) {
    if (!editing?.id) {
      setMsg('Save the banner first, then upload an image.')
      return
    }
    setUploading(true)
    const fd = new FormData()
    fd.append('bannerId', editing.id)
    fd.append('file', file)
    const res = await fetch('/api/internal/upload-ad-banner-image', { method: 'POST', body: fd })
    const data = await res.json()
    setUploading(false)
    if (!res.ok) { setMsg(data.error ?? 'upload failed'); return }
    setEditing({ ...editing, image_url: data.url })
    setMsg('Image uploaded — click Save to persist.')
  }

  async function deleteBanner(id: string) {
    await fetch(`/api/internal/ad-banners?id=${id}`, { method: 'DELETE' })
    await refresh()
  }

  async function saveConfig() {
    if (!config) return
    const res = await fetch('/api/internal/ad-network-config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) })
    setMsg(res.ok ? 'Network config saved.' : 'Config save failed.')
  }

  const countryCounts = banners.reduce<Record<string, number>>((m, b) => {
    if (b.active) { const k = b.country_code ?? 'GLOBAL'; m[k] = (m[k] ?? 0) + 1 }
    return m
  }, {})

  return (
    <div className="ui-page">
      <h1>Ad Banners</h1>
      {msg && <p className="subtitle">{msg}</p>}

      <button onClick={() => setEditing({ ...EMPTY })}>+ New banner</button>

      <table>
        <thead><tr><th>Name</th><th>Country</th><th>Active</th><th>Weight</th><th>Preview</th><th></th></tr></thead>
        <tbody>
          {banners.map((b) => {
            const key = b.country_code ?? 'GLOBAL'
            const rotating = b.active && (countryCounts[key] ?? 0) > 1
            return (
              <tr key={b.id}>
                <td>{b.name}</td>
                <td>{b.country_code ?? 'Global'}{rotating ? ' (rotating)' : ''}</td>
                <td>{b.active ? 'Yes' : 'No'}</td>
                <td>{b.weight}</td>
                <td>{b.image_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={b.image_url} alt={b.name} style={{ height: 24 }} />
                  : '—'}</td>
                <td>
                  <button onClick={() => setEditing(b)}>Edit</button>
                  <button onClick={() => deleteBanner(b.id)}>Delete</button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {editing && (
        <div style={{ border: '1px solid #333', padding: 12, marginTop: 12 }}>
          <h3>{editing.id ? 'Edit banner' : 'New banner'}</h3>
          <label>Name <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
          <label>Country (blank = Global default) <input value={editing.country_code ?? ''} onChange={(e) => setEditing({ ...editing, country_code: e.target.value.trim() ? e.target.value.toUpperCase() : null })} placeholder="ES" maxLength={2} /></label>
          <label>Click URL <input value={editing.click_url} onChange={(e) => setEditing({ ...editing, click_url: e.target.value })} /></label>
          <label>Weight <input type="number" min={1} value={editing.weight} onChange={(e) => setEditing({ ...editing, weight: Math.max(1, Number(e.target.value) || 1) })} /></label>
          <label><input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> Active</label>
          <div>
            Image: {editing.image_url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={editing.image_url} alt="" style={{ height: 24 }} />
              : '— none —'}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f) }} />
            <button disabled={!editing.id || uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? 'Uploading…' : 'Upload image'}
            </button>
            {!editing.id && <span> (save first to enable upload)</span>}
          </div>
          <button onClick={saveBanner}>Save</button>
          <button onClick={() => setEditing(null)}>Cancel</button>
        </div>
      )}

      <h2 style={{ marginTop: 24 }}>Network Ads (AdSense / AdMob)</h2>
      <p className="subtitle">Stored for later — rendering is not wired yet.</p>
      {config && (
        <div style={{ border: '1px solid #333', padding: 12 }}>
          <h3>Web (AdSense)</h3>
          <label><input type="checkbox" checked={config.web_enabled} onChange={(e) => setConfig({ ...config, web_enabled: e.target.checked })} /> Enabled</label>
          <label>Publisher ID <input value={config.adsense_publisher_id ?? ''} onChange={(e) => setConfig({ ...config, adsense_publisher_id: e.target.value || null })} placeholder="ca-pub-…" /></label>
          <label>Ad slot ID <input value={config.adsense_slot_id ?? ''} onChange={(e) => setConfig({ ...config, adsense_slot_id: e.target.value || null })} /></label>
          <h3>Native (AdMob)</h3>
          <label><input type="checkbox" checked={config.native_enabled} onChange={(e) => setConfig({ ...config, native_enabled: e.target.checked })} /> Enabled</label>
          <label>iOS app ID <input value={config.admob_ios_app_id ?? ''} onChange={(e) => setConfig({ ...config, admob_ios_app_id: e.target.value || null })} /></label>
          <label>Android app ID <input value={config.admob_android_app_id ?? ''} onChange={(e) => setConfig({ ...config, admob_android_app_id: e.target.value || null })} /></label>
          <label>Banner ad-unit ID <input value={config.admob_banner_unit_id ?? ''} onChange={(e) => setConfig({ ...config, admob_banner_unit_id: e.target.value || null })} /></label>
          <button onClick={saveConfig}>Save network config</button>
        </div>
      )}
    </div>
  )
}

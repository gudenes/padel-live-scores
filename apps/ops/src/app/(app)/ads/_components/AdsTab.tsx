// apps/ops/src/app/(app)/ads/_components/AdsTab.tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { PageHeader, Panel, Section, Field, Button, Pill, DataTable, EmptyState } from '@/components/ui'

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

// Friendly country picker. Empty value = global default (shown everywhere
// when a visitor's country has no banner of its own).
const COUNTRIES: { code: string; label: string }[] = [
  { code: '', label: 'Global default — all countries' },
  { code: 'ES', label: 'Spain (ES)' },
  { code: 'PT', label: 'Portugal (PT)' },
  { code: 'IT', label: 'Italy (IT)' },
  { code: 'FR', label: 'France (FR)' },
  { code: 'GB', label: 'United Kingdom (GB)' },
  { code: 'DE', label: 'Germany (DE)' },
  { code: 'NL', label: 'Netherlands (NL)' },
  { code: 'BE', label: 'Belgium (BE)' },
  { code: 'SE', label: 'Sweden (SE)' },
  { code: 'US', label: 'United States (US)' },
  { code: 'BR', label: 'Brazil (BR)' },
  { code: 'AR', label: 'Argentina (AR)' },
  { code: 'MX', label: 'Mexico (MX)' },
  { code: 'CL', label: 'Chile (CL)' },
  { code: 'AE', label: 'United Arab Emirates (AE)' },
  { code: 'QA', label: 'Qatar (QA)' },
]

function countryLabel(code: string | null): string {
  if (!code) return 'Global'
  return COUNTRIES.find((c) => c.code === code)?.label.replace(/ \(.*\)$/, '') ?? code
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
    if (!editing.name.trim()) { setMsg('Name is required.'); return }
    if (!editing.click_url.trim()) { setMsg('Click URL is required.'); return }
    if (!editing.image_url.trim()) { setMsg('Upload a banner image first.'); return }
    const isNew = !editing.id
    const res = isNew
      ? await fetch('/api/internal/ad-banners', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editing) })
      : await fetch('/api/internal/ad-banners', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editing.id, updates: editing }) })
    const data = await res.json()
    if (!res.ok) { setMsg(data.error ?? 'Save failed.'); return }
    setMsg('Saved.')
    setEditing(null)
    await refresh()
  }

  async function uploadImage(file: File) {
    if (!editing?.id) { setMsg('Save the banner first, then upload an image.'); return }
    setUploading(true)
    const fd = new FormData()
    fd.append('bannerId', editing.id)
    fd.append('file', file)
    const res = await fetch('/api/internal/upload-ad-banner-image', { method: 'POST', body: fd })
    const data = await res.json()
    setUploading(false)
    if (!res.ok) { setMsg(data.error ?? 'Upload failed.'); return }
    setEditing({ ...editing, image_url: data.url })
    setMsg('Image uploaded — click Save to persist.')
  }

  async function deleteBanner(id: string, name: string) {
    if (!confirm(`Delete banner "${name}"? This cannot be undone.`)) return
    await fetch(`/api/internal/ad-banners?id=${id}`, { method: 'DELETE' })
    if (editing?.id === id) setEditing(null)
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
      <PageHeader
        title="Ad Banners"
        subtitle="Direct-sold sticky banners shown on the public app, targeted by visitor country. A country with no banner of its own falls back to the Global default."
      />

      {msg && <div style={{ marginBottom: 12 }}><Pill tone="lime" dot>{msg}</Pill></div>}

      <Section
        label={`Banners (${banners.length})`}
        actions={<Button variant="primary" onClick={() => { setEditing({ ...EMPTY }); setMsg('') }}>+ New banner</Button>}
      >
        <Panel padded={false}>
          {banners.length === 0 ? (
            <div style={{ padding: 16 }}>
              <EmptyState title="No banners yet" hint="Click “+ New banner” to add your first sponsor creative." />
            </div>
          ) : (
            <DataTable>
              <thead>
                <tr>
                  <th>Preview</th>
                  <th>Name</th>
                  <th>Country</th>
                  <th>Status</th>
                  <th>Weight</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {banners.map((b) => {
                  const key = b.country_code ?? 'GLOBAL'
                  const rotating = b.active && (countryCounts[key] ?? 0) > 1
                  return (
                    <tr key={b.id}>
                      <td>{b.image_url
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={b.image_url} alt={b.name} style={{ height: 26, borderRadius: 4, background: '#0b1220' }} />
                        : <span style={{ color: 'var(--text-3)' }}>—</span>}</td>
                      <td>{b.name}</td>
                      <td>{countryLabel(b.country_code)}</td>
                      <td style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {b.active ? <Pill tone="lime" dot>Active</Pill> : <Pill tone="neutral">Off</Pill>}
                        {rotating && <Pill tone="warn">Rotating</Pill>}
                      </td>
                      <td>{b.weight}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <Button variant="ghost" size="sm" onClick={() => { setEditing(b); setMsg('') }}>Edit</Button>{' '}
                        <Button variant="danger" size="sm" onClick={() => deleteBanner(b.id, b.name)}>Delete</Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </DataTable>
          )}
        </Panel>
      </Section>

      {editing && (
        <Section label={editing.id ? `Edit “${editing.name || 'banner'}”` : 'New banner'}>
          <Panel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="Name (sponsor / label)">
                <input className="ui-input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="AceProGrip" />
              </Field>
              <Field label="Country">
                <select className="ui-input" value={editing.country_code ?? ''} onChange={(e) => setEditing({ ...editing, country_code: e.target.value || null })}>
                  {COUNTRIES.map((c) => <option key={c.code || 'global'} value={c.code}>{c.label}</option>)}
                </select>
              </Field>
              <Field label="Click-through URL">
                <input className="ui-input" value={editing.click_url} onChange={(e) => setEditing({ ...editing, click_url: e.target.value })} placeholder="https://www.aceprogrip.es/" />
              </Field>
              <Field label="Weight (higher = shown more often when rotating)">
                <input className="ui-input" type="number" min={1} value={editing.weight} onChange={(e) => setEditing({ ...editing, weight: Math.max(1, Number(e.target.value) || 1) })} />
              </Field>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 14, flexWrap: 'wrap' }}>
              <label className="ui-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
                <span className="ui-field-label" style={{ margin: 0 }}>Active</span>
              </label>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {editing.image_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={editing.image_url} alt="" style={{ height: 30, borderRadius: 4, background: '#0b1220' }} />
                  : <span style={{ color: 'var(--text-3)' }}>No image yet</span>}
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f) }} />
                <Button variant="default" size="sm" disabled={!editing.id || uploading} onClick={() => fileRef.current?.click()}>
                  {uploading ? 'Uploading…' : editing.image_url ? 'Replace image' : 'Upload image'}
                </Button>
                {!editing.id && <span style={{ color: 'var(--text-3)', fontSize: 12 }}>Save first to enable upload</span>}
              </div>
            </div>
            <p style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 8 }}>Creative: 320×50 (PNG / JPG / WebP / SVG, ≤2 MB).</p>

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <Button variant="primary" onClick={saveBanner}>Save</Button>
              <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </Panel>
        </Section>
      )}

      <Section label="Network ads (AdSense / AdMob)">
        <Panel>
          <p style={{ color: 'var(--text-3)', marginTop: 0, fontSize: 13 }}>Stored for later — programmatic rendering isn’t wired up yet. Fills countries that have no direct banner once enabled.</p>
          {config && (
            <>
              <h4 style={{ margin: '12px 0 6px' }}>Web — Google AdSense</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <label className="ui-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={config.web_enabled} onChange={(e) => setConfig({ ...config, web_enabled: e.target.checked })} />
                  <span className="ui-field-label" style={{ margin: 0 }}>Enabled</span>
                </label>
                <span />
                <Field label="Publisher ID">
                  <input className="ui-input" value={config.adsense_publisher_id ?? ''} onChange={(e) => setConfig({ ...config, adsense_publisher_id: e.target.value || null })} placeholder="ca-pub-…" />
                </Field>
                <Field label="Ad slot ID">
                  <input className="ui-input" value={config.adsense_slot_id ?? ''} onChange={(e) => setConfig({ ...config, adsense_slot_id: e.target.value || null })} />
                </Field>
              </div>

              <h4 style={{ margin: '18px 0 6px' }}>Native — Google AdMob</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <label className="ui-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={config.native_enabled} onChange={(e) => setConfig({ ...config, native_enabled: e.target.checked })} />
                  <span className="ui-field-label" style={{ margin: 0 }}>Enabled</span>
                </label>
                <span />
                <Field label="iOS app ID">
                  <input className="ui-input" value={config.admob_ios_app_id ?? ''} onChange={(e) => setConfig({ ...config, admob_ios_app_id: e.target.value || null })} />
                </Field>
                <Field label="Android app ID">
                  <input className="ui-input" value={config.admob_android_app_id ?? ''} onChange={(e) => setConfig({ ...config, admob_android_app_id: e.target.value || null })} />
                </Field>
                <Field label="Banner ad-unit ID">
                  <input className="ui-input" value={config.admob_banner_unit_id ?? ''} onChange={(e) => setConfig({ ...config, admob_banner_unit_id: e.target.value || null })} />
                </Field>
              </div>

              <div style={{ marginTop: 16 }}>
                <Button variant="primary" onClick={saveConfig}>Save network config</Button>
              </div>
            </>
          )}
        </Panel>
      </Section>
    </div>
  )
}

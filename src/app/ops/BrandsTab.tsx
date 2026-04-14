'use client'
// src/app/ops/BrandsTab.tsx
// Brands & Equipment management UI for the ops dashboard

import React, { useState, useEffect, useCallback } from 'react'

// ── Types ────────────────────────────────────────────────────────

interface Brand {
  id: string
  name: string
  logo_url: string | null
  website_url: string | null
  racket_count?: number
}

interface Racket {
  id: string
  brand_id: string
  brand_name?: string
  model: string
  year: number | null
  shape: string | null
  weight_grams: number | null
  balance: string | null
  surface_material: string | null
  image_url: string | null
  product_url: string | null
  affiliate_url: string | null
  click_count: number
}

type BrandFormData = {
  name: string
  logo_url: string
  website_url: string
}

type RacketFormData = {
  brand_id: string
  model: string
  year: string
  shape: string
  weight_grams: string
  balance: string
  surface_material: string
  image_url: string
  product_url: string
  affiliate_url: string
}

const SHAPE_OPTIONS = ['diamond', 'round', 'teardrop', 'hybrid'] as const
const BALANCE_OPTIONS = ['low', 'medium', 'high'] as const

const emptyBrandForm = (): BrandFormData => ({ name: '', logo_url: '', website_url: '' })
const emptyRacketForm = (): RacketFormData => ({
  brand_id: '', model: '', year: '', shape: '', weight_grams: '',
  balance: '', surface_material: '', image_url: '', product_url: '', affiliate_url: '',
})

// ── Shared styles ────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'white',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 16,
}

const sectionLabel: React.CSSProperties = {
  fontSize: 10,
  color: '#9ca3af',
  textTransform: 'uppercase' as const,
  fontWeight: 700,
  letterSpacing: 1,
  marginBottom: 8,
}

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#6B7280',
  fontWeight: 600,
  marginBottom: 2,
  display: 'block',
}

const inputStyle: React.CSSProperties = {
  padding: '5px 7px',
  fontSize: 11,
  border: '1px solid #e5e7eb',
  borderRadius: 4,
  width: '100%',
  boxSizing: 'border-box',
}

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  background: 'white',
}

const btnPrimary: React.CSSProperties = {
  background: '#111',
  color: 'white',
  border: 'none',
  borderRadius: 6,
  fontSize: 11,
  fontWeight: 600,
  padding: '6px 14px',
  cursor: 'pointer',
}

const btnSecondary: React.CSSProperties = {
  background: '#f3f4f6',
  color: '#111',
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  fontSize: 11,
  fontWeight: 500,
  padding: '6px 14px',
  cursor: 'pointer',
}

const thStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#6B7280',
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  padding: '6px 8px',
  textAlign: 'left',
  borderBottom: '1px solid #e5e7eb',
}

const tdStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#111',
  padding: '6px 8px',
  borderBottom: '1px solid #f3f4f6',
  verticalAlign: 'middle',
}

// ── Component ────────────────────────────────────────────────────

export default function BrandsTab() {
  // Brands state
  const [brands, setBrands] = useState<Brand[]>([])
  const [loadingBrands, setLoadingBrands] = useState(false)
  const [showBrandForm, setShowBrandForm] = useState(false)
  const [editingBrandId, setEditingBrandId] = useState<string | null>(null)
  const [brandForm, setBrandForm] = useState<BrandFormData>(emptyBrandForm())
  const [savingBrand, setSavingBrand] = useState(false)
  const [brandMessage, setBrandMessage] = useState<string | null>(null)

  // Rackets state
  const [rackets, setRackets] = useState<Racket[]>([])
  const [loadingRackets, setLoadingRackets] = useState(false)
  const [brandFilter, setBrandFilter] = useState<string>('')
  const [showRacketForm, setShowRacketForm] = useState(false)
  const [editingRacketId, setEditingRacketId] = useState<string | null>(null)
  const [racketForm, setRacketForm] = useState<RacketFormData>(emptyRacketForm())
  const [savingRacket, setSavingRacket] = useState(false)
  const [racketMessage, setRacketMessage] = useState<string | null>(null)

  // ── Fetch brands ──────────────────────────────────────────────

  const fetchBrands = useCallback(async () => {
    setLoadingBrands(true)
    try {
      const res = await fetch('/api/ops/brands')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setBrands(json.brands ?? [])
    } catch (err) {
      console.error('Failed to fetch brands:', err)
      setBrandMessage('Failed to load brands')
    } finally {
      setLoadingBrands(false)
    }
  }, [])

  // ── Fetch rackets ─────────────────────────────────────────────

  const fetchRackets = useCallback(async () => {
    setLoadingRackets(true)
    try {
      const url = brandFilter
        ? `/api/ops/rackets?brand_id=${brandFilter}`
        : '/api/ops/rackets'
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      // Map nested brand object to flat brand_name for display
      const mapped = (json.rackets ?? []).map((r: any) => ({
        ...r,
        brand_name: r.brand?.name ?? r.brand_name ?? null,
      }))
      setRackets(mapped)
    } catch (err) {
      console.error('Failed to fetch rackets:', err)
      setRacketMessage('Failed to load rackets')
    } finally {
      setLoadingRackets(false)
    }
  }, [brandFilter])

  useEffect(() => { fetchBrands() }, [fetchBrands])
  useEffect(() => { fetchRackets() }, [fetchRackets])

  // ── Save brand ────────────────────────────────────────────────

  const saveBrand = async () => {
    if (!brandForm.name.trim()) {
      setBrandMessage('Name is required')
      return
    }
    setSavingBrand(true)
    setBrandMessage(null)
    try {
      const method = editingBrandId ? 'PATCH' : 'POST'
      // PATCH expects { id, updates }, POST expects flat fields
      const body = editingBrandId
        ? { id: editingBrandId, updates: brandForm }
        : brandForm
      const res = await fetch('/api/ops/brands', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? `HTTP ${res.status}`)
      }
      setBrandMessage(editingBrandId ? 'Brand updated' : 'Brand created')
      setShowBrandForm(false)
      setEditingBrandId(null)
      setBrandForm(emptyBrandForm())
      await fetchBrands()
    } catch (err: unknown) {
      setBrandMessage(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setSavingBrand(false)
    }
  }

  // ── Save racket ───────────────────────────────────────────────

  const saveRacket = async () => {
    if (!racketForm.brand_id) {
      setRacketMessage('Brand is required')
      return
    }
    if (!racketForm.model.trim()) {
      setRacketMessage('Model is required')
      return
    }
    setSavingRacket(true)
    setRacketMessage(null)
    try {
      const method = editingRacketId ? 'PATCH' : 'POST'
      const fields: Record<string, unknown> = {
        brand_id: racketForm.brand_id,
        model: racketForm.model,
        shape: racketForm.shape || null,
        balance: racketForm.balance || null,
        surface_material: racketForm.surface_material || null,
        image_url: racketForm.image_url || null,
        product_url: racketForm.product_url || null,
        year: racketForm.year ? parseInt(racketForm.year, 10) : null,
        weight_grams: racketForm.weight_grams ? parseInt(racketForm.weight_grams, 10) : null,
      }
      // PATCH expects { id, updates }, POST expects flat fields
      const payload = editingRacketId ? { id: editingRacketId, updates: fields } : fields
      const res = await fetch('/api/ops/rackets', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? `HTTP ${res.status}`)
      }
      setRacketMessage(editingRacketId ? 'Racket updated' : 'Racket created')
      setShowRacketForm(false)
      setEditingRacketId(null)
      setRacketForm(emptyRacketForm())
      await fetchRackets()
      await fetchBrands() // refresh racket counts
    } catch (err: unknown) {
      setRacketMessage(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setSavingRacket(false)
    }
  }

  // ── Edit handlers ─────────────────────────────────────────────

  const startEditBrand = (b: Brand) => {
    setEditingBrandId(b.id)
    setBrandForm({
      name: b.name,
      logo_url: b.logo_url ?? '',
      website_url: b.website_url ?? '',
    })
    setShowBrandForm(true)
    setBrandMessage(null)
  }

  const startEditRacket = (r: Racket) => {
    setEditingRacketId(r.id)
    setRacketForm({
      brand_id: r.brand_id,
      model: r.model,
      year: r.year?.toString() ?? '',
      shape: r.shape ?? '',
      weight_grams: r.weight_grams?.toString() ?? '',
      balance: r.balance ?? '',
      surface_material: r.surface_material ?? '',
      image_url: r.image_url ?? '',
      product_url: r.product_url ?? '',
      affiliate_url: r.affiliate_url ?? '',
    })
    setShowRacketForm(true)
    setRacketMessage(null)
  }

  const cancelBrandForm = () => {
    setShowBrandForm(false)
    setEditingBrandId(null)
    setBrandForm(emptyBrandForm())
    setBrandMessage(null)
  }

  const cancelRacketForm = () => {
    setShowRacketForm(false)
    setEditingRacketId(null)
    setRacketForm(emptyRacketForm())
    setRacketMessage(null)
  }

  // ── Render ────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ═══ Brands Section ═══ */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={sectionLabel}>Brands</div>
          {!showBrandForm && (
            <button style={btnPrimary} onClick={() => { setShowBrandForm(true); setEditingBrandId(null); setBrandForm(emptyBrandForm()) }}>
              + Add Brand
            </button>
          )}
        </div>

        {/* Brand form */}
        {showBrandForm && (
          <div style={{ background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: 6, padding: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#111', marginBottom: 8 }}>
              {editingBrandId ? 'Edit Brand' : 'New Brand'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={labelStyle}>Name *</label>
                <input
                  style={inputStyle}
                  value={brandForm.name}
                  onChange={e => setBrandForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Bullpadel"
                />
              </div>
              <div>
                <label style={labelStyle}>Logo URL</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    style={{ ...inputStyle, flex: 1 }}
                    value={brandForm.logo_url}
                    onChange={e => setBrandForm(f => ({ ...f, logo_url: e.target.value }))}
                    placeholder="https://..."
                  />
                  {brandForm.logo_url && (
                    <img
                      src={brandForm.logo_url}
                      alt="preview"
                      style={{ height: 20, objectFit: 'contain', borderRadius: 2, flexShrink: 0 }}
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                  )}
                </div>
              </div>
              <div>
                <label style={labelStyle}>Website URL</label>
                <input
                  style={inputStyle}
                  value={brandForm.website_url}
                  onChange={e => setBrandForm(f => ({ ...f, website_url: e.target.value }))}
                  placeholder="https://..."
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button style={btnPrimary} onClick={saveBrand} disabled={savingBrand}>
                {savingBrand ? 'Saving...' : 'Save'}
              </button>
              <button style={btnSecondary} onClick={cancelBrandForm}>Cancel</button>
              {brandMessage && (
                <span style={{ fontSize: 11, color: brandMessage.startsWith('Error') ? '#dc2626' : '#16a34a', marginLeft: 8 }}>
                  {brandMessage}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Brand message (when form is closed) */}
        {!showBrandForm && brandMessage && (
          <div style={{ fontSize: 11, color: brandMessage.startsWith('Error') ? '#dc2626' : '#16a34a', marginBottom: 8 }}>
            {brandMessage}
          </div>
        )}

        {/* Brands table */}
        {loadingBrands ? (
          <div style={{ fontSize: 11, color: '#9ca3af', padding: 12 }}>Loading brands...</div>
        ) : brands.length === 0 ? (
          <div style={{ fontSize: 11, color: '#9ca3af', padding: 12 }}>No brands found. Add one to get started.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Logo</th>
                <th style={thStyle}>Website</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Rackets</th>
                <th style={{ ...thStyle, width: 60 }} />
              </tr>
            </thead>
            <tbody>
              {brands.map(b => (
                <tr key={b.id}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{b.name}</td>
                  <td style={tdStyle}>
                    {b.logo_url ? (
                      <img
                        src={b.logo_url}
                        alt={b.name}
                        style={{ height: 20, objectFit: 'contain' }}
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                      />
                    ) : (
                      <span style={{ color: '#d1d5db', fontSize: 10 }}>--</span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    {b.website_url ? (
                      <a
                        href={b.website_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#2563eb', fontSize: 11, textDecoration: 'none' }}
                      >
                        {b.website_url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
                      </a>
                    ) : (
                      <span style={{ color: '#d1d5db', fontSize: 10 }}>--</span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{b.racket_count ?? 0}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <button
                      style={{ ...btnSecondary, padding: '3px 10px', fontSize: 10 }}
                      onClick={() => startEditBrand(b)}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ═══ Rackets Section ═══ */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={sectionLabel}>Rackets</div>
            <div>
              <select
                style={{ ...selectStyle, width: 180 }}
                value={brandFilter}
                onChange={e => setBrandFilter(e.target.value)}
              >
                <option value="">All brands</option>
                {brands.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          </div>
          {!showRacketForm && (
            <button style={btnPrimary} onClick={() => { setShowRacketForm(true); setEditingRacketId(null); setRacketForm(emptyRacketForm()) }}>
              + Add Racket
            </button>
          )}
        </div>

        {/* Racket form */}
        {showRacketForm && (
          <div style={{ background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: 6, padding: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#111', marginBottom: 8 }}>
              {editingRacketId ? 'Edit Racket' : 'New Racket'}
            </div>

            {/* Import from URL */}
            <ImportFromUrl
              brands={brands}
              onExtracted={(specs) => {
                const matchedBrand = brands.find(b => b.name.toLowerCase() === specs.brand?.toLowerCase())
                setRacketForm(f => ({
                  ...f,
                  brand_id: matchedBrand?.id ?? f.brand_id,
                  model: specs.model ?? f.model,
                  year: specs.year?.toString() ?? f.year,
                  shape: specs.shape ?? f.shape,
                  weight_grams: specs.weight_grams?.toString() ?? f.weight_grams,
                  balance: specs.balance ?? f.balance,
                  surface_material: specs.surface_material ?? f.surface_material,
                  image_url: specs.image_url ?? f.image_url,
                  product_url: specs.product_url ?? f.product_url,
                }))
              }}
            />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={labelStyle}>Brand *</label>
                <select
                  style={selectStyle}
                  value={racketForm.brand_id}
                  onChange={e => setRacketForm(f => ({ ...f, brand_id: e.target.value }))}
                >
                  <option value="">Select brand...</option>
                  {brands.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Model *</label>
                <input
                  style={inputStyle}
                  value={racketForm.model}
                  onChange={e => setRacketForm(f => ({ ...f, model: e.target.value }))}
                  placeholder="e.g. Vertex 04"
                />
              </div>
              <div>
                <label style={labelStyle}>Year</label>
                <input
                  style={inputStyle}
                  type="number"
                  value={racketForm.year}
                  onChange={e => setRacketForm(f => ({ ...f, year: e.target.value }))}
                  placeholder="2026"
                />
              </div>
              <div>
                <label style={labelStyle}>Shape</label>
                <select
                  style={selectStyle}
                  value={racketForm.shape}
                  onChange={e => setRacketForm(f => ({ ...f, shape: e.target.value }))}
                >
                  <option value="">--</option>
                  {SHAPE_OPTIONS.map(s => (
                    <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={labelStyle}>Weight (g)</label>
                <input
                  style={inputStyle}
                  type="number"
                  value={racketForm.weight_grams}
                  onChange={e => setRacketForm(f => ({ ...f, weight_grams: e.target.value }))}
                  placeholder="360"
                />
              </div>
              <div>
                <label style={labelStyle}>Balance</label>
                <select
                  style={selectStyle}
                  value={racketForm.balance}
                  onChange={e => setRacketForm(f => ({ ...f, balance: e.target.value }))}
                >
                  <option value="">--</option>
                  {BALANCE_OPTIONS.map(b => (
                    <option key={b} value={b}>{b.charAt(0).toUpperCase() + b.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Surface Material</label>
                <input
                  style={inputStyle}
                  value={racketForm.surface_material}
                  onChange={e => setRacketForm(f => ({ ...f, surface_material: e.target.value }))}
                  placeholder="Carbon fiber"
                />
              </div>
              <div>
                <label style={labelStyle}>Image URL</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    style={{ ...inputStyle, flex: 1 }}
                    value={racketForm.image_url}
                    onChange={e => setRacketForm(f => ({ ...f, image_url: e.target.value }))}
                    placeholder="https://..."
                  />
                  {racketForm.image_url && (
                    <img
                      src={racketForm.image_url}
                      alt="preview"
                      style={{ height: 30, objectFit: 'contain', borderRadius: 2, flexShrink: 0 }}
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                  )}
                </div>
              </div>
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={labelStyle}>Product URL / Affiliate Link</label>
              <input
                style={inputStyle}
                value={racketForm.product_url}
                onChange={e => setRacketForm(f => ({ ...f, product_url: e.target.value }))}
                placeholder="https://..."
              />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button style={btnPrimary} onClick={saveRacket} disabled={savingRacket}>
                {savingRacket ? 'Saving...' : 'Save'}
              </button>
              <button style={btnSecondary} onClick={cancelRacketForm}>Cancel</button>
              {racketMessage && (
                <span style={{ fontSize: 11, color: racketMessage.startsWith('Error') ? '#dc2626' : '#16a34a', marginLeft: 8 }}>
                  {racketMessage}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Racket message (when form is closed) */}
        {!showRacketForm && racketMessage && (
          <div style={{ fontSize: 11, color: racketMessage.startsWith('Error') ? '#dc2626' : '#16a34a', marginBottom: 8 }}>
            {racketMessage}
          </div>
        )}

        {/* Rackets table */}
        {loadingRackets ? (
          <div style={{ fontSize: 11, color: '#9ca3af', padding: 12 }}>Loading rackets...</div>
        ) : rackets.length === 0 ? (
          <div style={{ fontSize: 11, color: '#9ca3af', padding: 12 }}>
            {brandFilter ? 'No rackets for this brand.' : 'No rackets found. Add one to get started.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Brand</th>
                <th style={thStyle}>Model</th>
                <th style={thStyle}>Year</th>
                <th style={thStyle}>Shape</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Weight</th>
                <th style={thStyle}>Image</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Clicks</th>
                <th style={{ ...thStyle, width: 60 }} />
              </tr>
            </thead>
            <tbody>
              {rackets.map(r => (
                <tr key={r.id}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{r.brand_name ?? '--'}</td>
                  <td style={tdStyle}>{r.model}</td>
                  <td style={tdStyle}>{r.year ?? '--'}</td>
                  <td style={tdStyle}>
                    {r.shape ? r.shape.charAt(0).toUpperCase() + r.shape.slice(1) : '--'}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {r.weight_grams ? `${r.weight_grams}g` : '--'}
                  </td>
                  <td style={tdStyle}>
                    {r.image_url ? (
                      <img
                        src={r.image_url}
                        alt={r.model}
                        style={{ height: 30, objectFit: 'contain' }}
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                      />
                    ) : (
                      <span style={{ color: '#d1d5db', fontSize: 10 }}>--</span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{r.click_count ?? 0}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <button
                      style={{ ...btnSecondary, padding: '3px 10px', fontSize: 10 }}
                      onClick={() => startEditRacket(r)}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Import from URL sub-component ─────────────────────────────
function ImportFromUrl({
  brands,
  onExtracted,
}: {
  brands: { id: string; name: string }[]
  onExtracted: (specs: {
    brand: string | null; model: string | null; year: number | null
    shape: string | null; weight_grams: number | null; balance: string | null
    image_url: string | null; product_url: string | null; surface_material: string | null
  }) => void
}) {
  const [url, setUrl] = React.useState('')
  const [extracting, setExtracting] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)

  const handleExtract = async () => {
    if (!url.trim()) return
    setExtracting(true)
    setMessage(null)
    try {
      const res = await fetch('/api/ops/extract-racket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })
      const json = await res.json()
      if (!res.ok) {
        setMessage(`Error: ${json.error}`)
        return
      }
      onExtracted(json.specs)
      setMessage('Specs extracted! Review the form below and save.')
    } catch (e) {
      setMessage(`Error: ${(e as Error).message}`)
    } finally {
      setExtracting(false)
    }
  }

  return (
    <div style={{
      marginBottom: 12, padding: 10, borderRadius: 6,
      background: '#f0f7ff', border: '1px solid #bfdbfe',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#1e40af', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
        Import from URL
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          style={{
            flex: 1, padding: '6px 8px', fontSize: 12, border: '1px solid #bfdbfe',
            borderRadius: 4, color: '#111', background: '#fff',
          }}
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="Paste product page URL (e.g. https://www.bullpadel.com/...)"
          onKeyDown={e => { if (e.key === 'Enter') handleExtract() }}
        />
        <button
          onClick={handleExtract}
          disabled={extracting || !url.trim()}
          style={{
            padding: '6px 14px', fontSize: 11, fontWeight: 600, borderRadius: 4, border: 'none',
            background: extracting || !url.trim() ? '#d1d5db' : '#1e40af', color: '#fff',
            cursor: extracting || !url.trim() ? 'default' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {extracting ? 'Extracting...' : 'Extract Specs'}
        </button>
      </div>
      {message && (
        <div style={{
          fontSize: 10, marginTop: 6,
          color: message.startsWith('Error') ? '#dc2626' : '#16a34a',
        }}>
          {message}
        </div>
      )}
    </div>
  )
}

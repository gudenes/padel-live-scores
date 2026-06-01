'use client'
// src/app/ops/BrandsTab.tsx
// Brands & Equipment management UI for the ops dashboard

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Panel, Section, DataTable, Field, Button } from '@/components/ui'

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

const formCard: React.CSSProperties = {
  background: 'var(--bg-card-2)',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--r-sm)',
  padding: 12,
  marginBottom: 12,
}

const msgColor = (m: string | null) =>
  m?.startsWith('Error') ? 'var(--live-text)' : 'var(--lime-text)'

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

  // Upload state
  const [uploadingBrand, setUploadingBrand] = useState(false)
  const [uploadingRacket, setUploadingRacket] = useState(false)
  const brandFileInputRef = useRef<HTMLInputElement>(null)
  const racketFileInputRef = useRef<HTMLInputElement>(null)

  const uploadImage = async (
    kind: 'brand' | 'racket',
    entityId: string,
    file: File,
  ): Promise<string> => {
    const body = new FormData()
    body.set('kind', kind)
    body.set('entityId', entityId)
    body.set('file', file)
    const res = await fetch('/api/internal/upload-equipment-image', { method: 'POST', body })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error ?? `HTTP ${res.status}`)
    }
    const { url } = (await res.json()) as { url: string }
    return url
  }

  // ── Fetch brands ──────────────────────────────────────────────

  const fetchBrands = useCallback(async () => {
    setLoadingBrands(true)
    try {
      const res = await fetch('/api/internal/brands')
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
        ? `/api/internal/rackets?brand_id=${brandFilter}`
        : '/api/internal/rackets'
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
      const res = await fetch('/api/internal/brands', {
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
      setUploadingBrand(false)
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
      const res = await fetch('/api/internal/rackets', {
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
      setUploadingRacket(false)
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
    setUploadingBrand(false)
  }

  const cancelRacketForm = () => {
    setShowRacketForm(false)
    setEditingRacketId(null)
    setRacketForm(emptyRacketForm())
    setRacketMessage(null)
    setUploadingRacket(false)
  }

  // ── Render ────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>

      {/* ═══ Brands Section ═══ */}
      <Panel
        title="Brands"
        actions={
          !showBrandForm && (
            <Button variant="primary" onClick={() => { setShowBrandForm(true); setEditingBrandId(null); setBrandForm(emptyBrandForm()) }}>
              + Add Brand
            </Button>
          )
        }
      >
        {/* Brand form */}
        {showBrandForm && (
          <div style={formCard}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-1)', marginBottom: 8 }}>
              {editingBrandId ? 'Edit Brand' : 'New Brand'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
              <Field label="Name *">
                <input
                  className="ui-input"
                  value={brandForm.name}
                  onChange={e => setBrandForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Bullpadel"
                />
              </Field>
              <Field label="Logo URL">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    className="ui-input"
                    style={{ flex: 1, minWidth: 0 }}
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
                  <input
                    ref={brandFileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (!file || !editingBrandId) return
                      setUploadingBrand(true)
                      setBrandMessage(null)
                      try {
                        const url = await uploadImage('brand', editingBrandId, file)
                        setBrandForm(f => ({ ...f, logo_url: url }))
                        setBrandMessage('Logo uploaded — click Save to persist')
                      } catch (err) {
                        setBrandMessage(`Error: ${err instanceof Error ? err.message : 'Upload failed'}`)
                      } finally {
                        setUploadingBrand(false)
                      }
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={!editingBrandId || uploadingBrand}
                    onClick={() => brandFileInputRef.current?.click()}
                    title={editingBrandId ? 'Upload a logo file (max 2 MB)' : 'Save the brand first, then upload'}
                  >
                    {uploadingBrand ? 'Uploading...' : 'Upload file'}
                  </Button>
                </div>
              </Field>
              <Field label="Website URL">
                <input
                  className="ui-input"
                  value={brandForm.website_url}
                  onChange={e => setBrandForm(f => ({ ...f, website_url: e.target.value }))}
                  placeholder="https://..."
                />
              </Field>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Button variant="primary" onClick={saveBrand} disabled={savingBrand}>
                {savingBrand ? 'Saving...' : 'Save'}
              </Button>
              <Button onClick={cancelBrandForm}>Cancel</Button>
              {brandMessage && (
                <span style={{ fontSize: 11, color: msgColor(brandMessage), marginLeft: 8 }}>
                  {brandMessage}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Brand message (when form is closed) */}
        {!showBrandForm && brandMessage && (
          <div style={{ fontSize: 11, color: msgColor(brandMessage), marginBottom: 8 }}>
            {brandMessage}
          </div>
        )}

        {/* Brands table */}
        {loadingBrands ? (
          <div style={{ fontSize: 11, color: 'var(--text-3)', padding: 12 }}>Loading brands...</div>
        ) : brands.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--text-3)', padding: 12 }}>No brands found. Add one to get started.</div>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th>Name</th>
                <th>Logo</th>
                <th>Website</th>
                <th style={{ textAlign: 'right' }}>Rackets</th>
                <th style={{ width: 60 }} />
              </tr>
            </thead>
            <tbody>
              {brands.map(b => (
                <tr key={b.id}>
                  <td style={{ fontWeight: 600 }}>{b.name}</td>
                  <td>
                    {b.logo_url ? (
                      <img
                        src={b.logo_url}
                        alt={b.name}
                        style={{ height: 20, objectFit: 'contain' }}
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                      />
                    ) : (
                      <span style={{ color: 'var(--text-4)', fontSize: 10 }}>--</span>
                    )}
                  </td>
                  <td>
                    {b.website_url ? (
                      <a
                        href={b.website_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: 'var(--lime-text)', fontSize: 11, textDecoration: 'none' }}
                      >
                        {b.website_url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
                      </a>
                    ) : (
                      <span style={{ color: 'var(--text-4)', fontSize: 10 }}>--</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>{b.racket_count ?? 0}</td>
                  <td style={{ textAlign: 'right' }}>
                    <Button size="sm" onClick={() => startEditBrand(b)}>Edit</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Panel>

      {/* ═══ Rackets Section ═══ */}
      <Panel
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span>Rackets</span>
            <select
              className="ui-select"
              style={{ width: 180 }}
              value={brandFilter}
              onChange={e => setBrandFilter(e.target.value)}
            >
              <option value="">All brands</option>
              {brands.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        }
        actions={
          !showRacketForm && (
            <Button variant="primary" onClick={() => { setShowRacketForm(true); setEditingRacketId(null); setRacketForm(emptyRacketForm()) }}>
              + Add Racket
            </Button>
          )
        }
      >
        {/* Racket form */}
        {showRacketForm && (
          <div style={formCard}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-1)', marginBottom: 8 }}>
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
              <Field label="Brand *">
                <select
                  className="ui-select"
                  value={racketForm.brand_id}
                  onChange={e => setRacketForm(f => ({ ...f, brand_id: e.target.value }))}
                >
                  <option value="">Select brand...</option>
                  {brands.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Model *">
                <input
                  className="ui-input"
                  value={racketForm.model}
                  onChange={e => setRacketForm(f => ({ ...f, model: e.target.value }))}
                  placeholder="e.g. Vertex 04"
                />
              </Field>
              <Field label="Year">
                <input
                  className="ui-input"
                  type="number"
                  value={racketForm.year}
                  onChange={e => setRacketForm(f => ({ ...f, year: e.target.value }))}
                  placeholder="2026"
                />
              </Field>
              <Field label="Shape">
                <select
                  className="ui-select"
                  value={racketForm.shape}
                  onChange={e => setRacketForm(f => ({ ...f, shape: e.target.value }))}
                >
                  <option value="">--</option>
                  {SHAPE_OPTIONS.map(s => (
                    <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
              <Field label="Weight (g)">
                <input
                  className="ui-input"
                  type="number"
                  value={racketForm.weight_grams}
                  onChange={e => setRacketForm(f => ({ ...f, weight_grams: e.target.value }))}
                  placeholder="360"
                />
              </Field>
              <Field label="Balance">
                <select
                  className="ui-select"
                  value={racketForm.balance}
                  onChange={e => setRacketForm(f => ({ ...f, balance: e.target.value }))}
                >
                  <option value="">--</option>
                  {BALANCE_OPTIONS.map(b => (
                    <option key={b} value={b}>{b.charAt(0).toUpperCase() + b.slice(1)}</option>
                  ))}
                </select>
              </Field>
              <Field label="Surface Material">
                <input
                  className="ui-input"
                  value={racketForm.surface_material}
                  onChange={e => setRacketForm(f => ({ ...f, surface_material: e.target.value }))}
                  placeholder="Carbon fiber"
                />
              </Field>
              <Field label="Image URL">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    className="ui-input"
                    style={{ flex: 1, minWidth: 0 }}
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
                  <input
                    ref={racketFileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (!file || !editingRacketId) return
                      setUploadingRacket(true)
                      setRacketMessage(null)
                      try {
                        const url = await uploadImage('racket', editingRacketId, file)
                        setRacketForm(f => ({ ...f, image_url: url }))
                        setRacketMessage('Image uploaded — click Save to persist')
                      } catch (err) {
                        setRacketMessage(`Error: ${err instanceof Error ? err.message : 'Upload failed'}`)
                      } finally {
                        setUploadingRacket(false)
                      }
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={!editingRacketId || uploadingRacket}
                    onClick={() => racketFileInputRef.current?.click()}
                    title={editingRacketId ? 'Upload an image file (max 2 MB)' : 'Save the racket first, then upload'}
                  >
                    {uploadingRacket ? 'Uploading...' : 'Upload file'}
                  </Button>
                </div>
              </Field>
            </div>
            <div style={{ marginBottom: 10 }}>
              <Field label="Product URL / Affiliate Link">
                <input
                  className="ui-input"
                  value={racketForm.product_url}
                  onChange={e => setRacketForm(f => ({ ...f, product_url: e.target.value }))}
                  placeholder="https://..."
                />
              </Field>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Button variant="primary" onClick={saveRacket} disabled={savingRacket}>
                {savingRacket ? 'Saving...' : 'Save'}
              </Button>
              <Button onClick={cancelRacketForm}>Cancel</Button>
              {racketMessage && (
                <span style={{ fontSize: 11, color: msgColor(racketMessage), marginLeft: 8 }}>
                  {racketMessage}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Racket message (when form is closed) */}
        {!showRacketForm && racketMessage && (
          <div style={{ fontSize: 11, color: msgColor(racketMessage), marginBottom: 8 }}>
            {racketMessage}
          </div>
        )}

        {/* Rackets table */}
        {loadingRackets ? (
          <div style={{ fontSize: 11, color: 'var(--text-3)', padding: 12 }}>Loading rackets...</div>
        ) : rackets.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--text-3)', padding: 12 }}>
            {brandFilter ? 'No rackets for this brand.' : 'No rackets found. Add one to get started.'}
          </div>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th>Brand</th>
                <th>Model</th>
                <th>Year</th>
                <th>Shape</th>
                <th style={{ textAlign: 'right' }}>Weight</th>
                <th>Image</th>
                <th style={{ textAlign: 'right' }}>Clicks</th>
                <th style={{ width: 60 }} />
              </tr>
            </thead>
            <tbody>
              {rackets.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.brand_name ?? '--'}</td>
                  <td>{r.model}</td>
                  <td>{r.year ?? '--'}</td>
                  <td>
                    {r.shape ? r.shape.charAt(0).toUpperCase() + r.shape.slice(1) : '--'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {r.weight_grams ? `${r.weight_grams}g` : '--'}
                  </td>
                  <td>
                    {r.image_url ? (
                      <img
                        src={r.image_url}
                        alt={r.model}
                        style={{ height: 30, objectFit: 'contain' }}
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                      />
                    ) : (
                      <span style={{ color: 'var(--text-4)', fontSize: 10 }}>--</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>{r.click_count ?? 0}</td>
                  <td style={{ textAlign: 'right' }}>
                    <Button size="sm" onClick={() => startEditRacket(r)}>Edit</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Panel>
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
      const res = await fetch('/api/internal/extract-racket', {
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
      marginBottom: 12, padding: 10, borderRadius: 'var(--r-sm)',
      background: 'var(--lime-bg)', border: '1px solid var(--lime-border)',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--lime-text)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
        Import from URL
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          className="ui-input"
          style={{ flex: 1, minWidth: 0 }}
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="Paste product page URL (e.g. https://www.bullpadel.com/...)"
          onKeyDown={e => { if (e.key === 'Enter') handleExtract() }}
        />
        <Button
          variant="primary"
          onClick={handleExtract}
          disabled={extracting || !url.trim()}
          style={{ whiteSpace: 'nowrap' }}
        >
          {extracting ? 'Extracting...' : 'Extract Specs'}
        </Button>
      </div>
      {message && (
        <div style={{
          fontSize: 10, marginTop: 6,
          color: message.startsWith('Error') ? 'var(--live-text)' : 'var(--lime-text)',
        }}>
          {message}
        </div>
      )}
    </div>
  )
}

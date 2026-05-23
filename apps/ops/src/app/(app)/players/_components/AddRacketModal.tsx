'use client'
// apps/ops/src/app/(app)/players/_components/AddRacketModal.tsx
// Standalone "+ Add racket" catalog modal triggered from the Players list header.
// Unlike CreateRacketModal (which runs nested inside AssignRacketModal and requires
// a brand_id from the parent), this modal owns the brand picker itself and has no
// player-assignment side effects — it only writes to the rackets/brands catalog.
//
// Flow: pick (or inline-create) brand → fill model/year → optional image →
//   POST /api/internal/rackets → optional upload + PATCH image_url → success state.

import { useState, useEffect } from 'react'
import Combobox from './Combobox'
import CreateBrandModal from './CreateBrandModal'

interface Brand {
  id: string
  name: string
  logo_url: string | null
}

interface Props {
  onClose: () => void
  onCreated?: (racket: { id: string; model: string }) => void
}

export default function AddRacketModal({ onClose, onCreated }: Props) {
  const [brands, setBrands] = useState<Brand[]>([])
  const [brandId, setBrandId] = useState<string | null>(null)
  const [model, setModel] = useState('')
  const [year, setYear] = useState<string>('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createBrandText, setCreateBrandText] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ racket: { id: string; model: string }; warning: string | null } | null>(null)

  // Fetch brands on mount.
  useEffect(() => {
    fetch('/api/internal/brands')
      .then((r) => r.json())
      .then((d: { brands?: Brand[] }) => setBrands(d.brands ?? []))
      .catch(() => setBrands([]))
  }, [])

  // Auto-close 1.5s after a clean success (no warning). On partial success the
  // operator must dismiss manually so they see the warning.
  useEffect(() => {
    if (success && !success.warning) {
      const t = setTimeout(() => {
        onCreated?.(success.racket)
        onClose()
      }, 1500)
      return () => clearTimeout(t)
    }
  }, [success, onClose, onCreated])

  async function handleSave() {
    if (!brandId) {
      setError('Pick a brand')
      return
    }
    const trimmed = model.trim()
    if (!trimmed) {
      setError('Model is required')
      return
    }
    if (year) {
      const yearNum = Number(year)
      if (!Number.isInteger(yearNum) || yearNum < 1990 || yearNum > 2030) {
        setError('Year must be between 1990 and 2030')
        return
      }
    }
    setSaving(true)
    setError(null)

    try {
      // 1. Create racket
      const createRes = await fetch('/api/internal/rackets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          brand_id: brandId,
          model: trimmed,
          year: year ? Number(year) : null,
          image_url: null,
        }),
      })
      if (!createRes.ok) {
        const d = await createRes.json().catch(() => ({}))
        setError(d.error ?? 'Create failed')
        setSaving(false)
        return
      }
      const created = (await createRes.json()) as { racket: { id: string; model: string } }
      const racket = created.racket

      // 2. (Optional) Upload image and patch image_url onto the new racket.
      //    Partial failures surface as a warning — the racket row exists either
      //    way, so we MUST NOT let the operator retry the create (would dup).
      let imageWarning: string | null = null
      if (imageFile) {
        try {
          const fd = new FormData()
          fd.append('kind', 'racket')
          fd.append('entityId', racket.id)
          fd.append('file', imageFile)
          const up = await fetch('/api/internal/upload-equipment-image', { method: 'POST', body: fd })
          if (!up.ok) {
            imageWarning = 'Racket created, image upload failed — retry from the Brands tab.'
          } else {
            const upData = (await up.json()) as { url: string }
            const patchRes = await fetch('/api/internal/rackets', {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id: racket.id, updates: { image_url: upData.url } }),
            })
            if (!patchRes.ok) {
              imageWarning = 'Racket created, image uploaded but failed to attach — retry from the Brands tab.'
            }
          }
        } catch {
          imageWarning = 'Racket created, image upload failed — retry from the Brands tab.'
        }
      }

      setSaving(false)
      setSuccess({ racket: { id: racket.id, model: racket.model }, warning: imageWarning })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed')
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg p-6 w-[440px] max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="text-base font-semibold">Add racket</div>
          <button onClick={onClose} className="text-gray-400 cursor-pointer" aria-label="Close">
            ×
          </button>
        </div>

        {success ? (
          <div className="flex flex-col gap-3">
            <div className="text-sm text-green-700">
              Racket &quot;<strong>{success.racket.model}</strong>&quot; created successfully.
            </div>
            {success.warning && (
              <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                {success.warning}
              </div>
            )}
            <div className="flex justify-end pt-2">
              <button
                onClick={() => {
                  onCreated?.(success.racket)
                  onClose()
                }}
                className="px-3 py-1.5 text-sm rounded bg-gray-900 text-white cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <div className="text-[11px] font-semibold text-gray-500 mb-1">BRAND</div>
              <Combobox
                options={brands.map((b) => ({ id: b.id, label: b.name }))}
                value={brandId}
                onChange={setBrandId}
                onCreate={(t) => setCreateBrandText(t)}
                createLabel={(t) => `+ Create brand "${t}"`}
                placeholder="Pick a brand…"
              />
            </div>

            <div>
              <div className="text-[11px] font-semibold text-gray-500 mb-1">MODEL</div>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g. Vibora Black Mamba Edition"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded"
              />
            </div>

            <div>
              <div className="text-[11px] font-semibold text-gray-500 mb-1">YEAR (optional)</div>
              <input
                type="number"
                inputMode="numeric"
                min={1990}
                max={2030}
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="e.g. 2026"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded"
              />
            </div>

            <div>
              <div className="text-[11px] font-semibold text-gray-500 mb-1">IMAGE (optional)</div>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
                className="text-xs"
              />
            </div>

            {error && <div className="text-xs text-red-600">{error}</div>}

            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded bg-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !brandId}
                className="px-3 py-1.5 text-sm rounded bg-gray-900 text-white cursor-pointer disabled:opacity-50"
              >
                {saving ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        )}

        {createBrandText !== null && (
          <CreateBrandModal
            initialName={createBrandText}
            onClose={() => setCreateBrandText(null)}
            onCreated={async (newBrand) => {
              const updated = (await fetch('/api/internal/brands')
                .then((r) => r.json())
                .catch(() => ({ brands: [] }))) as { brands?: Brand[] }
              setBrands(updated.brands ?? [])
              setBrandId(newBrand.id)
              setCreateBrandText(null)
            }}
          />
        )}
      </div>
    </div>
  )
}

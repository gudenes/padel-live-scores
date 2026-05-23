'use client'
// apps/ops/src/app/(app)/players/_components/AddRacketModal.tsx
// Standalone "+ Add racket" catalog modal triggered from the Players list header.
// Unlike CreateRacketModal (which runs nested inside AssignRacketModal and requires
// a brand_id from the parent), this modal owns the brand picker itself and has no
// player-assignment side effects — it only writes to the rackets/brands catalog.
//
// Flow: pick (or inline-create) brand → fill model/year/shape/weight/balance/etc
// → (optional) image → POST /api/internal/rackets → optional upload + PATCH
// image_url → success state.
//
// The form fields + the URL-paste AI extract affordance live in the shared
// RacketFieldsForm; this modal only owns the brand picker.

import { useState, useEffect } from 'react'
import Combobox from './Combobox'
import CreateBrandModal from './CreateBrandModal'
import RacketFieldsForm, {
  emptyRacketFields,
  validateRacketFields,
  racketFieldsToCreatePayload,
  type RacketFieldsValue,
} from './RacketFieldsForm'

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
  const [fields, setFields] = useState<RacketFieldsValue>(emptyRacketFields)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [brandHint, setBrandHint] = useState<string | null>(null)
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

  // Try to auto-select the brand when AI extract returns a brand name hint.
  function handleBrandSuggest(name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    const norm = trimmed.toLowerCase()
    const match = brands.find((b) => b.name.toLowerCase() === norm)
    if (match) {
      setBrandId(match.id)
      setBrandHint(null)
    } else {
      setBrandHint(trimmed)
    }
  }

  async function handleSave() {
    if (!brandId) {
      setError('Pick a brand')
      return
    }
    const validation = validateRacketFields(fields)
    if (validation) {
      setError(validation)
      return
    }
    setSaving(true)
    setError(null)

    try {
      // 1. Create racket — POST accepts all 5 new fields directly.
      const createRes = await fetch('/api/internal/rackets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(racketFieldsToCreatePayload(fields, brandId)),
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
      if (fields.imageFile) {
        try {
          const fd = new FormData()
          fd.append('kind', 'racket')
          fd.append('entityId', racket.id)
          fd.append('file', fields.imageFile)
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
        className="bg-white rounded-lg p-6 w-[480px] max-h-[90vh] overflow-auto"
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
              <div className="text-[11px] font-semibold text-gray-500 mb-1">BRAND *</div>
              <Combobox
                options={brands.map((b) => ({ id: b.id, label: b.name }))}
                value={brandId}
                onChange={(id) => {
                  setBrandId(id)
                  if (id) setBrandHint(null)
                }}
                onCreate={(t) => setCreateBrandText(t)}
                createLabel={(t) => `+ Create brand "${t}"`}
                placeholder="Pick a brand…"
              />
              {brandHint && !brandId && (
                <div className="mt-1.5 text-[11px] text-amber-700">
                  Brand &quot;{brandHint}&quot; not in catalog — create it via the picker above.
                </div>
              )}
            </div>

            <RacketFieldsForm
              value={fields}
              onChange={setFields}
              onBrandSuggest={handleBrandSuggest}
              disabled={saving}
            />

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
              setBrandHint(null)
              setCreateBrandText(null)
            }}
          />
        )}
      </div>
    </div>
  )
}

'use client'
// apps/ops/src/app/(app)/players/_components/CreateRacketModal.tsx
// Inline racket creation modal triggered from AssignRacketModal's racket combobox.
// Flow: create racket → (optional) upload image with new racket id → PATCH image_url.
// Mirrors CreateBrandModal's structure — the upload route requires a racket UUID,
// so the create-then-upload order is mandatory.

import { useState } from 'react'

interface Props {
  initialModel: string
  brandId: string
  onClose: () => void
  onCreated: (racket: { id: string; model: string }) => void
}

export default function CreateRacketModal({ initialModel, brandId, onClose, onCreated }: Props) {
  const [model, setModel] = useState(initialModel)
  const [year, setYear] = useState<string>('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [partialSuccess, setPartialSuccess] = useState<{ racket: { id: string; model: string }; warning: string } | null>(null)

  async function handleSave() {
    const trimmed = model.trim()
    if (!trimmed) {
      setError('Model is required')
      return
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
      //    On partial failure we keep the modal open so the operator knows the
      //    image didn't land — the racket row itself exists either way, so we
      //    must NOT let them retry the create (would dup the racket).
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

      if (imageWarning) {
        setPartialSuccess({ racket: { id: racket.id, model: racket.model }, warning: imageWarning })
      } else {
        onCreated({ id: racket.id, model: racket.model })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed')
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center z-[60]"
      onClick={onClose}
    >
      <div className="bg-white rounded-lg p-6 w-96" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="text-base font-semibold">Create racket</div>
          <button onClick={onClose} className="text-gray-400 cursor-pointer" aria-label="Close">
            ×
          </button>
        </div>
        {partialSuccess ? (
          <div className="flex flex-col gap-3">
            <div className="text-sm text-green-700">
              Racket &quot;<strong>{partialSuccess.racket.model}</strong>&quot; created successfully.
            </div>
            <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              {partialSuccess.warning}
            </div>
            <div className="flex justify-end pt-2">
              <button
                onClick={() => onCreated(partialSuccess.racket)}
                className="px-3 py-1.5 text-sm rounded bg-gray-900 text-white cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <div className="text-[11px] font-semibold text-gray-500 mb-1">MODEL</div>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded"
                autoFocus
              />
            </div>
            <div>
              <div className="text-[11px] font-semibold text-gray-500 mb-1">YEAR (optional)</div>
              <input
                type="number"
                inputMode="numeric"
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
                disabled={saving}
                className="px-3 py-1.5 text-sm rounded bg-gray-900 text-white cursor-pointer disabled:opacity-50"
              >
                {saving ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

'use client'
// apps/ops/src/app/(app)/players/_components/CreateBrandModal.tsx
// Inline brand creation modal triggered from AssignRacketModal's brand combobox.
// Flow: create brand → (optional) upload logo with new brand id → PATCH logo_url.
// The upload route requires a brand UUID, so the create-then-upload order is mandatory.

import { useState } from 'react'

interface Props {
  initialName: string
  onClose: () => void
  onCreated: (brand: { id: string; name: string }) => void
}

export default function CreateBrandModal({ initialName, onClose, onCreated }: Props) {
  const [name, setName] = useState(initialName)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [partialSuccess, setPartialSuccess] = useState<{ brand: { id: string; name: string }; warning: string } | null>(null)

  async function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Name is required')
      return
    }
    setSaving(true)
    setError(null)

    try {
      // 1. Create brand
      const createRes = await fetch('/api/internal/brands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!createRes.ok) {
        const d = await createRes.json().catch(() => ({}))
        setError(d.error ?? 'Create failed')
        setSaving(false)
        return
      }
      const created = (await createRes.json()) as { brand: { id: string; name: string } }
      const brand = created.brand

      // 2. (Optional) Upload logo and patch logo_url onto the new brand.
      //    On partial failure we keep the modal open so the operator knows the
      //    logo didn't land — the brand row itself exists either way, so we
      //    must NOT let them retry the create (would dup the brand).
      let logoWarning: string | null = null
      if (logoFile) {
        try {
          const fd = new FormData()
          fd.append('kind', 'brand')
          fd.append('entityId', brand.id)
          fd.append('file', logoFile)
          const up = await fetch('/api/internal/upload-equipment-image', { method: 'POST', body: fd })
          if (!up.ok) {
            logoWarning = 'Logo upload failed — you can retry from the Brands tab.'
          } else {
            const upData = (await up.json()) as { url: string }
            const patchRes = await fetch('/api/internal/brands', {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id: brand.id, updates: { logo_url: upData.url } }),
            })
            if (!patchRes.ok) {
              logoWarning = 'Logo uploaded but failed to attach to the brand — retry from the Brands tab.'
            }
          }
        } catch {
          logoWarning = 'Logo upload failed — you can retry from the Brands tab.'
        }
      }

      setSaving(false)

      if (logoWarning) {
        setPartialSuccess({ brand, warning: logoWarning })
      } else {
        onCreated({ id: brand.id, name: brand.name })
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
          <div className="text-base font-semibold">Create brand</div>
          <button onClick={onClose} className="text-gray-400 cursor-pointer" aria-label="Close">
            ×
          </button>
        </div>
        {partialSuccess ? (
          <div className="flex flex-col gap-3">
            <div className="text-sm text-green-700">
              Brand &quot;<strong>{partialSuccess.brand.name}</strong>&quot; created successfully.
            </div>
            <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              {partialSuccess.warning}
            </div>
            <div className="flex justify-end pt-2">
              <button
                onClick={() => onCreated(partialSuccess.brand)}
                className="px-3 py-1.5 text-sm rounded bg-gray-900 text-white cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <div className="text-[11px] font-semibold text-gray-500 mb-1">NAME</div>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded"
                autoFocus
              />
            </div>
            <div>
              <div className="text-[11px] font-semibold text-gray-500 mb-1">LOGO (optional)</div>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
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

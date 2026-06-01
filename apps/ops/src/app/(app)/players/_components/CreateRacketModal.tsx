'use client'
// apps/ops/src/app/(app)/players/_components/CreateRacketModal.tsx
// Inline racket creation modal triggered from AssignRacketModal's racket combobox.
// Flow: create racket → (optional) upload image with new racket id → PATCH image_url.
// Mirrors CreateBrandModal's structure — the upload route requires a racket UUID,
// so the create-then-upload order is mandatory.
//
// The form fields + the URL-paste AI extract affordance live in the shared
// RacketFieldsForm. Brand is fixed by the parent so we don't expose a picker
// and we ignore any brand hint returned by AI extract.

import { useState } from 'react'
import RacketFieldsForm, {
  emptyRacketFields,
  validateRacketFields,
  racketFieldsToCreatePayload,
  type RacketFieldsValue,
} from './RacketFieldsForm'
import { Button } from '@/components/ui'

interface Props {
  initialModel: string
  brandId: string
  onClose: () => void
  onCreated: (racket: { id: string; model: string }) => void
}

// When "Remove background" was toggled on, fields.transparentDataUrl holds the
// processed PNG as a base64 data URL. The upload-equipment-image route wants a
// File, so we convert here. Falls back to the raw upload (or null).
async function resolveEffectiveImageFile(fields: RacketFieldsValue): Promise<File | null> {
  if (fields.transparentDataUrl) {
    const res = await fetch(fields.transparentDataUrl)
    const blob = await res.blob()
    return new File([blob], 'racket-transparent.png', { type: 'image/png' })
  }
  return fields.imageFile
}

export default function CreateRacketModal({ initialModel, brandId, onClose, onCreated }: Props) {
  const [fields, setFields] = useState<RacketFieldsValue>({ ...emptyRacketFields, model: initialModel })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [partialSuccess, setPartialSuccess] = useState<{ racket: { id: string; model: string }; warning: string } | null>(null)

  async function handleSave() {
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
      //    On partial failure we keep the modal open so the operator knows the
      //    image didn't land — the racket row itself exists either way, so we
      //    must NOT let them retry the create (would dup the racket).
      //    If "Remove background" was toggled on, fields.transparentDataUrl
      //    holds the processed PNG — convert to a File and upload it instead.
      let imageWarning: string | null = null
      const effectiveImageFile = await resolveEffectiveImageFile(fields)
      if (effectiveImageFile) {
        try {
          const fd = new FormData()
          fd.append('kind', 'racket')
          fd.append('entityId', racket.id)
          fd.append('file', effectiveImageFile)
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
      className="fixed inset-0 flex items-center justify-center z-[60]"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="rounded-lg p-6 w-[460px] max-h-[90vh] overflow-auto"
        style={{ background: 'var(--bg-surface)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="text-base font-semibold" style={{ color: 'var(--text-1)' }}>Create racket</div>
          <button onClick={onClose} className="cursor-pointer" style={{ background: 'none', border: 'none', color: 'var(--text-3)', fontSize: 18 }} aria-label="Close">
            ×
          </button>
        </div>
        {partialSuccess ? (
          <div className="flex flex-col gap-3">
            <div className="text-sm" style={{ color: 'var(--lime-text)' }}>
              Racket &quot;<strong>{partialSuccess.racket.model}</strong>&quot; created successfully.
            </div>
            <div
              className="text-sm border rounded px-3 py-2"
              style={{ color: 'var(--orange-text)', background: 'var(--orange-bg)', borderColor: 'var(--orange-border)' }}
            >
              {partialSuccess.warning}
            </div>
            <div className="flex justify-end pt-2">
              <Button variant="primary" onClick={() => onCreated(partialSuccess.racket)}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <RacketFieldsForm value={fields} onChange={setFields} disabled={saving} />
            {error && <div className="text-xs" style={{ color: 'var(--live-text)' }}>{error}</div>}
            <div className="flex gap-2 justify-end pt-2">
              <Button onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

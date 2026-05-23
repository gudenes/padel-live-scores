'use client'
// apps/ops/src/app/(app)/players/_components/AddRacketModal.tsx
// Standalone "+ Add racket" 2-step flow triggered from the Players list header.
//
// Step 1 — Racket details (catalog write):
//   - Brand combobox + RacketFieldsForm
//   - Footer:
//       [Cancel] [Save to catalog only] [Continue to assign player →]
//
// Step 2 — Optional player assignment:
//   - PlayerPicker + started_at + notes on the left
//   - PlaysWithPreview on the right (mirrors the consumer "Plays with" widget,
//     updates live as fields change)
//   - Footer: [← Back] [Cancel] [Save & assign / Save to catalog only]
//
// Save flow:
//   1. POST /api/internal/rackets  → creates the racket row
//   2. If imageFile: upload + PATCH image_url (partial failure → warning, racket
//      row already exists so we MUST NOT let the operator retry the create)
//   3. If a player is selected: POST /api/internal/player-equipment
//      The route auto-ends any existing active assignment for that player
//      (B4 behaviour). On guard-rejection (existing assignment started AFTER
//      the chosen started_at) we surface a warning — racket is created either
//      way, operator can assign from the drawer.
//   4. Success state with appropriate copy; auto-close after 1.5s if no warning.
//
// Unlike CreateRacketModal (which runs nested inside AssignRacketModal and
// requires a brand_id from the parent), this modal owns the brand picker
// itself and now optionally writes a player_equipment row in the same flow.

import { useState, useEffect, useMemo } from 'react'
import Combobox from './Combobox'
import CreateBrandModal from './CreateBrandModal'
import RacketFieldsForm, {
  emptyRacketFields,
  validateRacketFields,
  racketFieldsToCreatePayload,
  type RacketFieldsValue,
} from './RacketFieldsForm'
import PlayerPicker, { type PlayerLite } from './PlayerPicker'
import PlaysWithPreview from './PlaysWithPreview'

interface Brand {
  id: string
  name: string
  logo_url: string | null
}

interface Props {
  onClose: () => void
  onCreated?: (racket: { id: string; model: string }) => void
}

interface SuccessState {
  racket: { id: string; model: string }
  assigned: PlayerLite | null
  imageWarning: string | null
  assignmentWarning: string | null
}

export default function AddRacketModal({ onClose, onCreated }: Props) {
  // ── Step 1 state ───────────────────────────────────────────
  const [step, setStep] = useState<1 | 2>(1)
  const [brands, setBrands] = useState<Brand[]>([])
  const [brandId, setBrandId] = useState<string | null>(null)
  const [fields, setFields] = useState<RacketFieldsValue>(emptyRacketFields)
  const [brandHint, setBrandHint] = useState<string | null>(null)
  const [createBrandText, setCreateBrandText] = useState<string | null>(null)

  // ── Step 2 state ───────────────────────────────────────────
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerLite | null>(null)
  const [startedAt, setStartedAt] = useState<string>(() =>
    new Date().toISOString().slice(0, 10),
  )
  const [notes, setNotes] = useState<string>('')

  // ── Shared state ───────────────────────────────────────────
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<SuccessState | null>(null)

  // Fetch brands on mount.
  useEffect(() => {
    fetch('/api/internal/brands')
      .then((r) => r.json())
      .then((d: { brands?: Brand[] }) => setBrands(d.brands ?? []))
      .catch(() => setBrands([]))
  }, [])

  // Auto-close 1.5s after a clean success (no warnings).
  useEffect(() => {
    if (success && !success.imageWarning && !success.assignmentWarning) {
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

  // Step 1 → step 2 gate: brand + valid fields required.
  function canAdvanceToStep2(): boolean {
    if (!brandId) return false
    if (validateRacketFields(fields)) return false
    return true
  }

  function handleAdvance() {
    if (!brandId) {
      setError('Pick a brand')
      return
    }
    const validation = validateRacketFields(fields)
    if (validation) {
      setError(validation)
      return
    }
    setError(null)
    setStep(2)
  }

  // Pre-compute the preview shape from the current form + brand state.
  const previewBrand = brandId
    ? brands.find((b) => b.id === brandId) ?? null
    : brandHint
      ? { name: brandHint, logo_url: null, id: '' }
      : null

  // Memoize the blob URL so a new one isn't created on every render. The cleanup
  // effect below revokes the old URL when the file changes / on unmount.
  const imagePreviewUrl = useMemo(
    () => (fields.imageFile ? URL.createObjectURL(fields.imageFile) : null),
    [fields.imageFile],
  )
  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl)
    }
  }, [imagePreviewUrl])

  const previewRacket = {
    model: fields.model || null,
    year: fields.year ? Number(fields.year) : null,
    shape: fields.shape || null,
    weight_grams: fields.weightGrams ? Number(fields.weightGrams) : null,
    balance: fields.balance || null,
    image_url: imagePreviewUrl,
    product_url: fields.productUrl || null,
  }

  // ── Save flow ──────────────────────────────────────────────
  // `assignPlayer` is null when the operator clicks "Save to catalog only" from
  // either step's footer. When non-null, we additionally POST to
  // /api/internal/player-equipment after the racket row exists.
  async function performSave(assignPlayer: PlayerLite | null) {
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
      // 1. Create racket
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

      // 2. (Optional) Upload image + PATCH image_url. Partial failures surface
      //    as a warning — the racket row exists either way.
      let imageWarning: string | null = null
      if (fields.imageFile) {
        try {
          const fd = new FormData()
          fd.append('kind', 'racket')
          fd.append('entityId', racket.id)
          fd.append('file', fields.imageFile)
          const up = await fetch('/api/internal/upload-equipment-image', {
            method: 'POST',
            body: fd,
          })
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
              imageWarning =
                'Racket created, image uploaded but failed to attach — retry from the Brands tab.'
            }
          }
        } catch {
          imageWarning = 'Racket created, image upload failed — retry from the Brands tab.'
        }
      }

      // 3. (Optional) Assignment write. If this fails (e.g. backdate guard),
      //    we keep the racket and surface a warning so the operator can finish
      //    the assignment from the player drawer.
      let assignmentWarning: string | null = null
      if (assignPlayer) {
        try {
          const assignRes = await fetch('/api/internal/player-equipment', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              player_id: assignPlayer.id,
              racket_id: racket.id,
              started_at: startedAt || undefined,
              notes: notes.trim() || undefined,
            }),
          })
          if (!assignRes.ok) {
            const d = (await assignRes.json().catch(() => ({}))) as { error?: string }
            assignmentWarning = `Racket created — assignment failed: ${d.error ?? 'unknown error'}. Try assigning from the drawer.`
          }
        } catch (err) {
          assignmentWarning = `Racket created — assignment failed: ${
            err instanceof Error ? err.message : 'network error'
          }. Try assigning from the drawer.`
        }
      }

      setSaving(false)
      setSuccess({
        racket: { id: racket.id, model: racket.model },
        assigned: assignmentWarning ? null : assignPlayer,
        imageWarning,
        assignmentWarning,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed')
      setSaving(false)
    }
  }

  // ── Render helpers ─────────────────────────────────────────
  const modalWidth = step === 2 ? 'w-[760px]' : 'w-[480px]'

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className={`bg-white rounded-lg p-6 ${modalWidth} max-w-[95vw] max-h-[90vh] overflow-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="text-base font-semibold">
            {success
              ? 'Done'
              : step === 1
                ? 'Add racket'
                : 'Add racket · Assign player (optional)'}
          </div>
          <button onClick={onClose} className="text-gray-400 cursor-pointer" aria-label="Close">
            ×
          </button>
        </div>

        {/* Body */}
        {success ? (
          <SuccessView
            success={success}
            onClose={() => {
              onCreated?.(success.racket)
              onClose()
            }}
          />
        ) : step === 1 ? (
          <Step1View
            brands={brands}
            brandId={brandId}
            onBrandIdChange={(id) => {
              setBrandId(id)
              if (id) setBrandHint(null)
            }}
            onCreateBrand={(t) => setCreateBrandText(t)}
            brandHint={brandHint}
            fields={fields}
            onFieldsChange={setFields}
            onBrandSuggest={handleBrandSuggest}
            saving={saving}
            error={error}
            onCancel={onClose}
            onSaveCatalogOnly={() => performSave(null)}
            onAdvance={handleAdvance}
            canAdvance={canAdvanceToStep2()}
          />
        ) : (
          <Step2View
            selectedPlayer={selectedPlayer}
            onSelectedPlayerChange={setSelectedPlayer}
            startedAt={startedAt}
            onStartedAtChange={setStartedAt}
            notes={notes}
            onNotesChange={setNotes}
            previewBrand={previewBrand}
            previewRacket={previewRacket}
            saving={saving}
            error={error}
            onBack={() => {
              setError(null)
              setStep(1)
            }}
            onCancel={onClose}
            onSave={() => performSave(selectedPlayer)}
          />
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

// ── Step 1 view ─────────────────────────────────────────────
function Step1View(props: {
  brands: Brand[]
  brandId: string | null
  onBrandIdChange: (id: string | null) => void
  onCreateBrand: (text: string) => void
  brandHint: string | null
  fields: RacketFieldsValue
  onFieldsChange: (next: RacketFieldsValue) => void
  onBrandSuggest: (name: string) => void
  saving: boolean
  error: string | null
  onCancel: () => void
  onSaveCatalogOnly: () => void
  onAdvance: () => void
  canAdvance: boolean
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-[11px] font-semibold text-gray-500 mb-1">BRAND *</div>
        <Combobox
          options={props.brands.map((b) => ({ id: b.id, label: b.name }))}
          value={props.brandId}
          onChange={props.onBrandIdChange}
          onCreate={props.onCreateBrand}
          createLabel={(t) => `+ Create brand "${t}"`}
          placeholder="Pick a brand…"
        />
        {props.brandHint && !props.brandId && (
          <div className="mt-1.5 text-[11px] text-amber-700">
            Brand &quot;{props.brandHint}&quot; not in catalog — create it via the picker above.
          </div>
        )}
      </div>

      <RacketFieldsForm
        value={props.fields}
        onChange={props.onFieldsChange}
        onBrandSuggest={props.onBrandSuggest}
        disabled={props.saving}
      />

      {props.error && <div className="text-xs text-red-600">{props.error}</div>}

      <div className="flex gap-2 justify-end pt-2 flex-wrap">
        <button
          onClick={props.onCancel}
          disabled={props.saving}
          className="px-3 py-1.5 text-sm border border-gray-200 rounded bg-white cursor-pointer disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={props.onSaveCatalogOnly}
          disabled={props.saving || !props.canAdvance}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded bg-white text-gray-900 cursor-pointer disabled:opacity-50"
        >
          {props.saving ? 'Saving…' : 'Save to catalog only'}
        </button>
        <button
          onClick={props.onAdvance}
          disabled={props.saving || !props.canAdvance}
          className="px-3 py-1.5 text-sm rounded bg-gray-900 text-white cursor-pointer disabled:opacity-50"
        >
          Continue to assign player →
        </button>
      </div>
    </div>
  )
}

// ── Step 2 view ─────────────────────────────────────────────
function Step2View(props: {
  selectedPlayer: PlayerLite | null
  onSelectedPlayerChange: (p: PlayerLite | null) => void
  startedAt: string
  onStartedAtChange: (s: string) => void
  notes: string
  onNotesChange: (s: string) => void
  previewBrand: { name: string | null; logo_url: string | null } | null
  previewRacket: {
    model: string | null
    year: number | null
    shape: string | null
    weight_grams: number | null
    balance: string | null
    image_url: string | null
    product_url: string | null
  }
  saving: boolean
  error: string | null
  onBack: () => void
  onCancel: () => void
  onSave: () => void
}) {
  const playerName = props.selectedPlayer
    ? props.selectedPlayer.display_name?.trim() || props.selectedPlayer.name
    : null

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-sm font-semibold text-gray-900">Assign to a player</div>
        <div className="text-xs text-gray-500">
          Optional — leave blank to save catalog-only.
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Left column: picker + assignment details */}
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-[11px] font-semibold text-gray-500 mb-1">PLAYER</div>
            <PlayerPicker
              value={props.selectedPlayer}
              onChange={props.onSelectedPlayerChange}
              disabled={props.saving}
            />
          </div>

          <div>
            <div className="text-[11px] font-semibold text-gray-500 mb-1">STARTED AT</div>
            <input
              type="date"
              value={props.startedAt}
              onChange={(e) => props.onStartedAtChange(e.target.value)}
              className="w-full rounded border border-gray-200 px-3 py-2 text-sm"
              disabled={props.saving || !props.selectedPlayer}
            />
            {!props.selectedPlayer && (
              <div className="mt-1 text-[10px] text-gray-400">
                Pick a player to enable assignment fields.
              </div>
            )}
          </div>

          <div>
            <div className="text-[11px] font-semibold text-gray-500 mb-1">NOTES (optional)</div>
            <textarea
              value={props.notes}
              onChange={(e) => props.onNotesChange(e.target.value)}
              rows={3}
              placeholder="Confirmed via Instagram, etc."
              className="w-full rounded border border-gray-200 px-3 py-2 text-sm resize-y"
              disabled={props.saving || !props.selectedPlayer}
            />
          </div>
        </div>

        {/* Right column: live preview */}
        <div>
          <PlaysWithPreview
            brand={props.previewBrand}
            racket={props.previewRacket}
            playerName={playerName}
          />
        </div>
      </div>

      {props.error && <div className="text-xs text-red-600">{props.error}</div>}

      <div className="flex gap-2 justify-between pt-2 flex-wrap">
        <button
          onClick={props.onBack}
          disabled={props.saving}
          className="px-3 py-1.5 text-sm border border-gray-200 rounded bg-white cursor-pointer disabled:opacity-50"
        >
          ← Back
        </button>
        <div className="flex gap-2">
          <button
            onClick={props.onCancel}
            disabled={props.saving}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded bg-white cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={props.onSave}
            disabled={props.saving}
            className="px-3 py-1.5 text-sm rounded bg-gray-900 text-white cursor-pointer disabled:opacity-50"
          >
            {props.saving
              ? 'Saving…'
              : props.selectedPlayer
                ? `Save & assign to ${playerName}`
                : 'Save to catalog only'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Success view ────────────────────────────────────────────
function SuccessView({
  success,
  onClose,
}: {
  success: SuccessState
  onClose: () => void
}) {
  const assignedName = success.assigned
    ? success.assigned.display_name?.trim() || success.assigned.name
    : null

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm text-green-700">
        {assignedName ? (
          <>
            Racket &quot;<strong>{success.racket.model}</strong>&quot; created and assigned to{' '}
            <strong>{assignedName}</strong>.
          </>
        ) : (
          <>
            Racket &quot;<strong>{success.racket.model}</strong>&quot; created successfully.
          </>
        )}
      </div>
      {success.imageWarning && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          {success.imageWarning}
        </div>
      )}
      {success.assignmentWarning && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          {success.assignmentWarning}
        </div>
      )}
      <div className="flex justify-end pt-2">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-sm rounded bg-gray-900 text-white cursor-pointer"
        >
          Close
        </button>
      </div>
    </div>
  )
}

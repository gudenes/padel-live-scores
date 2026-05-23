'use client'
// apps/ops/src/app/(app)/players/_components/RacketFieldsForm.tsx
// Shared racket-creation form used by AddRacketModal (Players list header,
// standalone) and CreateRacketModal (inline create from AssignRacketModal).
//
// Renders the full BrandsTab field set:
//   - "Paste product URL → AI extract" affordance at the top
//   - Model* / Year / Shape / Weight + Balance / Surface material / Image / Product URL
//
// Field vocabularies match BrandsTab's SHAPE_OPTIONS / BALANCE_OPTIONS so that
// rows created from either side render identically in the catalog table.
//
// AI extract may return a brand hint as a free-form name string. AddRacketModal
// resolves it against its brand list via `onBrandSuggest`; CreateRacketModal
// ignores it (brand is fixed by the parent AssignRacketModal).

import { useEffect, useMemo, useState } from 'react'

// Match BrandsTab.tsx (SHAPE_OPTIONS, BALANCE_OPTIONS) so dropdowns are uniform.
export const SHAPE_OPTIONS = ['diamond', 'round', 'teardrop', 'hybrid'] as const
export const BALANCE_OPTIONS = ['low', 'medium', 'high'] as const

export type RacketShape = (typeof SHAPE_OPTIONS)[number] | ''
export type RacketBalance = (typeof BALANCE_OPTIONS)[number] | ''

export interface RacketFieldsValue {
  model: string
  year: string
  shape: RacketShape
  weightGrams: string
  balance: RacketBalance
  surfaceMaterial: string
  productUrl: string
  imageFile: File | null
  /** Image URL returned by AI extract (remote). The toggle uses it to POST to
   *  the background-removal endpoint when no local file is set. */
  extractedImageUrl: string | null
  /** PNG data URL produced by /api/internal/process-racket-image. When set,
   *  the preview displays this image and AddRacketModal converts it to a File
   *  before the upload step. */
  transparentDataUrl: string | null
}

export const emptyRacketFields: RacketFieldsValue = {
  model: '',
  year: '',
  shape: '',
  weightGrams: '',
  balance: '',
  surfaceMaterial: '',
  productUrl: '',
  imageFile: null,
  extractedImageUrl: null,
  transparentDataUrl: null,
}

interface ExtractSpecs {
  brand: string | null
  model: string | null
  year: number | null
  shape: string | null
  weight_grams: number | null
  balance: string | null
  image_url: string | null
  product_url: string | null
  surface_material: string | null
}

interface Props {
  value: RacketFieldsValue
  onChange: (next: RacketFieldsValue) => void
  /** Called when AI extract returns a brand hint. AddRacketModal uses this to
   *  auto-select a matching brand. CreateRacketModal omits it (brand is fixed). */
  onBrandSuggest?: (brandName: string) => void
  disabled?: boolean
}

export default function RacketFieldsForm({ value, onChange, onBrandSuggest, disabled }: Props) {
  const [extractUrl, setExtractUrl] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [extractMessage, setExtractMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [processingTransparency, setProcessingTransparency] = useState(false)
  const [transparencyError, setTransparencyError] = useState<string | null>(null)

  function patch(partial: Partial<RacketFieldsValue>) {
    onChange({ ...value, ...partial })
  }

  // Local blob URL for the uploaded file. Memoized + revoked to avoid leaks
  // when the operator picks a new file mid-flow.
  const localBlobUrl = useMemo(
    () => (value.imageFile ? URL.createObjectURL(value.imageFile) : null),
    [value.imageFile],
  )
  useEffect(() => {
    return () => {
      if (localBlobUrl) URL.revokeObjectURL(localBlobUrl)
    }
  }, [localBlobUrl])

  // Preview precedence: processed transparent PNG → local upload → extracted URL.
  const previewSrc = value.transparentDataUrl ?? localBlobUrl ?? value.extractedImageUrl
  const hasProcessableImage = value.imageFile != null || (value.extractedImageUrl != null && value.extractedImageUrl.length > 0)

  async function handleRemoveBackground() {
    setTransparencyError(null)
    // Toggle off → revert to original image. Operator can re-click to reprocess.
    if (value.transparentDataUrl) {
      patch({ transparentDataUrl: null })
      return
    }
    setProcessingTransparency(true)
    try {
      let res: Response
      if (value.imageFile) {
        const fd = new FormData()
        fd.append('file', value.imageFile)
        res = await fetch('/api/internal/process-racket-image', { method: 'POST', body: fd })
      } else if (value.extractedImageUrl) {
        res = await fetch('/api/internal/process-racket-image', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: value.extractedImageUrl }),
        })
      } else {
        setTransparencyError('No image to process yet.')
        setProcessingTransparency(false)
        return
      }
      const json = (await res.json().catch(() => ({}))) as { dataUrl?: string; error?: string }
      if (!res.ok || !json.dataUrl) {
        setTransparencyError(json.error ?? `Processing failed (${res.status})`)
        setProcessingTransparency(false)
        return
      }
      patch({ transparentDataUrl: json.dataUrl })
    } catch (err) {
      setTransparencyError(err instanceof Error ? err.message : 'Processing failed')
    } finally {
      setProcessingTransparency(false)
    }
  }

  async function handleExtract() {
    const trimmed = extractUrl.trim()
    if (!trimmed) {
      setExtractMessage({ kind: 'error', text: 'Paste a product URL first.' })
      return
    }
    if (!trimmed.startsWith('http')) {
      setExtractMessage({ kind: 'error', text: 'URL must start with http(s)://' })
      return
    }
    setExtracting(true)
    setExtractMessage(null)
    try {
      const res = await fetch('/api/internal/extract-racket', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      })
      const json = (await res.json().catch(() => ({}))) as { specs?: ExtractSpecs; error?: string }
      if (!res.ok || !json.specs) {
        setExtractMessage({ kind: 'error', text: json.error ?? `Extract failed (${res.status})` })
        setExtracting(false)
        return
      }
      const specs = json.specs
      // Spread into form. Year/weight come back as numbers — coerce to string for inputs.
      // We capture `image_url` into `extractedImageUrl` so the preview can render
      // the remote URL and the "Remove background" toggle has something to send
      // to the processing endpoint without forcing the operator to download +
      // re-upload the file manually.
      onChange({
        ...value,
        model: specs.model ?? value.model,
        year: specs.year != null ? String(specs.year) : value.year,
        shape: isShape(specs.shape) ? specs.shape : value.shape,
        weightGrams: specs.weight_grams != null ? String(specs.weight_grams) : value.weightGrams,
        balance: isBalance(specs.balance) ? specs.balance : value.balance,
        surfaceMaterial: specs.surface_material ?? value.surfaceMaterial,
        productUrl: specs.product_url ?? trimmed,
        extractedImageUrl: specs.image_url ?? value.extractedImageUrl,
        // Re-extract invalidates any previously-processed transparent image.
        transparentDataUrl: null,
      })
      if (specs.brand && onBrandSuggest) {
        onBrandSuggest(specs.brand)
      }
      setExtractMessage({ kind: 'ok', text: 'Specs filled — review and save.' })
    } catch (err) {
      setExtractMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Extract failed' })
    } finally {
      setExtracting(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* AI extract row */}
      <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2.5">
        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-blue-700">
          Paste product URL to auto-fill
        </div>
        <div className="flex gap-2">
          <input
            type="url"
            value={extractUrl}
            onChange={(e) => setExtractUrl(e.target.value)}
            placeholder="https://bullpadel.com/..."
            className="flex-1 rounded border border-blue-200 bg-white px-2 py-1.5 text-xs"
            disabled={disabled || extracting}
          />
          <button
            type="button"
            onClick={handleExtract}
            disabled={disabled || extracting || !extractUrl.trim()}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 cursor-pointer"
          >
            {extracting ? 'Extracting…' : 'Extract'}
          </button>
        </div>
        {extractMessage && (
          <div
            className={`mt-1.5 text-[11px] ${
              extractMessage.kind === 'error' ? 'text-red-600' : 'text-green-700'
            }`}
          >
            {extractMessage.text}
          </div>
        )}
      </div>

      {/* Row: Model (2/3) + Year (1/3) */}
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <div className="mb-1 text-[11px] font-semibold text-gray-500">MODEL *</div>
          <input
            type="text"
            value={value.model}
            onChange={(e) => patch({ model: e.target.value })}
            placeholder="e.g. Vertex 04"
            className="w-full rounded border border-gray-200 px-3 py-2 text-sm"
            disabled={disabled}
          />
        </div>
        <div>
          <div className="mb-1 text-[11px] font-semibold text-gray-500">YEAR</div>
          <input
            type="number"
            inputMode="numeric"
            min={1990}
            max={2030}
            value={value.year}
            onChange={(e) => patch({ year: e.target.value })}
            placeholder="2026"
            className="w-full rounded border border-gray-200 px-3 py-2 text-sm"
            disabled={disabled}
          />
        </div>
      </div>

      {/* Row: Shape + Weight */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="mb-1 text-[11px] font-semibold text-gray-500">SHAPE</div>
          <select
            value={value.shape}
            onChange={(e) => patch({ shape: e.target.value as RacketShape })}
            className="w-full rounded border border-gray-200 px-3 py-2 text-sm"
            disabled={disabled}
          >
            <option value="">--</option>
            {SHAPE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="mb-1 text-[11px] font-semibold text-gray-500">WEIGHT (g)</div>
          <input
            type="number"
            inputMode="numeric"
            min={300}
            max={450}
            value={value.weightGrams}
            onChange={(e) => patch({ weightGrams: e.target.value })}
            placeholder="360"
            className="w-full rounded border border-gray-200 px-3 py-2 text-sm"
            disabled={disabled}
          />
        </div>
      </div>

      {/* Row: Balance + Surface material */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="mb-1 text-[11px] font-semibold text-gray-500">BALANCE</div>
          <select
            value={value.balance}
            onChange={(e) => patch({ balance: e.target.value as RacketBalance })}
            className="w-full rounded border border-gray-200 px-3 py-2 text-sm"
            disabled={disabled}
          >
            <option value="">--</option>
            {BALANCE_OPTIONS.map((b) => (
              <option key={b} value={b}>
                {b.charAt(0).toUpperCase() + b.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="mb-1 text-[11px] font-semibold text-gray-500">SURFACE MATERIAL</div>
          <input
            type="text"
            value={value.surfaceMaterial}
            onChange={(e) => patch({ surfaceMaterial: e.target.value })}
            placeholder="Carbon fiber"
            className="w-full rounded border border-gray-200 px-3 py-2 text-sm"
            disabled={disabled}
          />
        </div>
      </div>

      {/* Image + preview + background-removal toggle */}
      <div>
        <div className="mb-1 text-[11px] font-semibold text-gray-500">IMAGE (optional)</div>
        <div className="flex items-start gap-3">
          <div className="flex-1 flex flex-col gap-2">
            <input
              type="file"
              accept="image/*"
              onChange={(e) =>
                patch({
                  imageFile: e.target.files?.[0] ?? null,
                  // New upload invalidates any prior processed image.
                  transparentDataUrl: null,
                })
              }
              className="text-xs"
              disabled={disabled}
            />
            {hasProcessableImage && (
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  disabled={processingTransparency || disabled}
                  onClick={handleRemoveBackground}
                  className="self-start text-[11px] font-semibold border border-gray-200 rounded px-2 py-1 bg-white hover:bg-gray-50 disabled:opacity-50 cursor-pointer"
                >
                  {processingTransparency
                    ? 'Processing…'
                    : value.transparentDataUrl
                      ? 'Restore original'
                      : 'Remove background'}
                </button>
                {transparencyError && (
                  <div className="text-[11px] text-red-600">{transparencyError}</div>
                )}
              </div>
            )}
          </div>
          {previewSrc && (
            <div
              className="w-24 h-24 rounded border border-gray-200 flex items-center justify-center overflow-hidden shrink-0"
              style={
                value.transparentDataUrl
                  ? {
                      backgroundImage:
                        'linear-gradient(45deg, #e5e7eb 25%, transparent 25%), linear-gradient(-45deg, #e5e7eb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e7eb 75%), linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)',
                      backgroundSize: '16px 16px',
                      backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
                    }
                  : { backgroundColor: '#ffffff' }
              }
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewSrc}
                alt="Racket preview"
                className="max-w-full max-h-full object-contain"
              />
            </div>
          )}
        </div>
      </div>

      {/* Product URL */}
      <div>
        <div className="mb-1 text-[11px] font-semibold text-gray-500">PRODUCT URL / AFFILIATE LINK (optional)</div>
        <input
          type="url"
          value={value.productUrl}
          onChange={(e) => patch({ productUrl: e.target.value })}
          placeholder="https://..."
          className="w-full rounded border border-gray-200 px-3 py-2 text-sm"
          disabled={disabled}
        />
      </div>
    </div>
  )
}

// ── Type guards for extracted values ───────────────────────────────────
function isShape(v: string | null): v is (typeof SHAPE_OPTIONS)[number] {
  return v != null && (SHAPE_OPTIONS as readonly string[]).includes(v)
}
function isBalance(v: string | null): v is (typeof BALANCE_OPTIONS)[number] {
  return v != null && (BALANCE_OPTIONS as readonly string[]).includes(v)
}

// ── Helper: derive the POST body shared by both create flows ───────────
export function racketFieldsToCreatePayload(
  value: RacketFieldsValue,
  brandId: string,
): {
  brand_id: string
  model: string
  year: number | null
  shape: string | null
  weight_grams: number | null
  balance: string | null
  surface_material: string | null
  product_url: string | null
  image_url: null
} {
  return {
    brand_id: brandId,
    model: value.model.trim(),
    year: value.year ? Number(value.year) : null,
    shape: value.shape || null,
    weight_grams: value.weightGrams ? Number(value.weightGrams) : null,
    balance: value.balance || null,
    surface_material: value.surfaceMaterial.trim() || null,
    product_url: value.productUrl.trim() || null,
    image_url: null,
  }
}

// ── Shared validation — returns first error or null ────────────────────
export function validateRacketFields(value: RacketFieldsValue): string | null {
  const model = value.model.trim()
  if (!model) return 'Model is required'
  if (value.year) {
    const y = Number(value.year)
    if (!Number.isInteger(y) || y < 1990 || y > 2030) return 'Year must be between 1990 and 2030'
  }
  if (value.weightGrams) {
    const w = Number(value.weightGrams)
    if (!Number.isFinite(w) || w < 300 || w > 450) return 'Weight must be between 300 and 450 grams'
  }
  if (value.productUrl.trim() && !value.productUrl.trim().startsWith('http')) {
    return 'Product URL must start with http(s)://'
  }
  return null
}

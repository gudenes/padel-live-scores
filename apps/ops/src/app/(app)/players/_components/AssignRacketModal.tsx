'use client'
// apps/ops/src/app/(app)/players/_components/AssignRacketModal.tsx
// Modal for assigning (or changing) the current racket on a player.
// Two comboboxes (brand → racket), date picker, optional notes.
// Inline-create hooks open CreateBrand/RacketModal (stubs in B2, real in B3/B4).
// POST /api/internal/player-equipment auto-ends any current assignment.

import { useState, useEffect } from 'react'
import Combobox from './Combobox'
import CreateBrandModal from './CreateBrandModal'
import CreateRacketModal from './CreateRacketModal'
import type { EquipmentEntry } from './EquipmentTab'
import { Button } from '@/components/ui'

interface Brand {
  id: string
  name: string
  logo_url: string | null
}
interface Racket {
  id: string
  brand_id: string
  model: string
  year: number | null
  image_url: string | null
}

interface Props {
  playerId: string
  currentEntry: EquipmentEntry | null
  onClose: () => void
  onSaved: () => void
}

export default function AssignRacketModal({
  playerId,
  currentEntry,
  onClose,
  onSaved,
}: Props) {
  const [brands, setBrands] = useState<Brand[]>([])
  const [rackets, setRackets] = useState<Racket[]>([])
  const [brandId, setBrandId] = useState<string | null>(null)
  const [racketId, setRacketId] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState<string>(
    new Date().toISOString().slice(0, 10),
  )
  const [notes, setNotes] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createBrandText, setCreateBrandText] = useState<string | null>(null)
  const [createRacketText, setCreateRacketText] = useState<string | null>(null)

  // Fetch brands once on mount.
  useEffect(() => {
    fetch('/api/internal/brands')
      .then((r) => r.json())
      .then((d: { brands?: Brand[] }) => setBrands(d.brands ?? []))
      .catch(() => setBrands([]))
  }, [])

  // Fetch rackets when brand changes. Clearing on brandId=null is handled by
  // the brand combobox's onChange to avoid a synchronous setState in this effect
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!brandId) return
    let cancelled = false
    fetch(`/api/internal/rackets?brand_id=${brandId}`)
      .then((r) => r.json())
      .then((d: { rackets?: Racket[] }) => {
        if (!cancelled) setRackets(d.rackets ?? [])
      })
      .catch(() => {
        if (!cancelled) setRackets([])
      })
    return () => {
      cancelled = true
    }
  }, [brandId])

  async function handleSave() {
    if (!racketId) {
      setError('Pick a racket')
      return
    }
    setSaving(true)
    setError(null)
    const res = await fetch('/api/internal/player-equipment', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        player_id: playerId,
        racket_id: racketId,
        started_at: startedAt,
        notes,
      }),
    })
    setSaving(false)
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string }
      setError(d.error ?? 'Save failed')
      return
    }
    onSaved()
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="rounded-lg p-6 w-[440px] max-h-[90vh] overflow-auto"
        style={{ background: 'var(--bg-surface)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="text-base font-semibold" style={{ color: 'var(--text-1)' }}>
            {currentEntry ? 'Change racket' : 'Assign racket'}
          </div>
          <button onClick={onClose} className="cursor-pointer" style={{ background: 'none', border: 'none', color: 'var(--text-3)', fontSize: 18 }}>
            ×
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <div className="text-[11px] font-semibold mb-1" style={{ color: 'var(--text-3)' }}>BRAND</div>
            <Combobox
              options={brands.map((b) => ({ id: b.id, label: b.name }))}
              value={brandId}
              onChange={(id) => {
                setBrandId(id)
                setRacketId(null)
                if (!id) setRackets([])
              }}
              onCreate={(t) => setCreateBrandText(t)}
              createLabel={(t) => `+ Create brand "${t}"`}
              placeholder="Pick a brand…"
            />
          </div>

          <div>
            <div className="text-[11px] font-semibold mb-1" style={{ color: 'var(--text-3)' }}>RACKET</div>
            <Combobox
              options={rackets.map((r) => ({
                id: r.id,
                label: r.model,
                sublabel: r.year ? String(r.year) : undefined,
              }))}
              value={racketId}
              onChange={setRacketId}
              onCreate={brandId ? (t) => setCreateRacketText(t) : undefined}
              createLabel={(t) => `+ Create racket "${t}"`}
              placeholder={brandId ? 'Pick a racket…' : 'Pick a brand first'}
              disabled={!brandId}
            />
          </div>

          <div>
            <div className="text-[11px] font-semibold mb-1" style={{ color: 'var(--text-3)' }}>START DATE</div>
            <input
              type="date"
              value={startedAt}
              onChange={(e) => setStartedAt(e.target.value)}
              className="ui-input w-full px-3 py-2 text-sm"
            />
            {currentEntry && (
              <div className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
                Current &quot;{currentEntry.racket.brand.name}{' '}
                {currentEntry.racket.model}&quot; will be auto-ended on {startedAt}.
              </div>
            )}
          </div>

          <div>
            <div className="text-[11px] font-semibold mb-1" style={{ color: 'var(--text-3)' }}>
              NOTES (optional)
            </div>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. switched after preseason injury"
              className="ui-input w-full px-3 py-2 text-sm"
            />
          </div>

          {error && <div className="text-xs" style={{ color: 'var(--live-text)' }}>{error}</div>}

          <div className="flex gap-2 justify-end pt-2">
            <Button onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={saving || !racketId}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>

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
        {createRacketText !== null && brandId && (
          <CreateRacketModal
            initialModel={createRacketText}
            brandId={brandId}
            onClose={() => setCreateRacketText(null)}
            onCreated={async (newRacket) => {
              const updated = (await fetch(
                `/api/internal/rackets?brand_id=${brandId}`,
              )
                .then((r) => r.json())
                .catch(() => ({ rackets: [] }))) as { rackets?: Racket[] }
              setRackets(updated.rackets ?? [])
              setRacketId(newRacket.id)
              setCreateRacketText(null)
            }}
          />
        )}
      </div>
    </div>
  )
}

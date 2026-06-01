'use client'
// apps/ops/src/app/(app)/players/_components/EquipmentTab.tsx
// Self-contained equipment management for a single player.
// Renders three states: empty / current+history / modal trigger.
//
// Two entry points for creating an assignment:
//   • "+ Assign existing" → AssignRacketModal (pick from catalog, fast path)
//   • "+ Add new"        → AddRacketModal (full racket create + AI URL extract +
//                          bg-transparency toggle, with the current player
//                          pre-filled in step 2)

import { useState, useEffect, useCallback } from 'react'
import AssignRacketModal from './AssignRacketModal'
import AddRacketModal from './AddRacketModal'
import type { PlayerLite } from './PlayerPicker'

export interface EquipmentEntry {
  id: string
  started_at: string | null
  ended_at: string | null
  notes: string | null
  racket: {
    id: string
    model: string
    year: number | null
    image_url: string | null
    brand: { id: string; name: string; logo_url: string | null }
  }
}

interface Props {
  playerId: string
  /**
   * Optional — when provided, the "+ Add new" button pre-fills this player in
   * AddRacketModal step 2 so the operator can save+assign in one shot.
   * If omitted, "+ Add new" still works but opens with an empty picker.
   */
  player?: PlayerLite | null
}

export default function EquipmentTab({ playerId, player = null }: Props) {
  const [entries, setEntries] = useState<EquipmentEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showAssign, setShowAssign] = useState(false)
  const [showAddRacket, setShowAddRacket] = useState(false)

  const refetch = useCallback(async () => {
    const res = await fetch(`/api/internal/player-equipment?player_id=${playerId}`)
    if (res.ok) {
      const data = (await res.json()) as { equipment: EquipmentEntry[] }
      setEntries(data.equipment ?? [])
    }
    setLoading(false)
  }, [playerId])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/internal/player-equipment?player_id=${playerId}`)
      .then((r) => (r.ok ? r.json() : { equipment: [] }))
      .then((data: { equipment?: EquipmentEntry[] }) => {
        if (cancelled) return
        setEntries(data.equipment ?? [])
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [playerId])

  const current = entries.find((e) => !e.ended_at) ?? null
  const history = entries.filter((e) => e.ended_at)

  async function endCurrent() {
    if (!current) return
    if (
      !confirm(
        `End "${current.racket.brand.name} ${current.racket.model}" assignment as of today?`,
      )
    )
      return
    const res = await fetch(
      `/api/internal/player-equipment/${current.id}?end=true`,
      { method: 'DELETE' },
    )
    if (res.ok) refetch()
  }

  if (loading) return <div className="text-xs" style={{ color: 'var(--text-3)' }}>Loading equipment…</div>

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-[11px] font-semibold mb-2" style={{ color: 'var(--text-3)' }}>CURRENT RACKET</div>
        {current ? (
          <CurrentCard
            entry={current}
            onChange={() => setShowAssign(true)}
            onAddNew={() => setShowAddRacket(true)}
            onEnd={endCurrent}
          />
        ) : (
          <EmptyCard
            onAssign={() => setShowAssign(true)}
            onAddNew={() => setShowAddRacket(true)}
          />
        )}
      </div>

      {history.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold mb-2" style={{ color: 'var(--text-3)' }}>
            HISTORY ({history.length})
          </div>
          <div className="flex flex-col gap-1">
            {history.map((h) => (
              <HistoryRow key={h.id} entry={h} />
            ))}
          </div>
        </div>
      )}

      {showAssign && (
        <AssignRacketModal
          playerId={playerId}
          currentEntry={current}
          onClose={() => setShowAssign(false)}
          onSaved={() => {
            setShowAssign(false)
            refetch()
          }}
        />
      )}

      {showAddRacket && (
        <AddRacketModal
          initialPlayer={player ?? null}
          onClose={() => {
            // Refetch on every close — the modal handles the assignment POST
            // internally when the operator hits "Save & assign", but doesn't
            // expose a separate callback for that path. Cheap to refetch even
            // on cancel (single endpoint, scoped to this player).
            setShowAddRacket(false)
            refetch()
          }}
          onCreated={() => {
            // Catalog-only success path also routes through onClose above,
            // but keep this hook in place in case the modal is updated later
            // to fire onCreated without onClose.
            refetch()
          }}
        />
      )}
    </div>
  )
}

function CurrentCard({
  entry,
  onChange,
  onAddNew,
  onEnd,
}: {
  entry: EquipmentEntry
  onChange: () => void
  onAddNew: () => void
  onEnd: () => void
}) {
  return (
    <div
      className="flex gap-3 items-center p-2.5 rounded-lg border"
      style={{ background: 'var(--bg-card-2)', borderColor: 'var(--border-card)' }}
    >
      {entry.racket.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={entry.racket.image_url}
          alt={entry.racket.model}
          className="w-12 h-12 object-contain flex-shrink-0"
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold" style={{ color: 'var(--text-1)' }}>{entry.racket.brand.name}</div>
        <div className="text-xs" style={{ color: 'var(--text-3)' }}>
          {entry.racket.model}
          {entry.racket.year && (
            <span className="ml-1" style={{ color: 'var(--text-4)' }}>{entry.racket.year}</span>
          )}
        </div>
        {entry.started_at && (
          <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-4)' }}>Since {entry.started_at}</div>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <button
          onClick={onChange}
          className="px-2.5 py-1 text-[11px] font-semibold border rounded cursor-pointer"
          style={{ background: 'var(--bg-card)', color: 'var(--text-1)', borderColor: 'var(--border-card)' }}
        >
          Change
        </button>
        <button
          onClick={onAddNew}
          className="px-2.5 py-1 text-[11px] font-semibold border rounded cursor-pointer"
          style={{ background: 'var(--bg-card)', color: 'var(--text-1)', borderColor: 'var(--border-card)' }}
        >
          + Add new
        </button>
        <button
          onClick={onEnd}
          className="px-2.5 py-1 text-[11px] font-semibold border rounded cursor-pointer"
          style={{ background: 'var(--bg-card)', color: 'var(--live-text)', borderColor: 'var(--border-card)' }}
        >
          End
        </button>
      </div>
    </div>
  )
}

function EmptyCard({
  onAssign,
  onAddNew,
}: {
  onAssign: () => void
  onAddNew: () => void
}) {
  return (
    <div
      className="px-3.5 py-3 rounded-lg border border-dashed text-xs flex items-center justify-between gap-2"
      style={{ background: 'var(--bg-card-2)', borderColor: 'var(--border-card)', color: 'var(--text-3)' }}
    >
      <span>No racket currently assigned</span>
      <div className="flex gap-2 flex-shrink-0">
        <button
          onClick={onAssign}
          className="px-2.5 py-1 text-[11px] font-semibold border rounded cursor-pointer"
          style={{ background: 'var(--bg-card)', color: 'var(--text-1)', borderColor: 'var(--border-card)' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-card)')}
        >
          + Assign existing
        </button>
        <button
          onClick={onAddNew}
          className="px-2.5 py-1 text-[11px] font-semibold border rounded cursor-pointer"
          style={{ background: 'var(--bg-card)', color: 'var(--text-1)', borderColor: 'var(--border-card)' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-card)')}
        >
          + Add new
        </button>
      </div>
    </div>
  )
}

function HistoryRow({ entry }: { entry: EquipmentEntry }) {
  return (
    <div className="text-xs px-2 py-1" style={{ color: 'var(--text-2)' }}>
      <span className="font-medium" style={{ color: 'var(--text-1)' }}>
        {entry.racket.brand.name} {entry.racket.model}
      </span>
      {entry.racket.year && (
        <span style={{ color: 'var(--text-4)' }}> {entry.racket.year}</span>
      )}
      <span className="ml-2" style={{ color: 'var(--text-4)' }}>
        {entry.started_at ?? '?'} → {entry.ended_at}
      </span>
    </div>
  )
}

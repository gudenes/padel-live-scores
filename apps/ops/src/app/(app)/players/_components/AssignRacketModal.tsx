'use client'
// apps/ops/src/app/(app)/players/_components/AssignRacketModal.tsx
// Stub — real implementation lands in Task B2.

import type { EquipmentEntry } from './EquipmentTab'

interface Props {
  playerId: string
  currentEntry: EquipmentEntry | null
  onClose: () => void
  onSaved: () => void
}

export default function AssignRacketModal({ onClose }: Props) {
  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg p-6 w-96"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-semibold mb-2">Assign racket — coming in task B2</div>
        <button onClick={onClose} className="text-xs underline">
          Close
        </button>
      </div>
    </div>
  )
}

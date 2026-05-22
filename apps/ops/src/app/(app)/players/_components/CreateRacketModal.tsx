'use client'
// apps/ops/src/app/(app)/players/_components/CreateRacketModal.tsx
// Stub — real implementation (form + image upload) lands in Task B4.

interface Props {
  initialModel: string
  brandId: string
  onClose: () => void
  onCreated: (racket: { id: string; model: string }) => void
}

export default function CreateRacketModal({ onClose }: Props) {
  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center z-[60]"
      onClick={onClose}
    >
      <div className="bg-white rounded-lg p-6 w-96" onClick={(e) => e.stopPropagation()}>
        <div className="text-sm">Create racket — coming in B4</div>
        <button onClick={onClose} className="text-xs underline mt-2">
          Close
        </button>
      </div>
    </div>
  )
}

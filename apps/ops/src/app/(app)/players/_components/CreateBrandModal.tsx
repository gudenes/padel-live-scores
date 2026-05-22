'use client'
// apps/ops/src/app/(app)/players/_components/CreateBrandModal.tsx
// Stub — real implementation (form + logo upload) lands in Task B3.

interface Props {
  initialName: string
  onClose: () => void
  onCreated: (brand: { id: string; name: string }) => void
}

export default function CreateBrandModal({ onClose }: Props) {
  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center z-[60]"
      onClick={onClose}
    >
      <div className="bg-white rounded-lg p-6 w-96" onClick={(e) => e.stopPropagation()}>
        <div className="text-sm">Create brand — coming in B3</div>
        <button onClick={onClose} className="text-xs underline mt-2">
          Close
        </button>
      </div>
    </div>
  )
}

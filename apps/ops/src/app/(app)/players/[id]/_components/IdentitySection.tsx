'use client'
// apps/ops/src/app/(app)/players/[id]/_components/IdentitySection.tsx
// Read-only card listing the player's canonical UUID + source IDs (padelapi_id,
// fip_id, public_id, slug). Each row has a small "copy" affordance that writes
// the value to the clipboard. Rows for null IDs are skipped — we don't want to
// surface empty source-of-truth columns to operators.

export interface IdentitySectionPlayer {
  id: string
  external_id: string | null
  fip_id: string | null
  public_id: string | null
  slug: string | null
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="w-28 text-[11px] uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className="font-mono text-xs text-gray-900 break-all flex-1">
        {value}
      </div>
      <button
        type="button"
        onClick={() => navigator.clipboard.writeText(value)}
        className="text-[10px] text-gray-400 hover:text-gray-900 cursor-pointer"
        title="Copy"
      >
        copy
      </button>
    </div>
  )
}

export default function IdentitySection({
  player,
}: {
  player: IdentitySectionPlayer
}) {
  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4">
      <h2 className="text-sm font-semibold text-gray-900 mb-2">Identity</h2>
      <Row label="UUID" value={player.id} />
      <Row label="padelapi_id" value={player.external_id} />
      <Row label="fip_id" value={player.fip_id} />
      <Row label="public_id" value={player.public_id} />
      <Row label="slug" value={player.slug} />
    </section>
  )
}

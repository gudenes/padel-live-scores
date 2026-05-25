'use client'
// apps/ops/src/components/FipSeedPanel.tsx
// One-click re-seed of the entry list from FIP PDFs. Calls
// POST /api/internal/tournament-explorer/[id]/seed which bridges to the
// legacy main-app pipeline.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function FipSeedPanel({ tournamentId, hasFipId }: { tournamentId: string; hasFipId: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  if (!hasFipId) return null // can't seed without a FIP id

  const reseed = async () => {
    setBusy(true)
    setResult(null)
    try {
      const r = await fetch(`/api/internal/tournament-explorer/${tournamentId}/seed`, { method: 'POST' })
      const b = await r.json()
      if (!b.ok) {
        setResult({ ok: false, message: b.error ?? 'seed failed' })
        return
      }
      setResult({ ok: true, message: `Seeded ${b.snapshotsInserted ?? 0} entry-list rows` })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginBottom: 12, padding: 12, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, fontSize: 12, color: '#78350f' }}>
          Re-seed entry list from <code style={{ background: '#fef3c7', padding: '1px 5px', borderRadius: 3 }}>padelfip.com</code>.
          Use after resolving an unresolved partner to refresh the snapshot.
        </div>
        <button
          type="button"
          onClick={reseed}
          disabled={busy}
          style={{
            padding: '6px 14px', fontSize: 12, fontWeight: 700,
            background: busy ? '#fde68a' : '#f59e0b',
            color: busy ? '#92400e' : '#fff',
            border: 'none', borderRadius: 4,
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          {busy ? 'Scraping PDFs...' : 'Re-seed from FIP PDF'}
        </button>
      </div>
      {result && (
        <div style={{
          marginTop: 10, padding: 8, borderRadius: 6, fontSize: 11,
          background: result.ok ? '#ecfdf5' : '#fee2e2',
          border: `1px solid ${result.ok ? '#a7f3d0' : '#fecaca'}`,
          color: result.ok ? '#065f46' : '#991b1b',
        }}>
          {result.message}
        </div>
      )}
    </div>
  )
}

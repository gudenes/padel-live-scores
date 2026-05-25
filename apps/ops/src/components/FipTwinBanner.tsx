'use client'
// apps/ops/src/components/FipTwinBanner.tsx

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { FipTwinHit } from '@/lib/fip-twin-finder'

export function FipTwinBanner({ tournamentId, twin }: { tournamentId: string; twin: FipTwinHit }) {
  const router = useRouter()
  const [linking, setLinking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const link = async () => {
    setLinking(true)
    setError(null)
    try {
      const r = await fetch(`/api/internal/tournament-explorer/${tournamentId}/link-fip-twin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceTournamentId: twin.candidate.id }),
      })
      const b = await r.json()
      if (!b.ok) {
        setError(b.error ?? 'link failed')
        return
      }
      router.refresh()
    } finally {
      setLinking(false)
    }
  }

  const confColor =
    twin.confidence === 'high'
      ? { bg: '#ecfdf5', border: '#a7f3d0', pill: '#065f46', pillBg: '#d1fae5' }
      : twin.confidence === 'medium'
        ? { bg: '#eff6ff', border: '#bfdbfe', pill: '#1e40af', pillBg: '#dbeafe' }
        : { bg: '#fffbeb', border: '#fde68a', pill: '#92400e', pillBg: '#fef3c7' }

  return (
    <div style={{ marginBottom: 12, padding: 14, background: confColor.bg, border: `1px solid ${confColor.border}`, borderRadius: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#111', marginBottom: 4 }}>
            FIP id available from padelgod discovery
            <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 700, color: confColor.pill, background: confColor.pillBg, padding: '2px 6px', borderRadius: 3, textTransform: 'uppercase' }}>
              {twin.confidence} confidence
            </span>
          </div>
          <div style={{ fontSize: 11, color: '#444', lineHeight: 1.5 }}>
            Padelgod captured this event on padelfip.com as{' '}
            <code style={{ background: 'var(--bg-card)', padding: '1px 5px', borderRadius: 3, border: '1px solid var(--border-subtle)' }}>{twin.candidate.fip_id}</code>{' '}
            but it isn&apos;t linked here yet. Linking enables Re-seed from FIP PDF below.
          </div>
          <div style={{ fontSize: 10, color: 'var(--status-neutral)', marginTop: 6, fontFamily: 'monospace' }}>
            Matched on: {twin.reasons.join(' · ')}
          </div>
        </div>
        <button
          type="button"
          onClick={link}
          disabled={linking}
          style={{
            padding: '6px 14px', fontSize: 12, fontWeight: 700,
            background: linking ? '#d1d5db' : '#111',
            color: '#fff', border: 'none', borderRadius: 4,
            cursor: linking ? 'wait' : 'pointer',
          }}
        >
          {linking ? 'Linking...' : 'Link fip_id'}
        </button>
      </div>
      {error && (
        <div style={{ marginTop: 10, padding: 8, background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 4, fontSize: 11, color: '#991b1b' }}>{error}</div>
      )}
    </div>
  )
}

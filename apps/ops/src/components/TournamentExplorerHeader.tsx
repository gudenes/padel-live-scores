'use client'
// apps/ops/src/components/TournamentExplorerHeader.tsx

import type { EntryListPayload } from '@/lib/entry-list-aggregator'

export function TournamentExplorerHeader({ payload }: { payload: EntryListPayload }) {
  const t = payload.tournament
  return (
    <div style={{ marginBottom: 16, padding: 12, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#111', marginBottom: 4 }}>{t.name}</div>
      <div style={{ fontSize: 11, color: 'var(--status-neutral)', fontFamily: 'monospace', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span>{t.starts_at?.slice(0, 10) ?? '—'} → {t.ends_at?.slice(0, 10) ?? '—'}</span>
        <span>{t.country ?? '—'}</span>
        <span>{t.level ?? '—'}</span>
        <span>fip: {t.fip_id ?? '—'}</span>
      </div>
      {payload.capturedAt && (
        <div style={{ fontSize: 10, color: 'var(--status-neutral)', marginTop: 6 }}>
          Snapshot captured {formatAgo(payload.capturedAt)}
        </div>
      )}
    </div>
  )
}

function formatAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!isFinite(ms) || ms < 0) return '—'
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

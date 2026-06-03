'use client'
import { Button } from '@/components/ui'
import type { BulkTally } from './useBulkRefresh'

export default function BulkRefreshBar({
  selectedCount, running, tally, onRefresh, onStop, onClear,
}: {
  selectedCount: number
  running: boolean
  tally: BulkTally
  onRefresh: () => void
  onStop: () => void
  onClear: () => void
}) {
  if (selectedCount === 0 && !running && tally.total === 0) return null
  const pct = tally.total > 0 ? Math.round((tally.done / tally.total) * 100) : 0
  const finished = !running && tally.total > 0
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 5, display: 'flex', alignItems: 'center', gap: 14,
      padding: '10px 14px', margin: '0 0 14px', background: 'var(--bg-card)',
      border: '1px solid var(--border-card)', borderRadius: 10,
    }}>
      {running ? (
        <>
          <span style={{ fontSize: 13, fontWeight: 700, minWidth: 92 }}>{tally.done} / {tally.total}</span>
          <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--bg-hover)', overflow: 'hidden', maxWidth: 260 }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--lime)', transition: 'width .2s' }} />
          </div>
          <span style={{ fontSize: 12, color: 'var(--rd-ok)' }}>✓{tally.added} added</span>
          <span style={{ fontSize: 12, color: 'var(--rd-gap)' }}>◦{tally.noData} no data</span>
          <span style={{ fontSize: 12, color: 'var(--rd-bad)' }}>✗{tally.error} error</span>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{tally.total - tally.done} left</span>
          <Button variant="ghost" size="sm" onClick={onStop}>Stop</Button>
        </>
      ) : finished ? (
        <>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Done {tally.done} / {tally.total}</span>
          <span style={{ fontSize: 12, color: 'var(--rd-ok)' }}>✓{tally.added} added</span>
          <span style={{ fontSize: 12, color: 'var(--rd-gap)' }}>◦{tally.noData} no data</span>
          <span style={{ fontSize: 12, color: 'var(--rd-bad)' }}>✗{tally.error} error</span>
          <Button variant="ghost" size="sm" onClick={onClear}>Clear</Button>
        </>
      ) : (
        <>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{selectedCount} selected</span>
          <Button variant="primary" size="sm" onClick={onRefresh}>Refresh {selectedCount}</Button>
          <Button variant="ghost" size="sm" onClick={onClear}>Clear</Button>
        </>
      )}
    </div>
  )
}

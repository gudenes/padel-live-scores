'use client'
// apps/ops/src/components/DuplicatePlayersPanel.tsx
//
// Shared duplicate-scan panel. Mounted by:
//   - apps/ops/src/app/(app)/players/_components/PlayersTab.tsx (T5)
//   - apps/ops/src/app/(app)/needs-review/* (T6)
//
// Lifted from PlayersTab's dup-scan UI. Preserves behavior 1:1:
//   - Two scan modes (rules / AI) calling /api/internal/duplicate-scan
//   - Results panel with per-group richness heuristic, quick-merge,
//     keep-the-other, dismiss, and an optional "Review fields..." that
//     hands off to the host's per-field merge editor.
//
// The per-field merge editor itself stays in PlayersTab because it's bound to
// the drawer/search/selectedPlayer state there. /needs-review wires quick-merge
// + dismiss only and omits onReviewFields, which hides that button.
//
// Faithful extraction — no new behavior, same endpoints, same body shape.

import { useCallback, useState } from 'react'
import type { DuplicateGroup, PlayerRow } from '@/lib/player-duplicate-rules'

// ── Shared styles (matching PlayersTab inline-style approach) ────
const card: React.CSSProperties = {
  background: 'white',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 12,
}

interface Props {
  /** Optional category filter applied to the scan (passed to ?category=). */
  category?: string | null
  /** Called after each successful merge so the parent can refresh its data. */
  onMerged?: () => void
  /**
   * Called when the operator clicks "Review fields..." on a group. If omitted,
   * the button is hidden (used by /needs-review, where there's no per-field
   * editor to hand off to). The host is responsible for opening its own UI.
   */
  onReviewFields?: (keepId: string, deleteId: string) => void
}

// Stable key for a duplicate group — sorted member IDs joined.
function groupKeyFor(group: DuplicateGroup): string {
  return group.players.map(p => p.id).sort().join('|')
}

// Richness heuristic — picks the "fuller" player as the merge-keep recommendation.
function richness(p: PlayerRow): number {
  let s = 0
  if (p.name) s += 1
  if (p.country) s += 1
  if (p.ranking !== null) s += 2
  if (p.points !== null) s += 1
  if (p.fip_id) s += 2
  if (p.external_id) s += 1
  return s
}

export default function DuplicatePlayersPanel({ category, onMerged, onReviewFields }: Props) {
  const [dupGroups, setDupGroups] = useState<DuplicateGroup[]>([])
  const [dupScanning, setDupScanning] = useState(false)
  const [dupScanned, setDupScanned] = useState(0)
  const [dupShowPanel, setDupShowPanel] = useState(false)
  const [dupDismissed, setDupDismissed] = useState<Set<string>>(new Set())
  const [dupMerging, setDupMerging] = useState<Set<string>>(new Set())
  const [dupMerged, setDupMerged] = useState<Set<string>>(new Set())
  const [dupMode, setDupMode] = useState<'rules' | 'ai'>('rules')

  // ── Scan ─────────────────────────────────────────────────────
  const runDupScan = useCallback(async (mode: 'rules' | 'ai' = 'rules') => {
    setDupScanning(true)
    setDupDismissed(new Set())
    setDupMerged(new Set())
    setDupMode(mode)
    try {
      const params = new URLSearchParams()
      if (category && category !== 'all') params.set('category', category)
      params.set('mode', mode)
      const res = await fetch(`/api/internal/duplicate-scan?${params}`)
      if (res.ok) {
        const data = await res.json()
        setDupGroups(data.groups ?? [])
        setDupScanned(data.scanned ?? 0)
        setDupShowPanel(true)
      }
    } catch { /* ignore */ }
    setDupScanning(false)
  }, [category])

  // ── Direct merge (quick + keep-other variants) ───────────────
  const directMergeFromDup = useCallback(async (
    keepPlayer: PlayerRow,
    deletePlayer: PlayerRow,
    key: string,
  ) => {
    setDupMerging(prev => { const s = new Set(prev); s.add(key); return s })
    try {
      const mergedFields: Record<string, unknown> = {}
      const fieldKeys = ['name', 'country', 'category', 'ranking', 'points', 'fip_id', 'external_id', 'avatar_url'] as const
      for (const k of fieldKeys) {
        const keepVal = keepPlayer[k]
        const delVal = deletePlayer[k]
        if (keepVal != null && keepVal !== '') mergedFields[k] = keepVal
        else if (delVal != null && delVal !== '') mergedFields[k] = delVal
      }
      const res = await fetch('/api/internal/players/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keepId: keepPlayer.id, deleteId: deletePlayer.id, mergedFields }),
      })
      if (res.ok) {
        const data = await res.json()
        setDupMerged(prev => { const s = new Set(prev); s.add(key); return s })
        console.log(`[Dup Merge] Kept ${keepPlayer.name}, deleted ${deletePlayer.name}. Matches: ${data.matchesUpdated}, draws: ${data.drawsUpdated}`)
        onMerged?.()
      } else {
        const err = await res.json().catch(() => ({}))
        console.error('[Dup Merge] Failed:', err.error ?? res.status)
        alert(`Merge failed: ${err.error ?? 'Unknown error'}`)
      }
    } catch (e) {
      console.error('[Dup Merge] Error:', e)
      alert('Merge failed — check console')
    }
    setDupMerging(prev => { const s = new Set(prev); s.delete(key); return s })
  }, [onMerged])

  // ── Render ───────────────────────────────────────────────────
  const remaining = dupGroups.length - dupDismissed.size

  return (
    <>
      {/* Scan buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button
          onClick={() => runDupScan('rules')}
          disabled={dupScanning}
          style={{
            padding: '5px 12px', fontSize: 11, fontWeight: 600, cursor: dupScanning ? 'default' : 'pointer',
            border: '1px solid #fbbf24', borderRadius: 4,
            background: dupShowPanel && dupMode === 'rules' ? '#fef3c7' : '#fffbeb', color: '#92400e',
            opacity: dupScanning ? 0.6 : 1, whiteSpace: 'nowrap' as const,
          }}
        >
          {dupScanning && dupMode === 'rules' ? 'Scanning...' : 'Rules Scan'}
        </button>
        <button
          onClick={() => runDupScan('ai')}
          disabled={dupScanning}
          style={{
            padding: '5px 12px', fontSize: 11, fontWeight: 600, cursor: dupScanning ? 'default' : 'pointer',
            border: '1px solid #8b5cf6', borderRadius: 4,
            background: dupShowPanel && dupMode === 'ai' ? '#ede9fe' : '#f5f3ff', color: '#6d28d9',
            opacity: dupScanning ? 0.6 : 1, whiteSpace: 'nowrap' as const,
          }}
        >
          {dupScanning && dupMode === 'ai' ? 'AI Scanning...' : 'AI Scan'}
        </button>
      </div>

      {/* Results panel */}
      {dupShowPanel && (
        <div style={{ ...card, marginBottom: 12, background: '#fffbeb', border: '1px solid #fbbf24' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#92400e' }}>
                {remaining > 0
                  ? `${remaining} potential duplicate group${remaining !== 1 ? 's' : ''} found`
                  : 'All duplicates resolved'}
                <span style={{ fontSize: 10, color: '#b45309', marginLeft: 6 }}>({dupScanned} players scanned)</span>
              </div>
            </div>
            <button
              onClick={() => setDupShowPanel(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 14 }}
            >x</button>
          </div>

          {dupGroups.length === 0 && (
            <div style={{ fontSize: 11, color: '#6B7280', padding: '8px 0' }}>
              No duplicates found. Your player database is clean!
            </div>
          )}

          <div style={{ maxHeight: 400, overflowY: 'auto' as const }}>
            {dupGroups.map((group, gi) => {
              const key = groupKeyFor(group)
              if (dupDismissed.has(key)) return null
              const [a, b] = group.players
              const scoreA = richness(a)
              const scoreB = richness(b)
              const recommended: 'a' | 'b' = scoreA >= scoreB ? 'a' : 'b'

              return (
                <DuplicateGroupCard
                  key={gi}
                  group={group}
                  groupKey={key}
                  a={a}
                  b={b}
                  recommended={recommended}
                  merging={dupMerging.has(key)}
                  merged={dupMerged.has(key)}
                  onQuickMerge={() => {
                    const keep = recommended === 'a' ? a : b
                    const del = recommended === 'a' ? b : a
                    directMergeFromDup(keep, del, key)
                  }}
                  onKeepOther={() => {
                    const keep = recommended === 'a' ? b : a
                    const del = recommended === 'a' ? a : b
                    directMergeFromDup(keep, del, key)
                  }}
                  onReviewFields={onReviewFields ? () => {
                    const keepId = recommended === 'a' ? a.id : b.id
                    const deleteId = recommended === 'a' ? b.id : a.id
                    onReviewFields(keepId, deleteId)
                    setDupDismissed(prev => { const s = new Set(prev); s.add(key); return s })
                  } : undefined}
                  onDismiss={() => setDupDismissed(prev => { const s = new Set(prev); s.add(key); return s })}
                />
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

// ── Internal: per-group card ─────────────────────────────────────

interface CardProps {
  group: DuplicateGroup
  groupKey: string
  a: PlayerRow
  b: PlayerRow
  recommended: 'a' | 'b'
  merging: boolean
  merged: boolean
  onQuickMerge: () => void
  onKeepOther: () => void
  onReviewFields?: () => void
  onDismiss: () => void
}

function DuplicateGroupCard({
  group, a, b, recommended, merging, merged,
  onQuickMerge, onKeepOther, onReviewFields, onDismiss,
}: CardProps) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: 10, marginBottom: 6 }}>
      <div style={{ fontSize: 10, color: '#6B7280', marginBottom: 6 }}>
        {group.reasons.map((r, ri) => (
          <span
            key={ri}
            style={{
              display: 'inline-block', padding: '1px 6px', borderRadius: 3,
              background: '#fef3c7', color: '#92400e', fontSize: 9, fontWeight: 600, marginRight: 4,
            }}
          >
            {r}
          </span>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
        {[a, b].map((p, pi) => {
          const isRec = (pi === 0 && recommended === 'a') || (pi === 1 && recommended === 'b')
          return (
            <div
              key={p.id}
              style={{
                padding: 6, borderRadius: 4,
                background: isRec ? '#f0fdf4' : '#f9fafb',
                border: isRec ? '1px solid #86efac' : '1px solid #e5e7eb',
              }}
            >
              <div style={{ fontSize: 9, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' as const, marginBottom: 2 }}>
                Player {pi === 0 ? 'A' : 'B'} {isRec && <span style={{ color: '#16a34a' }}>* Richer</span>}
              </div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#111' }}>{p.name}</div>
              <div style={{ fontSize: 10, color: '#6B7280' }}>
                {p.country ?? '—'} · Rank: {p.ranking ?? '—'} · Pts: {p.points?.toLocaleString() ?? '—'}
              </div>
              <div style={{ fontSize: 9, color: '#9ca3af' }}>
                {p.category ?? '—'} · FIP: {p.fip_id ?? '—'} · ID: {p.id.slice(0, 8)}...
              </div>
            </div>
          )
        })}
      </div>
      {group.mergeGuidance && (
        <div style={{
          padding: '6px 10px', background: '#f5f3ff', borderRadius: 4,
          border: '1px solid #ddd6fe', marginBottom: 8, fontSize: 11, color: '#5b21b6',
        }}>
          <span style={{ fontWeight: 700 }}>AI recommendation:</span> {group.mergeGuidance}
        </div>
      )}
      {merged ? (
        <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>Merged successfully</div>
      ) : (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
          <button
            onClick={onQuickMerge}
            disabled={merging}
            style={{
              fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 4,
              border: 'none', cursor: merging ? 'default' : 'pointer',
              background: '#22c55e', color: '#fff',
              opacity: merging ? 0.6 : 1,
            }}
          >
            {merging ? 'Merging...' : `Quick merge → keep ${recommended === 'a' ? 'A' : 'B'}`}
          </button>
          <button
            onClick={onKeepOther}
            disabled={merging}
            style={{
              fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 4,
              border: '1px solid #d1d5db', cursor: merging ? 'default' : 'pointer',
              background: '#fff', color: '#111',
              opacity: merging ? 0.6 : 1,
            }}
          >
            Keep {recommended === 'a' ? 'B' : 'A'} instead
          </button>
          {onReviewFields && (
            <button
              onClick={onReviewFields}
              disabled={merging}
              style={{
                fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 4,
                border: '1px solid #d1d5db', cursor: 'pointer', background: '#fff', color: '#6B7280',
              }}
            >
              Review fields...
            </button>
          )}
          <button
            onClick={onDismiss}
            disabled={merging}
            style={{
              fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 4,
              border: '1px solid #d1d5db', cursor: 'pointer', background: '#fff', color: '#9ca3af',
            }}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}

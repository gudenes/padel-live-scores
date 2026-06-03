'use client'
// src/app/ops/PlayerSuggestionsTab.tsx
//
// Review queue for crowd-sourced player corrections. Each card shows the
// per-field diffs (current → editable suggested) with per-field Apply, the
// free-text comment, and Reject / Resolve actions. Mirrors FipStreamsTab.

import { useEffect, useState } from 'react'

interface Change { field: string; current: string | null; suggested: string }
interface Suggestion {
  id: string
  player_id: string
  player_name: string | null
  changes: Change[]
  comment: string | null
  submitted_by_email: string | null
  submitted_by_user_id: string | null
  status: string
  created_at: string
}

export default function PlayerSuggestionsTab() {
  const [items, setItems] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    try {
      setLoading(true)
      const r = await fetch('/api/ops/player-suggestions').then(res => res.json()).catch(() => ({ items: [] }))
      setItems(r.items ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  async function act(id: string, payload: Record<string, unknown>) {
    const res = await fetch(`/api/ops/player-suggestions/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { alert(`Failed: ${d.error ?? res.status}`); return false }
    return true
  }

  if (loading) return <div style={{ padding: 16 }}>Loading…</div>

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>
        Pending suggestions ({items.length})
      </h2>
      {items.length === 0 ? (
        <p style={{ color: '#6B7280', fontSize: 13 }}>Empty — no pending suggestions.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map(s => (
            <SuggestionCard key={s.id} s={s} act={act} onDone={refresh} />
          ))}
        </div>
      )}
    </div>
  )
}

function SuggestionCard({
  s, act, onDone,
}: {
  s: Suggestion
  act: (id: string, payload: Record<string, unknown>) => Promise<boolean>
  onDone: () => void
}) {
  return (
    <div style={{ background: '#141414', padding: 14, borderRadius: 6, border: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <a href={`/player/${s.player_id}`} target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 14, fontWeight: 800, color: '#7ED321' }}>
          {s.player_name ?? s.player_id}
        </a>
        <span style={{ fontSize: 11, color: '#6B7280' }}>
          {s.submitted_by_email ?? (s.submitted_by_user_id ? 'user' : 'anonymous')}
          {' · '}{new Date(s.created_at).toLocaleString()}
        </span>
      </div>

      {s.changes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {s.changes.map((c, i) => (
            <FieldRow key={`${c.field}-${i}`} suggestionId={s.id} change={c} act={act} />
          ))}
        </div>
      )}

      {s.comment && (
        <div style={{ marginTop: 10, padding: 10, background: '#0a0a0a', borderRadius: 6, borderLeft: '3px solid #F5A623' }}>
          <div style={{ fontSize: 10, color: '#F5A623', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Comment</div>
          <div style={{ fontSize: 13, color: '#ddd', whiteSpace: 'pre-wrap' }}>{s.comment}</div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <button
          onClick={async () => { if (await act(s.id, { action: 'reject' })) onDone() }}
          style={{ padding: '6px 14px', background: '#2A2A2A', color: '#fff', border: 0, borderRadius: 4, cursor: 'pointer' }}
        >Reject</button>
        <button
          onClick={async () => { if (await act(s.id, { action: 'resolve' })) onDone() }}
          style={{ padding: '6px 14px', background: '#7ED321', color: '#000', fontWeight: 700, border: 0, borderRadius: 4, cursor: 'pointer' }}
        >Resolve</button>
      </div>
    </div>
  )
}

function FieldRow({
  suggestionId, change, act,
}: {
  suggestionId: string
  change: Change
  act: (id: string, payload: Record<string, unknown>) => Promise<boolean>
}) {
  const [value, setValue] = useState(change.suggested)
  const [applied, setApplied] = useState(false)

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ width: 110, fontSize: 12, fontWeight: 700, color: '#9CA3AF' }}>{change.field}</span>
      <span style={{ fontSize: 12, color: '#6B7280', minWidth: 80 }}>{change.current || '—'}</span>
      <span style={{ color: '#6B7280' }}>→</span>
      <input value={value} onChange={e => setValue(e.target.value)} disabled={applied}
        style={{ flex: 1, minWidth: 140, background: '#1a1a1a', color: '#fff', border: '1px solid #2a2a2a', padding: 6, borderRadius: 4 }} />
      <button
        disabled={applied || !value.trim()}
        onClick={async () => {
          if (await act(suggestionId, { action: 'apply', field: change.field, value })) setApplied(true)
        }}
        style={{ padding: '6px 12px', background: applied ? '#2A2A2A' : '#4A9EFF', color: '#fff', fontWeight: 700, border: 0, borderRadius: 4, cursor: applied ? 'default' : 'pointer' }}
      >{applied ? '✓ Applied' : 'Apply'}</button>
    </div>
  )
}

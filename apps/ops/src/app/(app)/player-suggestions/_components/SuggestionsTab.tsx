'use client'
// apps/ops/src/app/(app)/player-suggestions/_components/SuggestionsTab.tsx
//
// Review queue for crowd-sourced player corrections submitted from the public
// player Overview "Suggest changes" sheet. Each card shows the per-field diffs
// (current → editable suggested) with per-field Apply, the free-text comment,
// and Reject / Resolve actions.
//
// Fetches: GET /api/internal/player-suggestions
// Mutates: POST /api/internal/player-suggestions/[id]  ({action: apply|reject|resolve})

import { useEffect, useState } from 'react'
import { PageHeader, Panel, Section, Field, Button, EmptyState, Skeleton } from '@/components/ui'

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

export default function SuggestionsTab() {
  const [items, setItems] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(true)

  async function refresh() {
    setLoading(true)
    const r = await fetch('/api/internal/player-suggestions')
      .then((res) => res.json())
      .catch(() => ({ items: [] }))
    setItems(r.items ?? [])
    setLoading(false)
  }

  // Fetch-on-mount — same pattern as the other admin review tabs (streams,
  // needs-review). The react-hooks/set-state-in-effect rule flags this app-wide.
  useEffect(() => { refresh() }, [])

  async function act(id: string, payload: Record<string, unknown>) {
    const res = await fetch(`/api/internal/player-suggestions/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { alert(`Failed: ${d.error ?? res.status}`); return false }
    return true
  }

  return (
    <div className="ui-page">
      <PageHeader
        title="Suggestions"
        subtitle="Crowd-sourced player profile corrections from the public Suggest-changes sheet."
      />

      {loading ? (
        <Skeleton rows={5} />
      ) : (
        <Section label={`Pending suggestions (${items.length})`}>
          {items.length === 0 ? (
            <EmptyState title="Empty" hint="No pending suggestions." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {items.map((s) => (
                <SuggestionCard key={s.id} s={s} act={act} onDone={refresh} />
              ))}
            </div>
          )}
        </Section>
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
    <Panel>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-1)' }}>
          {s.player_name ?? s.player_id}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
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
        <div style={{ marginTop: 10, padding: 10, background: 'var(--bg-sunken)', borderRadius: 'var(--r-xs)', borderLeft: '3px solid var(--orange-text)' }}>
          <div style={{ fontSize: 10, color: 'var(--orange-text)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Comment</div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>{s.comment}</div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <Button
          variant="danger"
          onClick={async () => { if (await act(s.id, { action: 'reject' })) onDone() }}
        >
          Reject
        </Button>
        <Button
          variant="primary"
          onClick={async () => { if (await act(s.id, { action: 'resolve' })) onDone() }}
        >
          Resolve
        </Button>
      </div>
    </Panel>
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
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <div style={{ width: 96, fontSize: 12, fontWeight: 700, color: 'var(--text-2)', paddingBottom: 8 }}>{change.field}</div>
      <div style={{ fontSize: 12, color: 'var(--text-3)', minWidth: 70, paddingBottom: 8 }}>{change.current || '—'}</div>
      <div style={{ color: 'var(--text-3)', paddingBottom: 8 }}>→</div>
      <Field label="Suggested">
        <input
          className="ui-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={applied}
          style={{ minWidth: 160 }}
        />
      </Field>
      <Button
        variant="primary"
        disabled={applied || !value.trim()}
        onClick={async () => {
          if (await act(suggestionId, { action: 'apply', field: change.field, value })) setApplied(true)
        }}
      >
        {applied ? '✓ Applied' : 'Apply'}
      </Button>
    </div>
  )
}

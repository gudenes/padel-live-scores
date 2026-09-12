'use client'
// apps/ops/src/app/(app)/player-claims/_components/ClaimsTab.tsx
//
// Review queue for "meu perfil de jogador" account→player claim requests.
// Approving is the ONLY verification step in this feature — the operator
// knows their clubmates personally and the account email is the only
// evidence a request is genuine, so the email leads every row.
//
// Fetches: GET /api/internal/player-claims?status=pending|all
// Mutates: POST /api/internal/player-claims/[id]  ({action: approve|reject|unlink})

import { useEffect, useState } from 'react'
import { PageHeader, Panel, Section, Button, EmptyState, Skeleton } from '@/components/ui'

interface Claim {
  id: string
  player_id: string
  player_name: string | null
  user_id: string
  user_email: string | null
  note: string | null
  status: string
  created_at: string
  reviewed_at: string | null
  review_note: string | null
}

export default function ClaimsTab() {
  const [items, setItems] = useState<Claim[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'pending' | 'all'>('pending')

  async function refresh(filter: 'pending' | 'all' = statusFilter) {
    setLoading(true)
    const r = await fetch(`/api/internal/player-claims?status=${filter}`)
      .then((res) => res.json())
      .catch(() => ({ items: [] }))
    setItems(r.items ?? [])
    setLoading(false)
  }

  // Fetch-on-mount — same pattern as the other admin review tabs
  // (Suggestions, streams, needs-review). The react-hooks/set-state-in-effect
  // rule flags this app-wide; the precedent stands.
  useEffect(() => { refresh() }, [])

  async function act(id: string, payload: Record<string, unknown>) {
    const res = await fetch(`/api/internal/player-claims/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (d.error === 'already_claimed') {
        alert('This player was linked to another account in the meantime — nothing was changed.')
      } else {
        alert(`Failed: ${d.error ?? res.status}`)
      }
      return false
    }
    return true
  }

  function switchFilter(filter: 'pending' | 'all') {
    setStatusFilter(filter)
    refresh(filter)
  }

  return (
    <div className="ui-page">
      <PageHeader
        title="Claims"
        subtitle="Account→player profile claims from padelnachos.com. Approving is the only verification — check the email."
        actions={(
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              variant={statusFilter === 'pending' ? 'primary' : 'default'}
              onClick={() => switchFilter('pending')}
            >
              Pending
            </Button>
            <Button
              variant={statusFilter === 'all' ? 'primary' : 'default'}
              onClick={() => switchFilter('all')}
            >
              All
            </Button>
          </div>
        )}
      />

      {loading ? (
        <Skeleton rows={5} />
      ) : (
        <Section label={statusFilter === 'pending' ? `Pending claims (${items.length})` : `All claims (${items.length})`}>
          {items.length === 0 ? (
            <EmptyState title="Empty" hint="No claims to review." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {items.map((c) => (
                <ClaimCard key={c.id} c={c} act={act} onDone={() => refresh()} />
              ))}
            </div>
          )}
        </Section>
      )}
    </div>
  )
}

function ClaimCard({
  c, act, onDone,
}: {
  c: Claim
  act: (id: string, payload: Record<string, unknown>) => Promise<boolean>
  onDone: () => void
}) {
  return (
    <Panel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-1)' }}>
          {c.user_email ?? <span style={{ color: 'var(--text-3)', fontStyle: 'italic' }}>(no email on account)</span>}
        </span>
        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
          claiming{' '}
          <a href={`/players?id=${c.player_id}`} style={{ color: 'var(--lime)', fontWeight: 700 }}>
            {c.player_name ?? c.player_id}
          </a>
        </span>
      </div>

      {c.note && (
        <div style={{ marginTop: 10, padding: 10, background: 'var(--bg-sunken)', borderRadius: 'var(--r-xs)', borderLeft: '3px solid var(--orange-text)' }}>
          <div style={{ fontSize: 13, color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>&ldquo;{c.note}&rdquo;</div>
        </div>
      )}

      <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-3)' }}>
        {new Date(c.created_at).toLocaleString()}
        {c.status !== 'pending' && (
          <>
            {' · '}
            <span style={{ textTransform: 'uppercase', fontWeight: 700 }}>{c.status}</span>
            {c.review_note && ` — ${c.review_note}`}
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        {c.status === 'pending' && (
          <>
            <Button
              variant="danger"
              onClick={async () => { if (await act(c.id, { action: 'reject' })) onDone() }}
            >
              Reject
            </Button>
            <Button
              variant="primary"
              onClick={async () => { if (await act(c.id, { action: 'approve' })) onDone() }}
            >
              Approve
            </Button>
          </>
        )}
        {c.status === 'approved' && (
          <Button
            variant="danger"
            onClick={async () => { if (await act(c.id, { action: 'unlink' })) onDone() }}
          >
            Unlink
          </Button>
        )}
      </div>
    </Panel>
  )
}

'use client'
// Fuzzy coach matches are never applied automatically — they land here.
//  - Merge suggestions: high-impact first (combined points). Merge or "Not the same person".
//  - Player-link suggestions: coach name == player name. Link or "Not the same person".
// "Not the same person" is permanent (Juan Gutiérrez ≠ Juanjo Gutiérrez, 2026-09-18).

import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { PageHeader, Panel, Pill, Button, EmptyState, Skeleton } from '@/components/ui'
import { fmtPoints } from '@/lib/coaches'

interface Side { coach_id: string; display_name: string; total_points: number; player_count: number; variants: string[] }
interface MergeRow { id: string; score: number; reason: string; a: Side; b: Side }
interface LinkRow {
  coach_id: string
  player_id: string
  coach_name: string
  player_name: string
  player_country: string | null
  player_tier: string | null
  player_ranking: number | null
  player_category: string | null
}
interface QueueResponse { merges: MergeRow[]; mergeTotal: number; links: LinkRow[]; linkTotal: number }

async function post(url: string, body?: unknown) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText)
}

const rowStyle: React.CSSProperties = {
  display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
  padding: '10px 0', borderBottom: '1px solid var(--border-card)',
}

function CoachSide({ s }: { s: Side }) {
  return (
    <div style={{ flex: 1, minWidth: 160 }}>
      <Link href={`/players/coaches/${s.coach_id}`} style={{ fontWeight: 600, color: 'var(--text-1)' }}>{s.display_name}</Link>
      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
        {fmtPoints(s.total_points)} pts · {s.player_count} players
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{s.variants.join(' / ')}</div>
    </div>
  )
}

export default function CoachReviewQueue() {
  const [data, setData] = useState<QueueResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    return fetch('/api/internal/coaches/suggestions')
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({}))).error ?? r.statusText))))
      .then((d: QueueResponse) => { setData(d); setError(null) })
      .catch((e: Error) => setError(e.message))
  }, [])
  useEffect(() => { load() }, [load])

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    try { await fn(); setError(null); await load() } catch (e) { setError((e as Error).message) } finally { setBusy(null) }
  }

  const merge = (m: MergeRow, keep: Side, drop: Side) =>
    act(m.id, () => post('/api/internal/coaches/merge', { sourceId: drop.coach_id, targetId: keep.coach_id }))

  return (
    <div className="ui-page">
      <PageHeader title="Coach review queue" subtitle="Fuzzy matches are never merged automatically. Decide them here." />
      {error && <EmptyState title="Something failed" hint={error} />}
      {!data && !error && <Skeleton rows={6} />}
      {data && (
        <>
          <Panel title={`Merge suggestions (${data.mergeTotal})`}>
            {data.merges.length === 0 && <EmptyState title="Nothing to review" />}
            {data.merges.map((m) => {
              // Default survivor = the side with more points; operator can flip it.
              const [big, small] = m.a.total_points >= m.b.total_points ? [m.a, m.b] : [m.b, m.a]
              return (
                <div key={m.id} style={rowStyle}>
                  <CoachSide s={m.a} />
                  <Pill tone="neutral">{m.reason} {m.score}</Pill>
                  <CoachSide s={m.b} />
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Button size="sm" variant="primary" disabled={busy === m.id} onClick={() => merge(m, big, small)}>
                      Merge → {big.display_name}
                    </Button>
                    <Button size="sm" disabled={busy === m.id} onClick={() => merge(m, small, big)}>
                      Merge → {small.display_name}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy === m.id}
                      onClick={() => act(m.id, () => post(`/api/internal/coaches/suggestions/${m.id}/reject`))}>
                      Not the same person
                    </Button>
                  </div>
                </div>
              )
            })}
            {data.mergeTotal > data.merges.length && (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-3)' }}>
                Showing the top {data.merges.length} by impact; more appear as you resolve these.
              </div>
            )}
          </Panel>
          <Panel title={`Coach ↔ player (${data.linkTotal})`}>
            {data.links.length === 0 && <EmptyState title="No player-link suggestions" />}
            {data.links.map((l) => {
              const key = `${l.coach_id}|${l.player_id}`
              const decide = (decision: 'link' | 'reject') =>
                act(key, () => post('/api/internal/coaches/player-links', { coachId: l.coach_id, playerId: l.player_id, decision }))
              return (
                <div key={key} style={rowStyle}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    Coach <Link href={`/players/coaches/${l.coach_id}`} style={{ fontWeight: 600 }}>{l.coach_name}</Link>
                    {' '}might be player{' '}
                    <Link href={`/players/${l.player_id}`} style={{ fontWeight: 600 }}>{l.player_name}</Link>
                    <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                      {' '}· {l.player_country ?? '—'} · {l.player_tier ?? 'pro'} · {l.player_ranking ? `#${l.player_ranking}` : 'unranked'}
                    </span>
                  </div>
                  <Button size="sm" variant="primary" disabled={busy === key} onClick={() => decide('link')}>Link</Button>
                  <Button size="sm" variant="ghost" disabled={busy === key} onClick={() => decide('reject')}>Not the same person</Button>
                </div>
              )
            })}
          </Panel>
        </>
      )}
    </div>
  )
}

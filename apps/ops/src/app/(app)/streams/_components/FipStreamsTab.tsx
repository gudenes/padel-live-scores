'use client'
// apps/ops/src/app/(app)/streams/_components/FipStreamsTab.tsx
//
// Two sections: unresolved queue with inline resolve form + active
// streams read-only table.
//
// Lifted from src/app/ops/FipStreamsTab.tsx (rule 3).
// Fetch rewrites (rule 3):
//   /api/ops/fip-streams/unresolved → /api/internal/fip-streams/unresolved
//   /api/ops/fip-streams/active    → /api/internal/fip-streams/active
//   /api/ops/fip-streams/resolve   → /api/internal/fip-streams/resolve
//   /api/ops/seed-entry-list       → /api/internal/seed-entry-list

import { useEffect, useState } from 'react'
import { PageHeader, Panel, Section, DataTable, Field, Button, EmptyState, Skeleton, Pill } from '@/components/ui'

interface UnresolvedItem {
  id: string
  youtube_video_id: string
  title: string
  thumbnail_url: string | null
  reason: string
  parsed_tournament_name: string | null
  parsed_day: string | null
  parsed_court: string | null
  first_seen_at: string
}

interface ActiveItem {
  youtube_video_id: string
  title: string | null
  court: string
  day_date: string
  state: string
  link_method: string
  view_count: number | null
  tournaments: { name: string; level: string } | null
}

interface TournamentOption {
  id: string
  name: string
  level: string
}

export default function FipStreamsTab() {
  const [unresolved, setUnresolved] = useState<UnresolvedItem[]>([])
  const [active, setActive] = useState<ActiveItem[]>([])
  const [tournaments, setTournaments] = useState<TournamentOption[]>([])
  const [loading, setLoading] = useState(true)

  async function refresh() {
    setLoading(true)
    const [un, ac, tn] = await Promise.all([
      fetch('/api/internal/fip-streams/unresolved').then((r) => r.json()),
      fetch('/api/internal/fip-streams/active').then((r) => r.json()),
      // seed-entry-list returns { tournaments: [...] } — used for dropdown only
      fetch('/api/internal/seed-entry-list?action=list-tournaments').then((r) => r.json()).catch(() => ({ tournaments: [] })),
    ])
    setUnresolved(un.items ?? [])
    setActive(ac.items ?? [])
    setTournaments(tn.tournaments ?? [])
    setLoading(false)
  }

  useEffect(() => { refresh() }, [])

  async function resolve(item: UnresolvedItem, tournamentId: string, court: string, dayDate: string) {
    const res = await fetch('/api/internal/fip-streams/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unresolvedId: item.id, tournamentId, court, dayDate }),
    })
    if (!res.ok) {
      alert(`Resolve failed: ${(await res.json()).error}`)
      return
    }
    await refresh()
  }

  return (
    <div className="ui-page">
      <PageHeader title="Streams" subtitle="FIP YouTube livestream resolution queue and active streams." />

      {loading ? (
        <Skeleton rows={5} />
      ) : (
        <>
          <Section label={`Unresolved queue (${unresolved.length})`}>
            {unresolved.length === 0 ? (
              <EmptyState title="Empty" hint="All videos auto-matched." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {unresolved.map((item) => (
                  <UnresolvedRow key={item.id} item={item} tournaments={tournaments} onResolve={resolve} />
                ))}
              </div>
            )}
          </Section>

          <Section label={`Active streams (last 14 days, ${active.length})`}>
            <DataTable>
              <thead>
                <tr>
                  <th>Title</th><th>Tournament</th><th>Court</th><th>Day</th><th>State</th><th>Method</th><th>Views</th>
                </tr>
              </thead>
              <tbody>
                {active.map((s) => (
                  <tr key={s.youtube_video_id}>
                    <td>
                      <a
                        href={`https://www.youtube.com/watch?v=${s.youtube_video_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: 'var(--lime-text)', textDecoration: 'none' }}
                      >
                        {s.title ?? s.youtube_video_id}
                      </a>
                    </td>
                    <td>{s.tournaments?.name ?? '—'}</td>
                    <td>{s.court}</td>
                    <td>{s.day_date}</td>
                    <td>
                      {s.state === 'live'
                        ? <Pill tone="live" dot pulse>live</Pill>
                        : <Pill tone="lime">{s.state}</Pill>}
                    </td>
                    <td>{s.link_method}</td>
                    <td>{s.view_count ?? '—'}</td>
                  </tr>
                ))}
                {active.length === 0 && (
                  <tr><td colSpan={7} style={{ color: 'var(--text-3)', textAlign: 'center' }}>No active streams.</td></tr>
                )}
              </tbody>
            </DataTable>
          </Section>
        </>
      )}
    </div>
  )
}

function UnresolvedRow({
  item, tournaments, onResolve,
}: {
  item: UnresolvedItem
  tournaments: TournamentOption[]
  onResolve: (item: UnresolvedItem, tid: string, court: string, day: string) => void
}) {
  const [tid, setTid] = useState('')
  const [court, setCourt] = useState(item.parsed_court ?? '')
  const [day, setDay] = useState(item.first_seen_at.slice(0, 10))

  return (
    <Panel>
      <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
        {item.thumbnail_url && (
          <img src={item.thumbnail_url} alt="" style={{ width: 88, height: 50, borderRadius: 'var(--r-xs)' }} />
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>{item.title}</div>
          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
            Reason: <span style={{ color: 'var(--orange-text)' }}>{item.reason}</span>
            {' · '}Parsed: {item.parsed_tournament_name ?? '—'} / day {item.parsed_day ?? '—'} / {item.parsed_court ?? '—'}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <Field label="Tournament">
          <select className="ui-select" value={tid} onChange={(e) => setTid(e.target.value)} style={{ minWidth: 220 }}>
            <option value="">Pick a tournament...</option>
            {tournaments.map((t) => (
              <option key={t.id} value={t.id}>{t.name} ({t.level})</option>
            ))}
          </select>
        </Field>
        <Field label="Court">
          <input className="ui-input" value={court} onChange={(e) => setCourt(e.target.value)} placeholder="court (lowercase)" style={{ width: 140 }} />
        </Field>
        <Field label="Day">
          <input className="ui-input" value={day} onChange={(e) => setDay(e.target.value)} type="date" />
        </Field>
        <Button
          variant="primary"
          disabled={!tid || !court || !day}
          onClick={() => onResolve(item, tid, court, day)}
        >
          Resolve
        </Button>
      </div>
    </Panel>
  )
}

'use client'
// src/app/ops/FipStreamsTab.tsx
//
// Two sections: unresolved queue with inline resolve form + active
// streams read-only table. Auth via existing ops_token cookie.

import { useEffect, useState } from 'react'

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
      fetch('/api/ops/fip-streams/unresolved').then(r => r.json()),
      fetch('/api/ops/fip-streams/active').then(r => r.json()),
      // seed-entry-list returns { tournaments: [...] } — used for dropdown only
      fetch('/api/ops/seed-entry-list?action=list-tournaments').then(r => r.json()).catch(() => ({ tournaments: [] })),
    ])
    setUnresolved(un.items ?? [])
    setActive(ac.items ?? [])
    setTournaments(tn.tournaments ?? [])
    setLoading(false)
  }

  useEffect(() => { refresh() }, [])

  async function resolve(item: UnresolvedItem, tournamentId: string, court: string, dayDate: string) {
    const res = await fetch('/api/ops/fip-streams/resolve', {
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

  if (loading) return <div style={{ padding: 16 }}>Loading…</div>

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>
        Unresolved queue ({unresolved.length})
      </h2>
      {unresolved.length === 0 ? (
        <p style={{ color: '#6B7280', fontSize: 13 }}>Empty — all videos auto-matched.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {unresolved.map(item => (
            <UnresolvedRow key={item.id} item={item} tournaments={tournaments} onResolve={resolve} />
          ))}
        </div>
      )}

      <h2 style={{ fontSize: 16, fontWeight: 800, margin: '24px 0 8px' }}>
        Active streams (last 14 days, {active.length})
      </h2>
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', color: '#6B7280' }}>
            <th>Title</th><th>Tournament</th><th>Court</th><th>Day</th><th>State</th><th>Method</th><th>Views</th>
          </tr>
        </thead>
        <tbody>
          {active.map(s => (
            <tr key={s.youtube_video_id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <td style={{ padding: '6px 8px' }}>
                <a href={`https://www.youtube.com/watch?v=${s.youtube_video_id}`} target="_blank" rel="noopener noreferrer">
                  {s.title ?? s.youtube_video_id}
                </a>
              </td>
              <td>{s.tournaments?.name ?? '—'}</td>
              <td>{s.court}</td>
              <td>{s.day_date}</td>
              <td>{s.state}</td>
              <td>{s.link_method}</td>
              <td>{s.view_count ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
    <div style={{ background: '#141414', padding: 12, borderRadius: 6, border: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
        {item.thumbnail_url && (
          <img src={item.thumbnail_url} alt="" style={{ width: 88, height: 50, borderRadius: 4 }} />
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{item.title}</div>
          <div style={{ fontSize: 11, color: '#6B7280' }}>
            Reason: <span style={{ color: '#F5A623' }}>{item.reason}</span>
            {' · '}Parsed: {item.parsed_tournament_name ?? '—'} / day {item.parsed_day ?? '—'} / {item.parsed_court ?? '—'}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={tid} onChange={e => setTid(e.target.value)} style={{ flex: 1, minWidth: 200 }}>
          <option value="">Pick a tournament…</option>
          {tournaments.map(t => (
            <option key={t.id} value={t.id}>{t.name} ({t.level})</option>
          ))}
        </select>
        <input value={court} onChange={e => setCourt(e.target.value)} placeholder="court (lowercase)" style={{ width: 140 }} />
        <input value={day} onChange={e => setDay(e.target.value)} type="date" />
        <button
          disabled={!tid || !court || !day}
          onClick={() => onResolve(item, tid, court, day)}
          style={{ padding: '6px 12px', background: '#7ED321', color: '#000', fontWeight: 700, border: 0, borderRadius: 4 }}
        >
          Resolve
        </button>
      </div>
    </div>
  )
}

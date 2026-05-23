'use client'

import { useEffect, useState } from 'react'

interface Source {
  id: string
  key: string
  name: string
  source_type: string
  language: string
  cadence: string
  enabled: boolean
  articles_last_7d: number
  last_fetch_at: string | null
  last_fetch_status: string | null
  query_kind: string | null
}

export function SourcesTable() {
  const [rows, setRows] = useState<Source[] | null>(null)

  useEffect(() => {
    fetch('/api/news-sources').then(r => r.json()).then(d => setRows(d.sources ?? []))
  }, [])

  if (!rows) return <div style={{ color: '#888' }}>Loading...</div>
  if (rows.length === 0) return <div style={{ color: '#888' }}>No sources configured.</div>

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, color: '#fff' }}>
      <thead>
        <tr style={{ background: '#1A1A1A', textAlign: 'left' }}>
          {['Key', 'Name', 'Type', 'Lang', 'Cadence', 'Kind', 'Health', '7d', 'Enabled'].map(h => (
            <th key={h} style={{ padding: 8, fontWeight: 700, color: '#888' }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.id} style={{ borderBottom: '1px solid #2a2a2a' }}>
            <td style={{ padding: 8, fontFamily: 'monospace' }}>{r.key}</td>
            <td style={{ padding: 8 }}>{r.name}</td>
            <td style={{ padding: 8 }}>{r.source_type}</td>
            <td style={{ padding: 8 }}>{r.language}</td>
            <td style={{ padding: 8 }}>{r.cadence}</td>
            <td style={{ padding: 8, color: '#888' }}>{r.query_kind ?? '—'}</td>
            <td style={{ padding: 8 }}>
              <HealthDot status={r.last_fetch_status} lastFetch={r.last_fetch_at} />
            </td>
            <td style={{ padding: 8, textAlign: 'right' }}>{r.articles_last_7d}</td>
            <td style={{ padding: 8 }}>{r.enabled ? '✓' : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function HealthDot({ status, lastFetch }: { status: string | null; lastFetch: string | null }) {
  const now = Date.now()
  const lf = lastFetch ? Date.parse(lastFetch) : 0
  const ageH = (now - lf) / 3_600_000
  let color = '#666'
  if (status === 'success' && ageH < 2) color = '#7ED321'
  else if (status === 'error' && ageH < 24) color = '#F5A623'
  else if (ageH > 24 * 7) color = '#E53935'
  return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color }} />
}

'use client'

import { useEffect, useState, useCallback } from 'react'
import { EditSourceDrawer } from './EditSourceDrawer'
import { SourceFilters, type Filters } from './SourceFilters'

export interface Source {
  id: string
  key: string
  name: string
  url: string
  source_type: string
  language: string
  cadence: string
  weight: number
  lookback_days: number
  enabled: boolean
  articles_last_7d: number
  last_fetch_at: string | null
  last_fetch_status: string | null
  query_kind: string | null
  notes: string | null
  extraction_quality_pct: number | null
  auto_disabled_at: string | null
}

const HEALTH_BUCKETS = [
  { min: 80, max: 100, color: '#7ED321', label: 'healthy' },
  { min: 20, max: 79.99, color: '#F5A623', label: 'errors' },
  { min: 0, max: 19.99, color: '#E53935', label: 'low-yield' },
] as const

export function SourcesTable() {
  const [rows, setRows] = useState<Source[] | null>(null)
  const [filters, setFilters] = useState<Filters>({ type: 'all', lang: 'all', health: 'all', kind: 'all' })
  const [editing, setEditing] = useState<Source | null>(null)

  const refresh = useCallback(async () => {
    const r = await fetch('/api/news-sources')
    const d = await r.json()
    setRows(d.sources ?? [])
  }, [])

  useEffect(() => { refresh() }, [refresh])

  if (!rows) return <div style={{ color: '#888' }}>Loading...</div>

  const filtered = applyFilters(rows, filters)

  return (
    <>
      <SourceFilters value={filters} onChange={setFilters} total={rows.length} matched={filtered.length} />

      {filtered.length === 0 ? (
        <div style={{ color: '#888', padding: 16 }}>No sources match the current filters.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, color: '#fff' }}>
          <thead>
            <tr style={{ background: '#1A1A1A', textAlign: 'left' }}>
              {['Key', 'Name', 'Type', 'Lang', 'Cadence', 'Kind', 'Quality', 'Health', '7d', 'Enabled'].map(h => (
                <th key={h} style={{ padding: 8, fontWeight: 700, color: '#888' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.id}
                  onClick={() => setEditing(r)}
                  style={{ borderBottom: '1px solid #2a2a2a', cursor: 'pointer', opacity: r.enabled ? 1 : 0.5 }}>
                <td style={{ padding: 8, fontFamily: 'monospace' }}>{r.key}</td>
                <td style={{ padding: 8 }}>
                  {r.name}
                  {r.auto_disabled_at && (
                    <span style={{ marginLeft: 8, fontSize: 10, padding: '2px 6px', background: '#F5A62330', color: '#F5A623', borderRadius: 4 }}>
                      auto-disabled
                    </span>
                  )}
                </td>
                <td style={{ padding: 8 }}>{r.source_type}</td>
                <td style={{ padding: 8 }}>{r.language}</td>
                <td style={{ padding: 8 }}>{r.cadence}</td>
                <td style={{ padding: 8, color: '#888' }}>{r.query_kind ?? '—'}</td>
                <td style={{ padding: 8 }}><QualityDot pct={r.extraction_quality_pct} /></td>
                <td style={{ padding: 8 }}><HealthDot status={r.last_fetch_status} lastFetch={r.last_fetch_at} /></td>
                <td style={{ padding: 8, textAlign: 'right' }}>{r.articles_last_7d}</td>
                <td style={{ padding: 8 }}>{r.enabled ? '✓' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && (
        <EditSourceDrawer
          source={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await refresh() }}
          onDeleted={async () => { setEditing(null); await refresh() }}
        />
      )}
    </>
  )
}

function applyFilters(rows: Source[], f: Filters): Source[] {
  return rows.filter(r => {
    if (f.type !== 'all' && r.source_type !== f.type) return false
    if (f.lang !== 'all' && r.language !== f.lang) return false
    if (f.kind !== 'all' && (r.query_kind ?? 'static') !== f.kind) return false
    if (f.health === 'auto-disabled') return r.auto_disabled_at !== null
    if (f.health === 'healthy') return (r.extraction_quality_pct ?? 0) >= 80
    if (f.health === 'errors') return (r.extraction_quality_pct ?? 100) < 80 && r.auto_disabled_at === null
    return true
  })
}

function QualityDot({ pct }: { pct: number | null }) {
  if (pct == null) return <span title="Not enough data yet (<5 fetches in 30d)" style={dotStyle('#444')} />
  const bucket = HEALTH_BUCKETS.find(b => pct >= b.min && pct <= b.max) ?? HEALTH_BUCKETS[2]
  return (
    <span title={`${pct.toFixed(0)}% over last 30 days`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={dotStyle(bucket.color)} />
      <span style={{ fontSize: 11, color: '#aaa' }}>{pct.toFixed(0)}%</span>
    </span>
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
  return <span style={dotStyle(color)} />
}

function dotStyle(bg: string): React.CSSProperties {
  return { display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: bg }
}

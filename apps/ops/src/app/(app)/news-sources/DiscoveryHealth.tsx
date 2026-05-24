'use client'

import { useEffect, useState } from 'react'

interface Source {
  enabled: boolean
  query_kind: string | null
  articles_last_7d: number
  key: string
  name: string
}

interface QualityBucket { bucket: 'green' | 'orange' | 'red' | 'gray'; count: number }

interface Stats {
  total: number
  enabled: number
  static_: number
  dynamic: number
  deadIn7d: number
  topByVolume: Array<{ key: string; name: string; articles_last_7d: number }>
}

export function DiscoveryHealth() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [buckets, setBuckets] = useState<QualityBucket[]>([])
  const [disables, setDisables] = useState<Array<{ metadata: Record<string, unknown>; created_at: string }>>([])
  const [discoveries, setDiscoveries] = useState<Array<{ metadata: Record<string, unknown>; created_at: string }>>([])
  const [trends, setTrends] = useState<Array<{ key: string; name: string; daily: number[] }>>([])

  useEffect(() => {
    fetch('/api/news-sources/volume-trends')
      .then(r => r.json()).then(d => setTrends(d.trends ?? [])).catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/news-sources/quality-distribution')
      .then(r => r.json())
      .then(d => setBuckets(d.buckets ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/news-sources').then(r => r.json()).then(d => {
      const sources: Source[] = d.sources ?? []
      setStats({
        total: sources.length,
        enabled: sources.filter(s => s.enabled).length,
        static_: sources.filter(s => s.query_kind === 'static').length,
        dynamic: sources.filter(s => s.query_kind === 'player' || s.query_kind === 'tournament').length,
        deadIn7d: sources.filter(s => s.enabled && (s.articles_last_7d ?? 0) === 0).length,
        topByVolume: sources
          .slice()
          .sort((a, b) => b.articles_last_7d - a.articles_last_7d)
          .slice(0, 20),
      })
    })
  }, [])

  useEffect(() => {
    fetch('/api/news-sources/recent-events?kind=news_source.auto_disabled&limit=10')
      .then(r => r.json()).then(d => setDisables(d.events ?? [])).catch(() => {})
    fetch('/api/news-sources/recent-events?kind=news_source.ai_discovery.run&limit=5')
      .then(r => r.json()).then(d => setDiscoveries(d.events ?? [])).catch(() => {})
  }, [])

  if (!stats) return <div style={{ color: '#888' }}>Loading...</div>

  const bucketTotal = buckets.reduce((a, x) => a + x.count, 0) || 1

  return (
    <div>
      <section style={{ padding: '0 0 24px' }}>
        <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Quality distribution</h4>
        <div style={{ display: 'flex', gap: 4, height: 24 }}>
          {(['green', 'orange', 'red', 'gray'] as const).map(b => {
            const c = buckets.find(x => x.bucket === b)?.count ?? 0
            const color = { green: '#7ED321', orange: '#F5A623', red: '#E53935', gray: '#444' }[b]
            return c > 0 ? (
              <div key={b} title={`${b}: ${c}`} style={{ width: `${(c / bucketTotal) * 100}%`, background: color, color: '#000', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {c}
              </div>
            ) : null
          })}
        </div>
      </section>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 32 }}>
        <Stat label="Total"    value={stats.total} />
        <Stat label="Enabled"  value={stats.enabled} />
        <Stat label="Static"   value={stats.static_} />
        <Stat label="Dynamic"  value={stats.dynamic} />
        <Stat label="Dead 7d"  value={stats.deadIn7d} accent="#F5A623" />
      </div>
      <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: '#fff' }}>Top 20 by 7d volume</h2>
      <table style={{ width: '100%', fontSize: 12, color: '#fff' }}>
        <tbody>
          {stats.topByVolume.map(s => (
            <tr key={s.key} style={{ borderBottom: '1px solid #2a2a2a' }}>
              <td style={{ padding: 6, fontFamily: 'monospace', color: '#888' }}>{s.key}</td>
              <td style={{ padding: 6 }}>{s.name}</td>
              <td style={{ padding: 6, textAlign: 'right', fontWeight: 700 }}>{s.articles_last_7d}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section style={{ padding: 16 }}>
        <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#888', textTransform: 'uppercase' }}>Recent auto-disables</h4>
        {disables.length === 0 ? <div style={{ color: '#666', fontSize: 12 }}>None in the recent log.</div> : (
          <ul style={{ paddingLeft: 16, margin: 0, fontSize: 12, color: '#ccc' }}>
            {disables.map((e, i) => (
              <li key={i}>
                <strong>{String(e.metadata.source_name)}</strong> — {String(e.metadata.reason)}
                <span style={{ color: '#666', marginLeft: 8 }}>{new Date(e.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ padding: 16 }}>
        <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#888', textTransform: 'uppercase' }}>AI discovery runs</h4>
        {discoveries.length === 0 ? <div style={{ color: '#666', fontSize: 12 }}>No runs yet.</div> : (
          <table style={{ width: '100%', fontSize: 12, color: '#ccc' }}>
            <thead><tr style={{ color: '#666' }}><th align="left">Date</th><th align="left">Focus</th><th align="right">Found</th><th align="right">Kept</th><th align="right">Cost</th></tr></thead>
            <tbody>
              {discoveries.map((e, i) => (
                <tr key={i}>
                  <td>{new Date(e.created_at).toLocaleDateString()}</td>
                  <td>{String(e.metadata.focus)}</td>
                  <td align="right">{String(e.metadata.candidates_found)}</td>
                  <td align="right">{String(e.metadata.candidates_kept)}</td>
                  <td align="right">${(Number(e.metadata.cost_usd) || 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {trends.length > 0 && (
        <section style={{ padding: 16 }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#888', textTransform: 'uppercase' }}>30-day volume — top 10 sources</h4>
          {trends.map(t => (
            <div key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4, fontSize: 12 }}>
              <div style={{ width: 160, color: '#ccc', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{t.name}</div>
              <Sparkline values={t.daily} />
              <div style={{ width: 40, textAlign: 'right', color: '#888' }}>{t.daily.reduce((a, b) => a + b, 0)}</div>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

function Sparkline({ values, width = 200, height = 24 }: { values: number[]; width?: number; height?: number }) {
  const max = Math.max(1, ...values)
  const step = width / Math.max(1, values.length - 1)
  const points = values.map((v, i) => `${i * step},${height - (v / max) * height}`).join(' ')
  return (
    <svg width={width} height={height} style={{ background: '#1a1a1a' }}>
      <polyline points={points} fill="none" stroke="#7ED321" strokeWidth={1.5} />
    </svg>
  )
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div style={{ padding: 16, background: '#1A1A1A', clipPath: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)' }}>
      <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: accent ?? '#fff' }}>{value}</div>
    </div>
  )
}

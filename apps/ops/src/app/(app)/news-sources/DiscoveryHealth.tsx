'use client'

import { useEffect, useState } from 'react'
import { KpiStrip, Kpi, DataTable, Button } from '@/components/ui'

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
  const [disables, setDisables] = useState<Array<{ meta: Record<string, unknown>; created_at: string }>>([])
  const [discoveries, setDiscoveries] = useState<Array<{ meta: Record<string, unknown>; created_at: string }>>([])
  const [trends, setTrends] = useState<Array<{ key: string; name: string; daily: number[] }>>([])
  const [backfillRunning, setBackfillRunning] = useState(false)
  const [backfillResult, setBackfillResult] = useState<string | null>(null)

  const runBackfill = async () => {
    setBackfillRunning(true)
    setBackfillResult(null)
    try {
      const r = await fetch('/api/internal/trigger-translation-backfill', { method: 'POST' })
      const data = await r.json().catch(() => ({}))
      if (r.ok) {
        const count = data.updated_count ?? data.updated ?? data.count ?? 0
        const cost = data.cost_usd ?? 0
        setBackfillResult(`OK — translated ${count} articles${cost ? ` (cost: $${(cost as number).toFixed(2)})` : ''}`)
      } else {
        setBackfillResult(`Failed: ${(data as { error?: string }).error ?? r.status}`)
      }
    } catch (e) {
      setBackfillResult(`Error: ${(e as Error).message}`)
    } finally {
      setBackfillRunning(false)
    }
  }

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

  if (!stats) return <div style={{ color: 'var(--text-3)' }}>Loading...</div>

  const bucketTotal = buckets.reduce((a, x) => a + x.count, 0) || 1

  return (
    <div>
      <section style={{ padding: '0 0 24px' }}>
        <h4 style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Quality distribution</h4>
        <div style={{ display: 'flex', gap: 4, height: 24 }}>
          {(['green', 'orange', 'red', 'gray'] as const).map(b => {
            const c = buckets.find(x => x.bucket === b)?.count ?? 0
            const color = { green: 'var(--lime)', orange: 'var(--orange)', red: 'var(--live)', gray: 'var(--border-card)' }[b]
            return c > 0 ? (
              <div key={b} title={`${b}: ${c}`} style={{ width: `${(c / bucketTotal) * 100}%`, background: color, color: 'var(--lime-ink)', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {c}
              </div>
            ) : null
          })}
        </div>
      </section>
      <div style={{ marginBottom: 32 }}>
        <KpiStrip cols={5}>
          <Kpi label="Total"   value={stats.total} />
          <Kpi label="Enabled" value={stats.enabled} />
          <Kpi label="Static"  value={stats.static_} />
          <Kpi label="Dynamic" value={stats.dynamic} />
          <Kpi label="Dead 7d" value={stats.deadIn7d} tone="warn" />
        </KpiStrip>
      </div>
      <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: 'var(--text-1)' }}>Top 20 by 7d volume</h2>
      <DataTable>
        <tbody>
          {stats.topByVolume.map(s => (
            <tr key={s.key}>
              <td style={{ fontFamily: 'monospace', color: 'var(--text-3)' }}>{s.key}</td>
              <td>{s.name}</td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>{s.articles_last_7d}</td>
            </tr>
          ))}
        </tbody>
      </DataTable>

      <section style={{ padding: 16 }}>
        <h4 style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-3)', textTransform: 'uppercase' }}>Recent auto-disables</h4>
        {disables.length === 0 ? <div style={{ color: 'var(--text-3)', fontSize: 12 }}>None in the recent log.</div> : (
          <ul style={{ paddingLeft: 16, margin: 0, fontSize: 12, color: 'var(--text-1)' }}>
            {disables.map((e, i) => (
              <li key={i}>
                <strong>{String(e.meta.source_name)}</strong> — {String(e.meta.reason)}
                <span style={{ color: 'var(--text-3)', marginLeft: 8 }}>{new Date(e.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ padding: 16 }}>
        <h4 style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-3)', textTransform: 'uppercase' }}>AI discovery runs</h4>
        {discoveries.length === 0 ? <div style={{ color: 'var(--text-3)', fontSize: 12 }}>No runs yet.</div> : (
          <DataTable>
            <thead><tr><th align="left">Date</th><th align="left">Focus</th><th align="right">Found</th><th align="right">Kept</th><th align="right">Cost</th></tr></thead>
            <tbody>
              {discoveries.map((e, i) => (
                <tr key={i}>
                  <td>{new Date(e.created_at).toLocaleDateString()}</td>
                  <td>{String(e.meta.focus)}</td>
                  <td align="right">{String(e.meta.candidates_found)}</td>
                  <td align="right">{String(e.meta.candidates_kept)}</td>
                  <td align="right">${(Number(e.meta.cost_usd) || 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </section>

      <section style={{ padding: 16 }}>
        <h4 style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-3)', textTransform: 'uppercase' }}>Title translation backfill</h4>
        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px', lineHeight: 1.5 }}>
          Runs the backfill for older enriched articles whose title was never translated.
          Currently ~141 ES gaps + ~76 PT gaps. Approx $0.30 / 200 articles.
        </p>
        <Button
          variant="primary"
          onClick={runBackfill}
          disabled={backfillRunning}
        >
          {backfillRunning ? 'Running...' : 'Run title-translation backfill'}
        </Button>
        {backfillResult && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-3)' }}>
            {backfillResult}
          </div>
        )}
      </section>

      {trends.length > 0 && (
        <section style={{ padding: 16 }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-3)', textTransform: 'uppercase' }}>30-day volume — top 10 sources</h4>
          {trends.map(t => (
            <div key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4, fontSize: 12 }}>
              <div style={{ width: 160, color: 'var(--text-1)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{t.name}</div>
              <Sparkline values={t.daily} />
              <div style={{ width: 40, textAlign: 'right', color: 'var(--text-3)' }}>{t.daily.reduce((a, b) => a + b, 0)}</div>
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
    <svg width={width} height={height} style={{ background: 'var(--bg-card-2)' }}>
      <polyline points={points} fill="none" stroke="var(--lime)" strokeWidth={1.5} />
    </svg>
  )
}

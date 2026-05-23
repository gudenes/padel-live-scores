'use client'

import { useEffect, useState } from 'react'

interface Source {
  enabled: boolean
  query_kind: string | null
  articles_last_7d: number
  key: string
  name: string
}

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

  if (!stats) return <div style={{ color: '#888' }}>Loading...</div>

  return (
    <div>
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
    </div>
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

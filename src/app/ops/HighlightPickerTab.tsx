'use client'
// src/app/ops/HighlightPickerTab.tsx
//
// Read-only table of upcoming matches scored by matchQualityScore.
// The social/content team uses this to pick highlights. Sort by score
// desc by default; filter by time window, tier, category, min score.

import { useEffect, useState } from 'react'
import { playerShortName } from '@/lib/player-short-name'
import { roundLabel } from '@/lib/match-quality'

interface PlayerRef { name: string | null; ranking: number | null }
interface Item {
  matchId: string
  score: number
  breakdown: {
    score: number
    parity: number
    starDamper: number
    starBonus: number
    tierW: number
    roundW: number
    unrankedPenalty: number
  }
  round: string | null
  category: string | null
  scheduledAt: string | null
  court: string | null
  tournament: { id: string; name: string; level: string | null; country: string | null }
  pair1: PlayerRef[]
  pair2: PlayerRef[]
}

const TIER_OPTIONS = [
  { key: 'p1', label: 'P1' },
  { key: 'major', label: 'Major' },
  { key: 'p2', label: 'P2' },
  { key: 'premier_mens', label: 'Premier M' },
  { key: 'premier_womens', label: 'Premier W' },
  { key: 'fip_gold', label: 'FIP Gold' },
  { key: 'fip_silver', label: 'FIP Silver' },
  { key: 'fip_bronze', label: 'FIP Bronze' },
]

export default function HighlightPickerTab() {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [windowHours, setWindowHours] = useState<24 | 48 | 72>(24)
  const [tiers, setTiers] = useState<Set<string>>(new Set(TIER_OPTIONS.map(t => t.key)))
  const [category, setCategory] = useState<'all' | 'men' | 'women'>('all')
  const [minScore, setMinScore] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // Snapshot "now" on each refresh so formatScheduled stays pure during render
  // (react-hooks/purity bans Date.now() in render-phase code).
  const [nowMs, setNowMs] = useState(() => Date.now())

  // Data sync effect: refetches whenever filters change. The fetch is awaited
  // before any setState so we don't trip react-hooks/set-state-in-effect.
  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams()
    params.set('window', String(windowHours))
    if (category !== 'all') params.set('category', category)
    if (tiers.size < TIER_OPTIONS.length) params.set('tier', [...tiers].join(','))
    if (minScore > 0) params.set('minScore', String(minScore))
    ;(async () => {
      try {
        const r = await fetch(`/api/ops/highlight-picker?${params.toString()}`, { cache: 'no-store' })
        if (cancelled) return
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          if (cancelled) return
          setError(body.error || `HTTP ${r.status}`)
          setItems([])
        } else {
          const body = await r.json()
          if (cancelled) return
          setError(null)
          setItems(body.items ?? [])
          setNowMs(Date.now())
        }
      } catch (e) {
        if (cancelled) return
        setError((e as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [windowHours, category, minScore, tiers])

  const toggleTier = (key: string) => {
    setTiers(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const formatScheduled = (iso: string | null): string => {
    if (!iso) return '—'
    const d = new Date(iso)
    const deltaH = (d.getTime() - nowMs) / 3_600_000
    const local = d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
    if (deltaH < 1) return `${local} (<1h)`
    if (deltaH < 24) return `${local} (in ${Math.round(deltaH)}h)`
    return local
  }

  const renderPair = (pair: PlayerRef[]): string => {
    return pair
      .map(p => `${playerShortName(p.name)}${p.ranking ? ` #${p.ranking}` : ''}`)
      .join(' / ')
  }

  const tierBadgeColor = (level: string | null): { bg: string; fg: string } => {
    const l = (level || '').toLowerCase()
    if (l === 'p1') return { bg: '#fef3c7', fg: '#92400e' }
    if (l === 'major') return { bg: '#fde68a', fg: '#92400e' }
    if (l === 'p2' || l.startsWith('premier')) return { bg: '#dbeafe', fg: '#1e40af' }
    if (l === 'fip_gold') return { bg: '#fef9c3', fg: '#854d0e' }
    if (l === 'fip_silver') return { bg: '#e5e7eb', fg: '#374151' }
    if (l === 'fip_bronze') return { bg: '#fee2e2', fg: '#991b1b' }
    return { bg: '#f3f4f6', fg: '#374151' }
  }

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Highlight Picker</h2>
        <span style={{ fontSize: 12, color: '#666' }}>{loading ? 'loading…' : `${items.length} matches`}</span>
      </div>

      {/* Filters row */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ fontSize: 13 }}>
          Window:{' '}
          <select value={windowHours} onChange={e => setWindowHours(Number(e.target.value) as 24 | 48 | 72)} style={{ padding: '4px 8px' }}>
            <option value={24}>24h</option>
            <option value={48}>48h</option>
            <option value={72}>72h</option>
          </select>
        </label>

        <label style={{ fontSize: 13 }}>
          Category:{' '}
          <select value={category} onChange={e => setCategory(e.target.value as 'all' | 'men' | 'women')} style={{ padding: '4px 8px' }}>
            <option value="all">All</option>
            <option value="men">Men</option>
            <option value="women">Women</option>
          </select>
        </label>

        <label style={{ fontSize: 13 }}>
          Min score:{' '}
          <input
            type="range" min={0} max={100} value={minScore}
            onChange={e => setMinScore(Number(e.target.value))}
            style={{ verticalAlign: 'middle' }}
          />
          <span style={{ marginLeft: 6, fontVariantNumeric: 'tabular-nums' }}>{minScore}</span>
        </label>

        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {TIER_OPTIONS.map(t => (
            <button
              key={t.key}
              onClick={() => toggleTier(t.key)}
              style={{
                padding: '4px 10px', borderRadius: 12, border: '1px solid #ccc',
                background: tiers.has(t.key) ? '#111' : '#fff',
                color: tiers.has(t.key) ? '#fff' : '#666',
                cursor: 'pointer', fontSize: 11, fontWeight: 600,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ color: '#991b1b', background: '#fee2e2', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: 8, textAlign: 'right', width: 60 }}>Score</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Match</th>
              <th style={{ padding: 8, textAlign: 'left', width: 110 }}>Round</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Tournament</th>
              <th style={{ padding: 8, textAlign: 'left', width: 60 }}>Cat</th>
              <th style={{ padding: 8, textAlign: 'left', width: 160 }}>Scheduled</th>
              <th style={{ padding: 8, textAlign: 'left', width: 60 }}>Court</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => {
              const t = item.tournament
              const tb = tierBadgeColor(t.level)
              return (
                <tr key={item.matchId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td
                    style={{ padding: 8, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                    title={
                      `parity ${item.breakdown.parity.toFixed(2)}\n` +
                      `damper ${item.breakdown.starDamper.toFixed(2)}\n` +
                      `bonus ${item.breakdown.starBonus.toFixed(2)}\n` +
                      `tier ${item.breakdown.tierW.toFixed(2)}\n` +
                      `round ${item.breakdown.roundW.toFixed(2)}\n` +
                      `unranked penalty ${item.breakdown.unrankedPenalty}`
                    }
                  >
                    {item.score}
                  </td>
                  <td style={{ padding: 8 }}>
                    <a href={`/match/${item.matchId}`} target="_blank" rel="noopener noreferrer" style={{ color: '#111', textDecoration: 'underline' }}>
                      {renderPair(item.pair1)}  vs  {renderPair(item.pair2)}
                    </a>
                  </td>
                  <td style={{ padding: 8 }} title={item.round ?? undefined}>{roundLabel(item.round)}</td>
                  <td style={{ padding: 8 }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 6px', borderRadius: 4,
                      background: tb.bg, color: tb.fg, fontSize: 10, fontWeight: 700,
                      marginRight: 6,
                    }}>{t.level ?? '—'}</span>
                    {t.name}
                  </td>
                  <td style={{ padding: 8 }}>{item.category ?? '—'}</td>
                  <td style={{ padding: 8 }}>{formatScheduled(item.scheduledAt)}</td>
                  <td style={{ padding: 8 }}>{item.court ?? '—'}</td>
                </tr>
              )
            })}
            {!loading && items.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 16, textAlign: 'center', color: '#999' }}>No upcoming matches matched your filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

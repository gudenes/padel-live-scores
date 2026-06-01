'use client'
// apps/ops/src/app/(app)/highlights/_components/HighlightPickerTab.tsx
//
// Read-only table of upcoming matches scored by matchQualityScore.
// The social/content team uses this to pick highlights. Sort by score
// desc by default; filter by time window, tier, category, min score.

import { useEffect, useState } from 'react'
import { playerShortName } from '@/lib/player-short-name'
import { roundLabel } from '@/lib/match-quality'
import { PageHeader, Field, Pill, DataTable } from '@/components/ui'

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
        const r = await fetch(`/api/internal/highlight-picker?${params.toString()}`, { cache: 'no-store' })
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

  const tierTone = (level: string | null): 'lime' | 'warn' | 'live' | 'neutral' => {
    const l = (level || '').toLowerCase()
    if (l === 'p1' || l === 'major' || l === 'fip_gold') return 'warn'
    if (l === 'p2' || l.startsWith('premier')) return 'lime'
    if (l === 'fip_bronze') return 'live'
    return 'neutral'
  }

  return (
    <div className="ui-page">
      <PageHeader
        title="Highlights"
        subtitle={loading ? 'loading…' : `${items.length} matches`}
      />

      {/* Filters row */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Window">
          <select className="ui-select" value={windowHours} onChange={e => setWindowHours(Number(e.target.value) as 24 | 48 | 72)}>
            <option value={24}>24h</option>
            <option value={48}>48h</option>
            <option value={72}>72h</option>
          </select>
        </Field>

        <Field label="Category">
          <select className="ui-select" value={category} onChange={e => setCategory(e.target.value as 'all' | 'men' | 'women')}>
            <option value="all">All</option>
            <option value="men">Men</option>
            <option value="women">Women</option>
          </select>
        </Field>

        <Field label="Min score">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 33 }}>
            <input
              type="range" min={0} max={100} value={minScore}
              onChange={e => setMinScore(Number(e.target.value))}
              style={{ verticalAlign: 'middle' }}
            />
            <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-2)' }}>{minScore}</span>
          </div>
        </Field>

        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {TIER_OPTIONS.map(t => (
            <button
              key={t.key}
              onClick={() => toggleTier(t.key)}
              className="ui-btn"
              data-variant={tiers.has(t.key) ? 'primary' : 'ghost'}
              data-size="sm"
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ color: 'var(--live-text)', background: 'var(--live-bg)', border: '1px solid var(--live-border)', padding: 10, borderRadius: 'var(--r-sm)', marginBottom: 12, fontSize: 13 }}>
          {error}
        </div>
      )}

      <DataTable>
        <thead>
          <tr>
            <th style={{ textAlign: 'right', width: 60 }}>Score</th>
            <th>Match</th>
            <th style={{ width: 110 }}>Round</th>
            <th>Tournament</th>
            <th style={{ width: 60 }}>Cat</th>
            <th style={{ width: 160 }}>Scheduled</th>
            <th style={{ width: 60 }}>Court</th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => {
            const t = item.tournament
            return (
              <tr key={item.matchId}>
                <td
                  style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
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
                <td>
                  <a href={`/match/${item.matchId}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-1)', textDecoration: 'underline' }}>
                    {renderPair(item.pair1)}  vs  {renderPair(item.pair2)}
                  </a>
                </td>
                <td title={item.round ?? undefined}>{roundLabel(item.round)}</td>
                <td>
                  <span style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: 6 }}>
                    <Pill tone={tierTone(t.level)}>{t.level ?? '—'}</Pill>
                  </span>
                  {t.name}
                </td>
                <td>{item.category ?? '—'}</td>
                <td>{formatScheduled(item.scheduledAt)}</td>
                <td>{item.court ?? '—'}</td>
              </tr>
            )
          })}
          {!loading && items.length === 0 && (
            <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-3)' }}>No upcoming matches matched your filters.</td></tr>
          )}
        </tbody>
      </DataTable>
    </div>
  )
}

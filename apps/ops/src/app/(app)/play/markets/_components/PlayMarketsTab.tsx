'use client'

// Play → Markets. Every market a template actually created.
// Read-only: markets are generated, never authored, and their config is frozen
// at creation. Operator actions on a market live on the Resolution page.

import { useCallback, useEffect, useState } from 'react'
import { PageHeader, Panel, Pill, DataTable, EmptyState, Skeleton } from '@/components/ui'

type Market = {
  id: string
  publicId: string
  templateKey: string
  question: string
  subject: string
  tournament: string | null
  level: string | null
  round: string | null
  category: string | null
  matchStatus: string | null
  price: number | null
  seedProb: number | null
  deltaPts: number | null
  volume: number
  positions: number
  status: string
  locksAt: string | null
  outcome: boolean | null
  holdReason: string | null
  voidReason: string | null
}

const STATUS_TONE: Record<string, 'lime' | 'neutral' | 'warn' | 'live'> = {
  open: 'lime',
  locked: 'neutral',
  proposed: 'warn',
  held: 'live',
  settled: 'neutral',
  void: 'live',
}

const FILTERS = ['all', 'open', 'locked', 'proposed', 'held', 'settled', 'void'] as const

function fmtWhen(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.toISOString().slice(5, 10)} ${d.toISOString().slice(11, 16)}`
}

export default function PlayMarketsTab() {
  const [markets, setMarkets] = useState<Market[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/internal/play-markets', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setMarkets(json.markets ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    // Markets appear on the generator's :21 tick and change state as matches
    // play, so a static snapshot goes stale while you are looking at it.
    const t = setInterval(() => void load(), 30_000)
    return () => clearInterval(t)
  }, [load])

  const shown = filter === 'all' ? markets : markets.filter((m) => m.status === filter)
  const counts = Object.fromEntries(
    FILTERS.map((f) => [f, f === 'all' ? markets.length : markets.filter((m) => m.status === f).length]),
  ) as Record<string, number>

  const held = markets.filter((m) => m.status === 'held').length
  const exposure = markets.reduce((a, m) => a + m.volume, 0)

  return (
    <div className="ui-page">
      <PageHeader
        title="Markets"
        subtitle="Every market a template actually created. You don't author rows here — you find one, watch it, or act on it from Resolution."
        actions={
          <button className="ui-btn" data-size="sm" onClick={() => void load()}>
            Refresh
          </button>
        }
      />

      {held > 0 ? (
        <>
          <Panel>
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <Pill tone="live" dot>
                {held} held
              </Pill>
              <div style={{ fontSize: 12.5, lineHeight: 1.65, color: 'var(--text-2)' }}>
                A held market had its resolver answer <strong>change</strong> after proposing —
                it will never auto-settle and is waiting for an operator. This is the state that
                exists because upstream has marked a match finished with the wrong winner before.
              </div>
            </div>
          </Panel>
          <div style={{ height: 18 }} />
        </>
      ) : null}

      {error ? (
        <>
          <Panel>
            <div style={{ color: 'var(--live-text)', fontSize: 13 }}>{error}</div>
          </Panel>
          <div style={{ height: 18 }} />
        </>
      ) : null}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        {FILTERS.map((f) => (
          <button
            key={f}
            className="ui-chip"
            data-on={filter === f}
            onClick={() => setFilter(f)}
          >
            {f} · {counts[f] ?? 0}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-3)' }}>
          exposure {exposure.toLocaleString('en-US')} G · auto-refreshing
        </span>
      </div>

      {loading ? (
        <Panel>
          <Skeleton rows={4} />
        </Panel>
      ) : shown.length === 0 ? (
        <EmptyState
          title={markets.length === 0 ? 'No markets yet' : `No ${filter} markets`}
          hint={
            markets.length === 0
              ? 'The generator creates these on its :21 tick, and only when a template is enabled and MARKET_GENERATOR_DRY_RUN is false.'
              : 'Try another filter.'
          }
        />
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th style={{ width: '32%' }}>Market</th>
              <th>Template</th>
              <th>Crowd / model</th>
              <th style={{ textAlign: 'right' }}>Volume</th>
              <th style={{ textAlign: 'right' }}>Pos.</th>
              <th>Locks</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => {
              const hot = m.deltaPts !== null && Math.abs(m.deltaPts) >= 12
              return (
                <tr key={m.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{m.question}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 3 }}>
                      {m.subject}
                      {m.round ? ` · ${m.round}` : ''}
                      {m.category ? ` · ${m.category}` : ''}
                      {m.tournament ? ` · ${m.tournament}` : ''}
                    </div>
                  </td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>{m.templateKey}</td>
                  <td>
                    <span className="tabular" style={{ fontWeight: 700, fontSize: 14 }}>
                      {m.price !== null ? m.price.toFixed(2) : '—'}
                    </span>
                    <span className="tabular" style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                      {' '}/ {m.seedProb !== null ? m.seedProb.toFixed(2) : '—'}
                    </span>
                    {m.deltaPts !== null ? (
                      <div
                        className="tabular"
                        style={{
                          fontSize: 11.5,
                          fontWeight: 700,
                          color: hot ? 'var(--orange-text)' : 'var(--text-3)',
                        }}
                      >
                        {m.deltaPts >= 0 ? '+' : ''}
                        {m.deltaPts} pts{hot ? ' ⚠' : ''}
                      </div>
                    ) : null}
                  </td>
                  <td className="tabular" style={{ textAlign: 'right' }}>
                    {m.volume.toLocaleString('en-US')}
                  </td>
                  <td className="tabular" style={{ textAlign: 'right' }}>
                    {m.positions || '—'}
                  </td>
                  <td style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{fmtWhen(m.locksAt)}</td>
                  <td>
                    <Pill tone={STATUS_TONE[m.status] ?? 'neutral'}>{m.status}</Pill>
                    {m.status === 'settled' && m.outcome !== null ? (
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                        {m.outcome ? 'YES' : 'NO'}
                      </div>
                    ) : null}
                    {m.holdReason ? (
                      <div style={{ fontSize: 11, color: 'var(--live-text)', marginTop: 4 }}>
                        {m.holdReason}
                      </div>
                    ) : null}
                    {m.voidReason ? (
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                        {m.voidReason}
                      </div>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </DataTable>
      )}

      <p className="hint" style={{ marginTop: 14, fontSize: 11.5, color: 'var(--text-3)' }}>
        <strong>Crowd / model</strong> is the current LMSR price against the probability the market
        opened at. A gap past ±12 points is flagged — it is either an edge worth learning from, a
        model that is wrong, or one account pushing a thin market, and all three are worth a look.
      </p>
    </div>
  )
}

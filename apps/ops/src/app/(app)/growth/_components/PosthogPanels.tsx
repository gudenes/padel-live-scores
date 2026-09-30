// Server component: renders the PostHog-backed panels from a snapshot.
// Colors are theme tokens only (light + dark).

import { Panel, EmptyState } from '@/components/ui'
import {
  FUNNEL_STEPS, buildRetentionMatrix, pct,
  type DailyPoint, type MetricRow,
} from '@/lib/growth/growth-compute'
import { ActiveUsersChart } from './ActiveUsersChart'

const card = { fontSize: 12, color: 'var(--text-4)', marginTop: 8 } as const

export function PosthogPanels({
  day, rows, dau,
}: { day: string; rows: MetricRow[]; dau: DailyPoint[] }) {
  const val = (metric: string, dimension = '') =>
    rows.find(r => r.metric === metric && r.dimension === dimension)?.value ?? 0

  const funnel = FUNNEL_STEPS.map(s => ({ ...s, n: val('funnel', s.key) }))
  const top = Math.max(funnel[0]?.n ?? 0, 1)

  const channels = rows.filter(r => r.metric === 'channel').sort((a, b) => b.value - a.value)
  const channelTotal = channels.reduce((a, r) => a + r.value, 0)
  const countries = rows.filter(r => r.metric === 'country').sort((a, b) => b.value - a.value)
  const countryTotal = countries.reduce((a, r) => a + r.value, 0)
  const matrix = buildRetentionMatrix(rows, day)

  const bar = (p: number) => (
    <div style={{ height: 10, background: 'var(--track)', borderRadius: 5, overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(p, 100)}%`, height: '100%', background: 'var(--lime)' }} />
    </div>
  )

  return (
    <>
      <div className="growth-grid" style={{ marginTop: 14 }}>
        <Panel title="Daily active users · 30 days">
          {dau.length === 0 ? <EmptyState title="No daily data yet." /> : <ActiveUsersChart data={dau} />}
          <div style={card}>Web + installed PWA. Native app sessions are counted as separate anonymous people.</div>
        </Panel>

        <Panel title="Acquisition funnel · 30d">
          <div style={{ display: 'grid', gap: 10 }}>
            {funnel.map((s, i) => (
              <div key={s.key} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 104px', gap: 10, alignItems: 'center', fontSize: 13 }}>
                <span style={{ color: 'var(--text-2)' }}>{s.label}</span>
                {bar((s.n / top) * 100)}
                <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-2)' }}>
                  {s.n.toLocaleString()}{' '}
                  <span style={{ color: 'var(--text-4)' }}>{i > 0 ? `${pct(s.n, funnel[i - 1].n)}%` : ''}</span>
                </span>
              </div>
            ))}
          </div>
          <div style={card}>Visitors from PostHog; later steps are users who signed up in the window (Supabase).</div>
        </Panel>
      </div>

      <div style={{ marginTop: 14 }}>
        <Panel title="Weekly retention cohorts · anonymous visitors">
          {matrix.length === 0 ? (
            <EmptyState title="No cohorts yet." hint="Retention needs a few weeks of snapshots to fill in." />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'separate', borderSpacing: 3, fontSize: 12, width: '100%' }}>
                <thead>
                  <tr style={{ color: 'var(--text-3)' }}>
                    <th style={{ textAlign: 'left', fontWeight: 500 }}>Cohort (week of)</th>
                    <th style={{ fontWeight: 500 }}>People</th>
                    {matrix[0].pcts.map((_, n) => <th key={n} style={{ fontWeight: 500 }}>W{n}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {matrix.map(c => (
                    <tr key={c.cohort}>
                      <td style={{ color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{c.cohort}</td>
                      <td style={{ textAlign: 'center', color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>{c.size.toLocaleString()}</td>
                      {c.pcts.map((p, n) => (
                        <td
                          key={n}
                          style={{
                            textAlign: 'center',
                            borderRadius: 5,
                            padding: '5px 4px',
                            minWidth: 44,
                            fontVariantNumeric: 'tabular-nums',
                            color: p == null ? 'var(--text-4)' : 'var(--text-1)',
                            // token-based tint: lime at variable strength over the card
                            background: p == null ? 'transparent' : `color-mix(in srgb, var(--lime) ${Math.round(8 + p * 0.6)}%, transparent)`,
                          }}
                        >
                          {p == null ? '·' : `${p}%`}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={card}>
            Active = a pageview on matches, tournaments, rankings, players or the feed. Web + PWA only; native
            iOS/Android can&apos;t be tracked across sessions. The oldest cohort includes returning users. About 99% of
            anonymous visitors are seen on a single day, so this is low by nature; logged-in users (tiles above) return far more.
          </div>
        </Panel>
      </div>

      <div className="growth-grid" style={{ marginTop: 14 }}>
        <Panel title="Traffic by channel · 30d">
          {channels.length === 0 ? <EmptyState title="No data." /> : (
            <div style={{ display: 'grid', gap: 10 }}>
              {channels.map(c => (
                <div key={c.dimension} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 60px', gap: 10, alignItems: 'center', fontSize: 13 }}>
                  <span style={{ color: 'var(--text-2)' }}>{c.dimension}</span>
                  {bar(pct(c.value, channelTotal))}
                  <span style={{ textAlign: 'right', color: 'var(--text-2)' }}>{pct(c.value, channelTotal)}%</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Top countries · 30d">
          {countries.length === 0 ? <EmptyState title="No data." /> : (
            <div style={{ display: 'grid', gap: 10 }}>
              {countries.map(c => (
                <div key={c.dimension} style={{ display: 'grid', gridTemplateColumns: '50px 1fr 60px', gap: 10, alignItems: 'center', fontSize: 13 }}>
                  <span style={{ color: 'var(--text-2)' }}>{c.dimension}</span>
                  {bar(pct(c.value, countryTotal))}
                  <span style={{ textAlign: 'right', color: 'var(--text-2)' }}>{pct(c.value, countryTotal)}%</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </>
  )
}

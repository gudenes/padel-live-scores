// apps/ops/src/app/(app)/today/_components/WinProbChart.tsx
'use client'
import {
  ComposedChart, Area, Line, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, ReferenceDot,
} from 'recharts'
import type { Match } from '../_lib/types'

// ms → "HH:MM" clock label (browser-local; this is a client component).
function clock(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function pressureLabel(s: Match['winProbSeries'][number]): string | null {
  const tags: string[] = []
  if (s.isBreakPoint) tags.push('BP')
  if (s.isSetPoint) tags.push('SP')
  if (s.isMatchPoint) tags.push('MP')
  return tags.length ? tags.join(' · ') : null
}

export function WinProbChart({ match }: { match: Match }) {
  if (match.winProbSeries.length < 2) {
    return <div className="sb-chart-empty">No live probability history yet.</div>
  }

  const data = match.winProbSeries.map((s) => ({
    t: s.atMs,
    p1: s.pair1Prob * 100,
    p2: (1 - s.pair1Prob) * 100,
    score: s.score ?? null,
    serverPair: s.serverPair ?? null,
    tag: pressureLabel(s),
    isBreakPoint: Boolean(s.isBreakPoint),
    isSetPoint: Boolean(s.isSetPoint),
    isMatchPoint: Boolean(s.isMatchPoint),
  }))
  const bpDots = data.filter((d) => d.isBreakPoint && !d.isSetPoint && !d.isMatchPoint)
  const spDots = data.filter((d) => d.isSetPoint && !d.isMatchPoint)
  const mpDots = data.filter((d) => d.isMatchPoint)
  const lastT = data[data.length - 1].t
  const lastP1 = data[data.length - 1].p1
  const prematchPct = match.prematch != null ? match.prematch.pair1Prob * 100 : null

  return (
    <div>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickCount={5}
            tickFormatter={clock}
            fontSize={10}
            stroke="var(--text-3)"
          />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(v) => `${v}%`}
            fontSize={10}
            stroke="var(--text-3)"
            width={36}
          />
          {/* even (50%) reference */}
          <ReferenceLine y={50} strokeDasharray="4 4" stroke="var(--border-card)" />
          {/* pre-match anchor */}
          {prematchPct != null && (
            <ReferenceLine
              y={prematchPct}
              strokeDasharray="2 2"
              stroke="var(--text-3)"
              label={{
                value: `pre-match ${Math.round(prematchPct)}%`,
                position: 'insideTopLeft',
                fontSize: 10,
                fill: 'var(--text-3)',
              }}
            />
          )}
          {/* pair1 — primary */}
          <Area
            type="monotone"
            dataKey="p1"
            stroke="var(--lime)"
            fill="var(--lime)"
            fillOpacity={0.15}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          {/* pair2 — muted secondary */}
          <Line
            type="monotone"
            dataKey="p2"
            stroke="var(--text-3)"
            strokeWidth={1}
            dot={false}
            isAnimationActive={false}
          />
          {/* current-value marker on pair1 */}
          <ReferenceDot
            x={lastT}
            y={lastP1}
            r={4}
            fill="var(--lime)"
            stroke="var(--lime)"
            label={{
              value: `${Math.round(lastP1)}%`,
              position: 'right',
              fontSize: 11,
              fontWeight: 700,
              fill: 'var(--lime)',
            }}
          />
          <Scatter data={bpDots} dataKey="p1" fill="#e8a317" name="BP" r={3} isAnimationActive={false} />
          <Scatter data={spDots} dataKey="p1" fill="#4ea3f0" name="SP" r={4} isAnimationActive={false} />
          <Scatter data={mpDots} dataKey="p1" fill="#e85d5d" name="MP" r={5} isAnimationActive={false} />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const row = payload[0]?.payload as (typeof data)[number] | undefined
              const serve =
                row?.serverPair === 1 ? match.pair1.name : row?.serverPair === 2 ? match.pair2.name : null
              return (
                <div className="sb-chart-tip">
                  <div className="sb-chart-tip-time">{clock(Number(label))}</div>
                  {row?.score ? <div className="sb-chart-tip-score">{row.score}</div> : null}
                  {serve ? <div className="sb-chart-tip-serve">{serve} serving</div> : null}
                  {row?.tag ? <div className="sb-chart-tip-tag">{row.tag}</div> : null}
                  <div>{match.pair1.name} {row ? `${row.p1.toFixed(0)}%` : '—'}</div>
                  <div>{match.pair2.name} {row ? `${row.p2.toFixed(0)}%` : '—'}</div>
                </div>
              )
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="sb-chart-cap">
        <span className="sb-chart-cap-item">
          <i className="sb-chart-cap-swatch sb-chart-cap-p1" /> {match.pair1.name}
        </span>
        <span className="sb-chart-cap-item">
          <i className="sb-chart-cap-swatch sb-chart-cap-p2" /> {match.pair2.name}
        </span>
        <span className="sb-chart-cap-item"><i className="sb-chart-cap-dot" style={{ background: '#e8a317' }} /> BP</span>
        <span className="sb-chart-cap-item"><i className="sb-chart-cap-dot" style={{ background: '#4ea3f0' }} /> SP</span>
        <span className="sb-chart-cap-item"><i className="sb-chart-cap-dot" style={{ background: '#e85d5d' }} /> MP</span>
      </div>
    </div>
  )
}

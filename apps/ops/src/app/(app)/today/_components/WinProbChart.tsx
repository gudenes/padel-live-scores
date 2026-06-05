// apps/ops/src/app/(app)/today/_components/WinProbChart.tsx
'use client'
import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, ReferenceDot,
} from 'recharts'
import type { Match } from '../_lib/types'

// ms → "HH:MM" clock label (browser-local; this is a client component).
function clock(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function WinProbChart({ match }: { match: Match }) {
  if (match.winProbSeries.length < 2) {
    return <div className="sb-chart-empty">No live probability history yet.</div>
  }

  const data = match.winProbSeries.map((s) => ({
    t: s.atMs,
    p1: s.pair1Prob * 100,
    p2: (1 - s.pair1Prob) * 100,
  }))
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
          <Tooltip
            labelFormatter={(label) => clock(Number(label))}
            formatter={(value, name) => {
              const pct = typeof value === 'number' ? `${value.toFixed(0)}%` : String(value)
              const who = name === 'p1' ? match.pair1.name : match.pair2.name
              return [pct, who]
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
      </div>
    </div>
  )
}

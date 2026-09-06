// apps/ops/src/app/(app)/today/_components/WinProbChart.tsx
'use client'
import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, ReferenceDot,
} from 'recharts'
import type { Match } from '../_lib/types'
import { pressureOnsets, setBoundaryTimes } from '../_lib/score-timeline'

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

  const onsets = pressureOnsets(match.winProbSeries)
  const data = match.winProbSeries.map((s, i) => {
    const p1 = s.pair1Prob * 100
    const mark = onsets[i]!
    return {
      t: s.atMs,
      p1,
      p2: (1 - s.pair1Prob) * 100,
      score: s.score ?? null,
      serverPair: s.serverPair ?? null,
      tag: pressureLabel(s),
      setsCompleted: s.setsCompleted ?? 0,
      bp: mark.bp ? p1 : null,
      sp: mark.sp ? p1 : null,
      mp: mark.mp ? p1 : null,
    }
  })
  const setEnds = setBoundaryTimes(data.map((d) => ({ atMs: d.t, setsCompleted: d.setsCompleted })))
  if (match.status === 'finished' && data.length) {
    const last = data[data.length - 1].t
    if (!setEnds.includes(last)) setEnds.push(last)
  }
  const lastT = data[data.length - 1].t
  const lastP1 = data[data.length - 1].p1
  const prematchPct = match.prematch != null ? match.prematch.pair1Prob * 100 : null

  return (
    <div>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data} margin={{ top: 18, right: 16, bottom: 4, left: 0 }}>
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            minTickGap={28}
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
          {setEnds.map((t, i) => (
            <ReferenceLine
              key={t}
              x={t}
              stroke="var(--text-3)"
              strokeDasharray="3 3"
              strokeOpacity={0.55}
              label={{
                value: `Set ${i + 1}`,
                position: 'insideTopRight',
                fontSize: 10,
                fill: 'var(--text-3)',
              }}
            />
          ))}
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
          <Line type="linear" dataKey="bp" stroke="none" dot={{ r: 3, fill: '#e8a317', strokeWidth: 0 }} connectNulls={false} isAnimationActive={false} legendType="none" />
          <Line type="linear" dataKey="sp" stroke="none" dot={{ r: 4, fill: '#4ea3f0', strokeWidth: 0 }} connectNulls={false} isAnimationActive={false} legendType="none" />
          <Line type="linear" dataKey="mp" stroke="none" dot={{ r: 5, fill: '#e85d5d', strokeWidth: 0 }} connectNulls={false} isAnimationActive={false} legendType="none" />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const row = payload[0]?.payload as (typeof data)[number] | undefined
              const serve =
                row?.serverPair === 1 ? match.pair1.name : row?.serverPair === 2 ? match.pair2.name : null
              return (
                <div className="sb-chart-tip">
                  <div className="sb-chart-tip-time">{clock(Number(label))}</div>
                  {row?.score ? (
                    <div className="sb-chart-tip-score">
                      <span className="sb-chart-tip-score-lab">Score</span> {row.score}
                    </div>
                  ) : null}
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

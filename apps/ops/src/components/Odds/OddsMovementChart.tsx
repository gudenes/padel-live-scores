'use client'

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'

export interface OddsMovementSeries {
  name: string
  color: string
  points: Array<{ t: string; value: number }> // t = ISO timestamp
}

export function OddsMovementChart({
  series,
  yLabel = 'Probability',
  yDomain = [0, 1] as [number, number],
}: {
  series: OddsMovementSeries[]
  yLabel?: string
  yDomain?: [number, number]
}) {
  if (series.length === 0 || series.every((s) => s.points.length < 2)) {
    return (
      <div style={{ padding: 24, color: 'var(--text-3)', textAlign: 'center', fontSize: 13 }}>
        Insufficient snapshot history. Check back after a few hourly snapshots accumulate.
      </div>
    )
  }
  // Build a single data array keyed by timestamp
  const tSet = new Set<string>()
  for (const s of series) for (const p of s.points) tSet.add(p.t)
  const allT = [...tSet].sort()
  const data = allT.map((t) => {
    const row: Record<string, number | string> = { t: t.slice(5, 16).replace('T', ' ') }
    for (const s of series) {
      const p = s.points.find((q) => q.t === t)
      if (p) row[s.name] = p.value
    }
    return row
  })

  return (
    <ResponsiveContainer width='100%' height={320}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray='3 3' stroke='var(--border-inner)' />
        <XAxis dataKey='t' fontSize={11} stroke='var(--text-3)' />
        <YAxis
          domain={yDomain}
          fontSize={11}
          stroke='var(--text-3)'
          tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
          label={{ value: yLabel, angle: -90, position: 'insideLeft', fill: 'var(--text-3)' }}
        />
        <Tooltip formatter={(v) => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : String(v))} />
        <Legend />
        {series.map((s) => (
          <Line
            key={s.name}
            type='monotone'
            dataKey={s.name}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

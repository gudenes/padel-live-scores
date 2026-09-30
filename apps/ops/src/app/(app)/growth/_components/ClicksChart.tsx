'use client'

// Organic search clicks line chart with a hover tooltip (date + clicks).
// Colors are CSS variables so it follows the light/dark theme.

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export interface ClickPoint { day: string; clicks: number }

const shortDay = (d: string) => d.slice(5) // MM-DD

export function ClicksChart({ data }: { data: ClickPoint[] }) {
  return (
    <div style={{ width: '100%', height: 150 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="var(--border-inner)" vertical={false} />
          <XAxis
            dataKey="day"
            tickFormatter={shortDay}
            tick={{ fill: 'var(--text-3)', fontSize: 11 }}
            axisLine={{ stroke: 'var(--border)' }}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={32}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: 'var(--text-3)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ stroke: 'var(--border)' }}
            contentStyle={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-card)',
              borderRadius: 8,
              color: 'var(--text-1)',
              fontSize: 12,
            }}
            labelStyle={{ color: 'var(--text-3)' }}
            formatter={(v) => [v as number, 'Clicks']}
          />
          <Line
            type="monotone"
            dataKey="clicks"
            stroke="var(--lime)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: 'var(--lime)', stroke: 'var(--bg-card)' }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

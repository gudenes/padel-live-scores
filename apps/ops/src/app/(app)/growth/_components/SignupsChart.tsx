'use client'

// Daily signups bar chart. Colors are CSS variables so it follows the
// light/dark theme with no JS theme awareness.

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export interface SignupPoint { day: string; n: number }

const shortDay = (d: string) => d.slice(5) // MM-DD

export function SignupsChart({ data }: { data: SignupPoint[] }) {
  return (
    <div style={{ width: '100%', height: 240 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="var(--border-inner)" vertical={false} />
          <XAxis
            dataKey="day"
            tickFormatter={shortDay}
            tick={{ fill: 'var(--text-3)', fontSize: 11 }}
            axisLine={{ stroke: 'var(--border)' }}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: 'var(--text-3)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: 'var(--bg-hover)' }}
            contentStyle={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-card)',
              borderRadius: 8,
              color: 'var(--text-1)',
              fontSize: 12,
            }}
            labelStyle={{ color: 'var(--text-3)' }}
            formatter={(v) => [v as number, 'Signups']}
          />
          <Bar dataKey="n" fill="var(--lime)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

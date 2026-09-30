'use client'

// Daily active persons line chart (PostHog). Theme-token colors only.

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export interface ActivePoint { day: string; n: number }

export function ActiveUsersChart({ data }: { data: ActivePoint[] }) {
  return (
    <div style={{ width: '100%', height: 220 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid stroke="var(--border-inner)" vertical={false} />
          <XAxis
            dataKey="day"
            tickFormatter={(d: string) => d.slice(5)}
            tick={{ fill: 'var(--text-3)', fontSize: 11 }}
            axisLine={{ stroke: 'var(--border)' }}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis allowDecimals={false} tick={{ fill: 'var(--text-3)', fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 8, color: 'var(--text-1)', fontSize: 12 }}
            labelStyle={{ color: 'var(--text-3)' }}
            formatter={(v) => [v as number, 'Daily active']}
          />
          <Line type="monotone" dataKey="n" stroke="var(--lime)" strokeWidth={2.2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

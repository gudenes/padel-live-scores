import type { CSSProperties, ReactNode } from 'react'

type Tone = 'lime' | 'live' | 'warn' | 'urgent' | 'neutral'

const TONE_VAR: Record<Tone, string> = {
  lime: 'var(--lime)',
  live: 'var(--live)',
  warn: 'var(--orange)',
  urgent: 'var(--live)',
  neutral: 'var(--text-3)',
}

export function KpiStrip({ cols = 4, children }: { cols?: number; children: ReactNode }) {
  return (
    <div className="ui-kpis" style={{ '--ui-kpi-cols': cols } as CSSProperties}>
      {children}
    </div>
  )
}

export function Kpi({
  label,
  value,
  tone = 'neutral',
  pulse = false,
}: {
  label: string
  value: ReactNode
  tone?: Tone
  pulse?: boolean
}) {
  return (
    <div className="ui-kpi">
      <div className="ui-kpi-label">
        <span className={pulse ? 'ui-kpi-dot live-pulse' : 'ui-kpi-dot'} style={{ background: TONE_VAR[tone] }} />
        {label}
      </div>
      <div className="ui-kpi-value">{value}</div>
    </div>
  )
}

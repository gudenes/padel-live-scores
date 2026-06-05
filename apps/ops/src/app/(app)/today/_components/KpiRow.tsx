// apps/ops/src/app/(app)/today/_components/KpiRow.tsx
import type { KpiData } from '../_lib/types'

export function KpiRow({ kpis }: { kpis: KpiData }) {
  const swingPos = kpis.biggestSwing.pct >= 0
  return (
    <div className="sb-kpirow">
      <Card label="Live matches" value={kpis.liveMatches} accent="lime" />
      <Card label="Pre-match modeled" value={kpis.preMatchModeled} accent="lime" />
      <Card label="Biggest swing · 15m" value={`${swingPos ? '+' : ''}${kpis.biggestSwing.pct}%`} sub={kpis.biggestSwing.label} accent="orange" />
      <Card label="Low coverage" value={kpis.lowCoverage} accent="muted" />
    </div>
  )
}

function Card({ label, value, sub, accent }: { label: string; value: number | string; sub?: string; accent: 'lime' | 'orange' | 'muted' }) {
  return (
    <div className={`sb-kpi sb-kpi--${accent}`}>
      <div className="sb-kpi-label">{label}</div>
      <div className="sb-kpi-value">{value}</div>
      {sub ? <div className="sb-kpi-sub">{sub}</div> : null}
    </div>
  )
}

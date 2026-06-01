// apps/ops/src/components/Odds/CalibrationKpiStrip.tsx
// KPI strip for /odds/calibration — Brier, log-loss, favorite hit-rate over a window.

import { KpiStrip, Kpi } from '@/components/ui'

export interface CalibrationKpiStripProps {
  totalScored: number
  meanBrier: number | null
  meanLogLoss: number | null
  favoriteHitRate: number | null
  windowLabel: string
}

export function CalibrationKpiStrip(props: CalibrationKpiStripProps) {
  const { totalScored, meanBrier, meanLogLoss, favoriteHitRate, windowLabel } = props
  const fmt = (v: number | null, digits = 4) => (v == null ? '—' : v.toFixed(digits))
  const fmtPct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`)
  const withHint = (value: string, hint?: string) => (
    <>
      {value}
      {hint && <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-3)', marginTop: 4 }}>{hint}</div>}
    </>
  )
  return (
    <div style={{ marginBottom: 24 }}>
      <KpiStrip cols={4}>
        <Kpi label={`Scored (${windowLabel})`} value={String(totalScored)} />
        <Kpi label="Mean Brier" value={withHint(fmt(meanBrier), 'Lower = better. 0.25 = coin flip.')} />
        <Kpi label="Mean log-loss" value={withHint(fmt(meanLogLoss), 'Lower = better. 0.69 = coin flip.')} />
        <Kpi label="Favorite hit-rate" value={withHint(fmtPct(favoriteHitRate), '% of matches where model favorite won.')} />
      </KpiStrip>
    </div>
  )
}

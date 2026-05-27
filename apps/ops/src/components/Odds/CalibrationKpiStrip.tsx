// apps/ops/src/components/Odds/CalibrationKpiStrip.tsx
// KPI strip for /odds/calibration — Brier, log-loss, favorite hit-rate over a window.

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
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
      <Kpi label={`Scored (${windowLabel})`} value={String(totalScored)} />
      <Kpi label='Mean Brier' value={fmt(meanBrier)} hint='Lower = better. 0.25 = coin flip.' />
      <Kpi label='Mean log-loss' value={fmt(meanLogLoss)} hint='Lower = better. 0.69 = coin flip.' />
      <Kpi label='Favorite hit-rate' value={fmtPct(favoriteHitRate)} hint='% of matches where model favorite won.' />
    </div>
  )
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ padding: 16, border: '1px solid var(--border-subtle)', borderRadius: 4 }}>
      <div style={{ fontSize: 11, color: 'var(--status-neutral)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{value}</div>
      {hint && <div style={{ fontSize: 10, color: 'var(--status-neutral)', marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

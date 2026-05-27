// apps/ops/src/components/Odds/ModelFreshnessPanel.tsx
// Snapshot-age + training-size + scoring-backlog health chips for /odds/calibration.

export interface ModelFreshnessPanelProps {
  latestSnapshotAt: string | null
  trainingMatchCount: number | null
  modelVersion: string | null
  unscoredFinishedLast7d: number
  meanBrier30d: number | null
  favoriteHitRate30d: number | null
}

export function ModelFreshnessPanel(props: ModelFreshnessPanelProps) {
  const {
    latestSnapshotAt,
    trainingMatchCount,
    modelVersion,
    unscoredFinishedLast7d,
    meanBrier30d,
    favoriteHitRate30d,
  } = props

  const snapshotAgeMin = latestSnapshotAt
    ? Math.round((Date.now() - new Date(latestSnapshotAt).getTime()) / 60_000)
    : null
  const snapshotColor =
    snapshotAgeMin == null ? 'var(--status-neutral)' :
    snapshotAgeMin <= 90 ? 'var(--status-positive)' :
    snapshotAgeMin <= 180 ? 'var(--status-warn)' :
    'var(--status-negative)'

  const unscoredColor = unscoredFinishedLast7d > 5 ? 'var(--status-negative)' : 'var(--status-positive)'
  const brierColor =
    meanBrier30d == null ? 'var(--status-neutral)' :
    meanBrier30d > 0.25 ? 'var(--status-negative)' :
    'var(--status-positive)'
  const hitRateColor =
    favoriteHitRate30d == null ? 'var(--status-neutral)' :
    favoriteHitRate30d < 0.5 ? 'var(--status-negative)' :
    'var(--status-positive)'

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, fontSize: 12 }}>
      <Chip
        label='Latest snapshot'
        value={snapshotAgeMin == null ? '—' : `${snapshotAgeMin}m ago`}
        color={snapshotColor}
      />
      <Chip
        label='Training set'
        value={trainingMatchCount == null ? '—' : `${trainingMatchCount.toLocaleString()} matches`}
      />
      <Chip
        label='Model version'
        value={modelVersion ?? '—'}
      />
      <Chip
        label='Unscored finished (7d)'
        value={String(unscoredFinishedLast7d)}
        color={unscoredColor}
      />
      <Chip
        label='Mean Brier (30d)'
        value={meanBrier30d == null ? '—' : meanBrier30d.toFixed(4)}
        color={brierColor}
      />
      <Chip
        label='Favorite hit-rate (30d)'
        value={favoriteHitRate30d == null ? '—' : `${(favoriteHitRate30d * 100).toFixed(1)}%`}
        color={hitRateColor}
      />
    </div>
  )
}

function Chip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div
      style={{
        padding: 10,
        border: `1px solid ${color ?? 'var(--border-subtle)'}`,
        borderRadius: 4,
      }}
    >
      <div style={{ fontSize: 10, color: 'var(--status-neutral)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4, color: color ?? 'inherit' }}>{value}</div>
    </div>
  )
}

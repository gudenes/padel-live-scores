// apps/ops/src/components/TodayStatusPill.tsx
// Footer pill showing the systemStatus roll-up from the aggregator.
// Green when everything is fine, yellow on warnings, red when stale
// matches are present.

import type { TodayPayload } from '@/lib/today-aggregator'

const COLOR_MAP: Record<TodayPayload['systemStatus'], { bg: string; label: string }> = {
  green: { bg: 'var(--status-live)', label: 'All systems operational' },
  yellow: { bg: 'var(--status-warn)', label: 'Some queues need attention' },
  red: { bg: 'var(--status-urgent)', label: 'Stale matches detected' },
}

export function TodayStatusPill({ status }: { status: TodayPayload['systemStatus'] }) {
  const { bg, label } = COLOR_MAP[status]
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 14px',
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 999,
        fontSize: 12,
        color: 'var(--status-neutral)',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: bg,
        }}
      />
      <span style={{ color: 'var(--brand-primary-fg)', fontWeight: 600 }}>{label}</span>
    </div>
  )
}

// apps/ops/src/components/TodayStatusPill.tsx
// Header pill showing the systemStatus roll-up from the aggregator.
// Lime when everything is fine, warn on warnings, urgent when stale
// matches are present.

import { Pill } from '@/components/ui'
import type { TodayPayload } from '@/lib/today-aggregator'

type PillTone = 'lime' | 'warn' | 'urgent'

const STATUS_MAP: Record<TodayPayload['systemStatus'], { tone: PillTone; label: string }> = {
  green: { tone: 'lime', label: 'All systems operational' },
  yellow: { tone: 'warn', label: 'Some queues need attention' },
  red: { tone: 'urgent', label: 'Stale matches detected' },
}

export function TodayStatusPill({ status }: { status: TodayPayload['systemStatus'] }) {
  const { tone, label } = STATUS_MAP[status]
  return (
    <Pill tone={tone} dot>
      {label}
    </Pill>
  )
}

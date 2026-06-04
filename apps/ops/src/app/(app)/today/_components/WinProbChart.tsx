// apps/ops/src/app/(app)/today/_components/WinProbChart.tsx
'use client'
import { OddsMovementChart } from '@/components/Odds/OddsMovementChart'
import type { Match } from '../_lib/types'

export function WinProbChart({ match }: { match: Match }) {
  const pts = match.winProbHistory.map((value, i) => ({ t: `t${String(i).padStart(2, '0')}`, value }))
  if (pts.length < 2) {
    return <div className="sb-chart-empty">No live probability history yet.</div>
  }
  return <OddsMovementChart series={[{ name: match.pair1.name, color: 'var(--lime)', points: pts }]} yLabel="Win prob" yDomain={[0, 1]} />
}

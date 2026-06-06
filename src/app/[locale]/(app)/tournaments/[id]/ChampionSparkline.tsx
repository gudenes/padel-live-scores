'use client'
import { useProjectionHistory } from './useProjectionHistory'
import { sparklinePoints } from '@/lib/sparkline-path'

const LIME = '#7ED321'
const W = 96
const H = 22

export default function ChampionSparkline({
  tournamentId, category, pairKey,
}: { tournamentId: string; category: 'men' | 'women'; pairKey: string | null }) {
  const points = useProjectionHistory(tournamentId, category, pairKey)
  if (points.length < 2) return null
  const pts = sparklinePoints(points.map((p) => p.champion_prob), W, H)
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const last = pts[pts.length - 1]
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" style={{ display: 'block' }}>
      <path d={d} fill="none" stroke={LIME} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last.x} cy={last.y} r={2} fill={LIME} />
    </svg>
  )
}

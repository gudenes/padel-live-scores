// Rank number with top-3 colouring, shared by the rankings rows.
import { GREEN, MUTED } from '@/components/home/shared-constants'

export function RankBadge({ rank }: { rank: number | null }) {
  if (!rank) return <span style={{ color: MUTED, fontSize: 14 }}>--</span>
  const isTop3 = rank <= 3
  const color = rank === 1 ? '#F5A623' : rank === 2 ? '#94A3B8' : rank === 3 ? '#CD7F32' : GREEN
  return (
    <span style={{
      fontWeight: 800, fontSize: isTop3 ? 17 : 15,
      color,
      display: 'block', textAlign: 'right',
      fontVariantNumeric: 'tabular-nums',
    }}>
      {rank}
    </span>
  )
}

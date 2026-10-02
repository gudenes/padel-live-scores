// Overlapping avatar stack for a coach's top players (index rows + rankings tab).
// Renders nothing when there are no players. Uses the shared Avatar (initial fallback).

import Avatar from '@/components/Avatar'
import { initials, type TopPlayer } from '@/lib/coach-page-data'

export function CoachTopAvatars({ players, size = 22 }: { players: TopPlayer[]; size?: number }) {
  if (players.length === 0) return null
  return (
    <span style={{ display: 'inline-flex', flexShrink: 0 }}>
      {players.map((p, i) => (
        <Avatar
          key={p.id}
          src={p.avatar_url}
          alt={p.name}
          size={size}
          fallback={initials(p.name)}
          style={{ border: '2px solid #1A1A1A', boxSizing: 'border-box', marginLeft: i === 0 ? 0 : -Math.round(size * 0.3) }}
        />
      ))}
    </span>
  )
}

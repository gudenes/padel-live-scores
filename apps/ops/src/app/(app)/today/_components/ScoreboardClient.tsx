// apps/ops/src/app/(app)/today/_components/ScoreboardClient.tsx
// Thin client boundary that owns the (currently no-op) selection handler,
// so the server page never serializes a function across the boundary.
// Selection state + the detail panel are wired in a later task.
'use client'

import type { Match } from '../_lib/types'
import { MatchesTable } from './MatchesTable'

export function ScoreboardClient({ matches }: { matches: Match[] }) {
  return <MatchesTable matches={matches} selectedId={null} onSelect={() => {}} />
}

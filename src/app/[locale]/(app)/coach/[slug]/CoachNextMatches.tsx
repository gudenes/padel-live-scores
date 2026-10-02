'use client'
// Client wrapper so the server-rendered coach page can show the shared MatchCard
// (realtime for live matches). Receives only serializable Match objects.

import { useSyncExternalStore } from 'react'
import { useLocale } from 'next-intl'
import { MatchCard } from '@/components/MatchCard'
import { MEN_BLUE, WOMEN_PURPLE } from '@/components/home/shared-constants'
import type { Match } from '@/types/match'

const subscribeNoop = () => () => {}
const serverTz = () => 'UTC'
const clientTz = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' }
}

// MATCH_FETCH_SELECT also carries category + the tournament join, which the Match type omits.
type CoachMatch = Match & { category?: string | null; tournament?: { level?: string | null } | null }

export function CoachNextMatches({ matches }: { matches: Match[] }) {
  const locale = useLocale()
  // Server snapshot is UTC; the client snapshot is the viewer's zone (no hydration mismatch).
  const userTz = useSyncExternalStore(subscribeNoop, clientTz, serverTz)
  return (
    <>
      {(matches as CoachMatch[]).map((m) => (
        <MatchCard
          key={m.id}
          match={m}
          genderColor={m.category === 'women' ? WOMEN_PURPLE : MEN_BLUE}
          locale={locale}
          userTz={userTz}
          tournamentLevel={m.tournament?.level}
        />
      ))}
    </>
  )
}

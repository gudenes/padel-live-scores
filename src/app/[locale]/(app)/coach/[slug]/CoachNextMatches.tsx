'use client'
// Client wrapper so the server-rendered coach page can show the shared MatchCard
// (realtime for live matches). Receives only serializable Match objects.

import { useSyncExternalStore } from 'react'
import { useLocale } from 'next-intl'
import { MatchCard } from '@/components/MatchCard'
import { MEN_BLUE, WOMEN_PURPLE } from '@/components/home/shared-constants'
import { MUTED } from '@/components/home/shared-constants'
import { formatTournamentName, type CoachMatch } from '@/lib/coach-page-data'

const subscribeNoop = () => () => {}
const serverTz = () => 'UTC'
const clientTz = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' }
}

export function CoachNextMatches({ matches }: { matches: CoachMatch[] }) {
  const locale = useLocale()
  // Server snapshot is UTC; the client snapshot is the viewer's zone (no hydration mismatch).
  const userTz = useSyncExternalStore(subscribeNoop, clientTz, serverTz)
  return (
    <>
      {matches.map((m) => (
        <div key={m.id}>
        {m.tournament?.name && (
          <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '8px 16px 0' }}>
            {formatTournamentName(m.tournament.name)}
          </div>
        )}
        <MatchCard
          match={m}
          genderColor={m.category === 'women' ? WOMEN_PURPLE : MEN_BLUE}
          locale={locale}
          userTz={userTz}
          tournamentLevel={m.tournament?.level}
        />
        </div>
      ))}
    </>
  )
}

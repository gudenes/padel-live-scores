// apps/ops/src/app/(app)/tournament-explorer/page.tsx
// Server component shell. Fetches initial data on the server (tournament list
// + selected tournament's entry list if the URL has ?tournament_id=...) and
// hands off to the client component for interactivity.

import { auth } from '@/lib/auth'
import { getActiveTournamentList } from '@/lib/tournament-list-aggregator'
import { getEntryListPayload } from '@/lib/entry-list-aggregator'
import { findFipTwin } from '@/lib/fip-twin-finder'
import { TournamentExplorerClient } from '@/components/TournamentExplorerClient'

export const metadata = { title: 'Tournament Explorer · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default async function TournamentExplorerPage({
  searchParams,
}: {
  searchParams: Promise<{ tournament_id?: string }>
}) {
  const sp = await searchParams
  const selectedId = typeof sp.tournament_id === 'string' ? sp.tournament_id : null
  const [, tournaments, initial] = await Promise.all([
    auth(),
    getActiveTournamentList(),
    selectedId
      ? Promise.all([getEntryListPayload(selectedId), findFipTwin(selectedId)]).then(([entryList, twin]) => ({
          entryList,
          twin,
        }))
      : Promise.resolve(null),
  ])

  return (
    <div style={{ padding: 32, maxWidth: 1400 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>Tournament Explorer</h1>
        <p style={{ fontSize: 13, color: 'var(--status-neutral)', margin: 0 }}>
          Review entry-list resolution status and fix unresolved partners.
        </p>
      </div>
      <TournamentExplorerClient
        tournaments={tournaments}
        selectedId={selectedId}
        initial={initial}
      />
    </div>
  )
}

'use client'
// apps/ops/src/components/TournamentExplorerClient.tsx
// Client-side orchestration for the Tournament Explorer page. Owns the
// picker → selection → entry-list-display flow with URL-driven state.

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'
import type { TournamentListItem } from '@/lib/tournament-list-aggregator'
import type { EntryListPayload } from '@/lib/entry-list-aggregator'
import type { FipTwinHit } from '@/lib/fip-twin-finder'
import { TournamentExplorerPicker } from './TournamentExplorerPicker'

export interface TournamentExplorerClientProps {
  tournaments: TournamentListItem[]
  selectedId: string | null
  initial: { entryList: EntryListPayload | null; twin: FipTwinHit | null } | null
}

export function TournamentExplorerClient({ tournaments, selectedId, initial }: TournamentExplorerClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const handleSelect = useCallback((id: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.set('tournament_id', id)
    router.push(`/tournament-explorer?${params.toString()}`)
  }, [router, searchParams])

  return (
    <div>
      <TournamentExplorerPicker tournaments={tournaments} selectedId={selectedId} onSelect={handleSelect} />
      {selectedId && initial?.entryList && (
        <div style={{ fontSize: 13, color: 'var(--status-neutral)' }}>
          Selected: <strong>{initial.entryList.tournament.name}</strong> — full entry-list rendering lands in Task 9.
        </div>
      )}
      {selectedId && !initial?.entryList && (
        <div style={{ fontSize: 13, color: 'var(--status-neutral)' }}>Tournament not found.</div>
      )}
    </div>
  )
}

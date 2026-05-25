'use client'
// apps/ops/src/components/TournamentExplorerClient.tsx
// Client-side orchestration for the Tournament Explorer page. Owns the
// picker → selection → entry-list-display flow with URL-driven state.
//
// Operator flow for resolving an unresolved partner (ghost row):
//   1. Operator clicks RESOLVE chip on a ghost partner row.
//   2. `handleResolveClick` opens the ResolvePartnerModal with the parsed
//      name + category + country hint.
//   3. Operator picks Link (search + Link button) or Create (form + Create
//      button). The modal POSTs to /api/internal/player-aliases or
//      /api/internal/players respectively.
//   4. On modal success, `handleResolved` closes the modal and shows a
//      banner instructing the operator to click "Re-seed from FIP PDF".
//   5. **The entry list is NOT auto-refreshed after step 4.** The alias /
//      player row exists in `public.*`, but the *snapshot* in
//      `padelgod.entry_list_snapshots` still shows the partner as
//      unresolved until padelgod's next fetch — or until the operator
//      clicks the FipSeedPanel button which calls `router.refresh()` post
//      re-seed. The banner makes this explicit; the operator finishes the
//      loop themselves.

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useState } from 'react'
import type { TournamentListItem } from '@/lib/tournament-list-aggregator'
import type { EntryListPayload, EntryPlayer } from '@/lib/entry-list-aggregator'
import type { FipTwinHit } from '@/lib/fip-twin-finder'
import { TournamentExplorerPicker } from './TournamentExplorerPicker'
import { TournamentExplorerHeader } from './TournamentExplorerHeader'
import { EntryListSection } from './EntryListSection'
import { ResolvePartnerModal, type ResolvePartnerContext } from './ResolvePartnerModal'
import { FipSeedPanel } from './FipSeedPanel'
import { FipTwinBanner } from './FipTwinBanner'

export interface TournamentExplorerClientProps {
  tournaments: TournamentListItem[]
  selectedId: string | null
  initial: { entryList: EntryListPayload | null; twin: FipTwinHit | null } | null
}

export function TournamentExplorerClient({ tournaments, selectedId, initial }: TournamentExplorerClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [resolveCtx, setResolveCtx] = useState<ResolvePartnerContext | null>(null)
  const [resolveBanner, setResolveBanner] = useState<string | null>(null)

  const handleSelect = useCallback((id: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.set('tournament_id', id)
    setResolveBanner(null)
    router.push(`/tournament-explorer?${params.toString()}`)
  }, [router, searchParams])

  const handleResolveClick = useCallback((p: EntryPlayer, category: 'men' | 'women') => {
    setResolveCtx({ parsedName: p.name, category, countryHint: p.country ?? null })
  }, [])

  const handleResolved = useCallback(() => {
    setResolveCtx(null)
    setResolveBanner('Resolved. Click "Re-seed from FIP PDF" to refresh the snapshot.')
  }, [])

  return (
    <div>
      <TournamentExplorerPicker tournaments={tournaments} selectedId={selectedId} onSelect={handleSelect} />

      {resolveBanner && (
        <div style={{ marginBottom: 12, padding: 10, background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 6, fontSize: 12, color: '#065f46' }}>
          {resolveBanner}
        </div>
      )}

      {selectedId && initial?.entryList && (
        <>
          <TournamentExplorerHeader payload={initial.entryList} />
          {initial.twin && !initial.entryList.tournament.fip_id && (
            <FipTwinBanner tournamentId={initial.entryList.tournament.id} twin={initial.twin} />
          )}
          <FipSeedPanel tournamentId={initial.entryList.tournament.id} hasFipId={!!initial.entryList.tournament.fip_id} />
          <EntryListSection payload={initial.entryList} onResolveClick={handleResolveClick} />
        </>
      )}
      {selectedId && !initial?.entryList && (
        <div style={{ fontSize: 13, color: 'var(--status-neutral)' }}>Tournament not found.</div>
      )}
      <ResolvePartnerModal ctx={resolveCtx} onClose={() => setResolveCtx(null)} onResolved={handleResolved} />
    </div>
  )
}

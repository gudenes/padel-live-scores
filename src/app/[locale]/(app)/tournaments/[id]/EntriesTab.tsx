// src/app/[locale]/(app)/tournaments/[id]/EntriesTab.tsx
'use client'
import { EntryList } from '@/components/EntryList'
import { useEntryList } from './useEntryList'

const MUTED = '#6B7280'

export default function EntriesTab({ tournamentId, genderFilter }: {
  tournamentId: string
  genderFilter: 'men' | 'women'
}) {
  const { entries, playerMap, loading } = useEntryList(tournamentId)
  const genderEntries = entries.filter((e) => e.category === genderFilter)

  if (!loading && genderEntries.length === 0) {
    return (
      <div style={{ padding: '32px 16px', textAlign: 'center', color: MUTED, fontSize: 13 }}>
        The entry list for this event is being prepared. Check back soon.
      </div>
    )
  }

  return (
    <div style={{ padding: '4px 14px 20px' }}>
      <EntryList
        entries={entries}
        playerMap={playerMap}
        debutStatusMap={{}}
        genderFilter={genderFilter}
        showDebutChips={false}
      />
    </div>
  )
}

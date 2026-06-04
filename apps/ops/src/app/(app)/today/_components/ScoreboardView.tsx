// apps/ops/src/app/(app)/today/_components/ScoreboardView.tsx
'use client'
import { useMemo, useState } from 'react'
import type { LiveOddsSnapshot } from '../_lib/types'
import { useScoreboard } from '../_lib/useScoreboard'
import { KpiRow } from './KpiRow'
import { MatchesTable } from './MatchesTable'
import { DetailPanel } from './DetailPanel'
import { ConnectionBanner } from './ConnectionBanner'

export interface Filters {
  status: 'all' | 'live' | 'break' | 'sched'
  tournament: string | null
  gender: 'all' | 'men' | 'women'
}

export function ScoreboardView({ initial, dateIso }: { initial: LiveOddsSnapshot; dateIso: string }) {
  const { snapshot, connection, reload } = useScoreboard(initial, dateIso)
  const [selectedId, setSelectedId] = useState<string | null>(initial.matches[0]?.id ?? null)
  const [filters, setFilters] = useState<Filters>({ status: 'all', tournament: null, gender: 'all' })

  const visible = useMemo(() => snapshot.matches.filter((m) => {
    if (filters.status === 'sched' ? m.status !== 'scheduled' : filters.status !== 'all' && m.status !== filters.status) return false
    if (filters.tournament && m.tournament !== filters.tournament) return false
    if (filters.gender !== 'all' && m.pair1.gender !== filters.gender) return false
    return true
  }), [snapshot.matches, filters])

  // After a refresh the selected match may have dropped out (e.g. it just finished).
  // Fall back to the first match so the detail panel never points at a vanished row.
  const selected = snapshot.matches.find((m) => m.id === selectedId) ?? snapshot.matches[0] ?? null
  const tournaments = useMemo(() => [...new Set(snapshot.matches.map((m) => m.tournament))].sort(), [snapshot.matches])

  return (
    <div className="sb-grid" data-conn={connection}>
      <div className="sb-main">
        <ConnectionBanner connection={connection} onRetry={reload} />
        <KpiRow kpis={snapshot.kpis} />
        <MatchesTable
          matches={visible}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedId}
          filters={filters}
          setFilters={setFilters}
          tournaments={tournaments}
        />
      </div>
      <DetailPanel match={selected} />
    </div>
  )
}

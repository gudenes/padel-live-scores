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
  status: 'all' | 'live' | 'break' | 'sched' | 'final'
  tournament: string | null
  gender: 'all' | 'men' | 'women'
}

export function ScoreboardView({ initial, dateIso }: { initial: LiveOddsSnapshot; dateIso: string }) {
  const { snapshot, connection, reload } = useScoreboard(initial, dateIso)
  const [selectedId, setSelectedId] = useState<string | null>(initial.matches[0]?.id ?? null)
  const [filters, setFilters] = useState<Filters>({ status: 'all', tournament: null, gender: 'all' })

  const visible = useMemo(() => snapshot.matches.filter((m) => {
    const statusOk =
      filters.status === 'all' ? m.status !== 'finished'
        : filters.status === 'live' ? m.status === 'live'
        : filters.status === 'break' ? m.status === 'break'
        : filters.status === 'sched' ? m.status === 'scheduled'
        : /* 'final' */ m.status === 'finished'
    if (!statusOk) return false
    if (filters.tournament && m.tournament !== filters.tournament) return false
    if (filters.gender !== 'all' && m.pair1.gender !== filters.gender) return false
    return true
  }), [snapshot.matches, filters])

  // Track the visible set: if the selected match isn't currently shown (e.g. a
  // filter hid it, or it just finished), fall back to the first visible match so
  // the detail panel and the row highlight stay in sync with what's on screen.
  const selected = visible.find((m) => m.id === selectedId) ?? visible[0] ?? null
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

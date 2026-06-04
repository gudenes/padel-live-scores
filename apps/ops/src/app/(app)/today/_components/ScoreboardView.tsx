// apps/ops/src/app/(app)/today/_components/ScoreboardView.tsx
'use client'
import { useMemo, useState } from 'react'
import type { LiveOddsSnapshot } from '../_lib/types'
import { KpiRow } from './KpiRow'
import { MatchesTable } from './MatchesTable'
import { DetailPanel } from './DetailPanel'

export interface Filters {
  status: 'all' | 'live' | 'break' | 'sched'
  tournament: string | null
  gender: 'all' | 'men' | 'women'
}

export function ScoreboardView({ initial }: { initial: LiveOddsSnapshot }) {
  const [snapshot] = useState(initial)
  const [selectedId, setSelectedId] = useState<string | null>(initial.matches[0]?.id ?? null)
  const [filters, setFilters] = useState<Filters>({ status: 'all', tournament: null, gender: 'all' })

  const visible = useMemo(() => snapshot.matches.filter((m) => {
    if (filters.status === 'sched' ? m.status !== 'scheduled' : filters.status !== 'all' && m.status !== filters.status) return false
    if (filters.tournament && m.tournament !== filters.tournament) return false
    if (filters.gender !== 'all' && m.pair1.gender !== filters.gender) return false
    return true
  }), [snapshot.matches, filters])

  const selected = snapshot.matches.find((m) => m.id === selectedId) ?? null
  const tournaments = useMemo(() => [...new Set(snapshot.matches.map((m) => m.tournament))].sort(), [snapshot.matches])

  return (
    <div className="sb-grid">
      <div className="sb-main">
        <KpiRow kpis={snapshot.kpis} />
        <MatchesTable
          matches={visible}
          selectedId={selectedId}
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

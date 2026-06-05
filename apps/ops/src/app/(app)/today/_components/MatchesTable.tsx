// apps/ops/src/app/(app)/today/_components/MatchesTable.tsx
'use client'

import { EmptyState } from '@/components/ui'
import type { Match } from '../_lib/types'
import type { Filters } from './ScoreboardView'
import { MatchRow } from './MatchRow'

const STATUS_SEGMENTS: { key: Filters['status']; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'live', label: 'Live' },
  { key: 'break', label: 'Break' },
  { key: 'sched', label: 'Sched' },
  { key: 'final', label: 'Final' },
]

const GENDER_SEGMENTS: { key: Filters['gender']; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'men', label: 'Men' },
  { key: 'women', label: 'Women' },
]

export function MatchesTable({
  matches,
  selectedId,
  onSelect,
  filters,
  setFilters,
  tournaments,
}: {
  matches: Match[]
  selectedId: string | null
  onSelect: (id: string) => void
  filters: Filters
  setFilters: (f: Filters) => void
  tournaments: string[]
}) {
  const liveCount = matches.filter((m) => m.status === 'live').length
  const filtered =
    filters.status !== 'all' || filters.tournament != null || filters.gender !== 'all'

  function clearFilters() {
    setFilters({ status: 'all', tournament: null, gender: 'all' })
  }

  return (
    <div className="sb-panel">
      <div className="sb-panel-header">
        <h3>Live matches</h3>
        {liveCount > 0 ? (
          <span className="sb-livepill">
            <span className="sb-livedot" />
            {liveCount} live
          </span>
        ) : null}
      </div>

      <div className="sb-filterbar">
        <div className="sb-seg" role="group" aria-label="Filter by status">
          {STATUS_SEGMENTS.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`sb-seg-item${filters.status === s.key ? ' sb-seg-item--on' : ''}`}
              aria-pressed={filters.status === s.key}
              onClick={() => setFilters({ ...filters, status: s.key })}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="sb-seg" role="group" aria-label="Filter by gender">
          {GENDER_SEGMENTS.map((g) => (
            <button
              key={g.key}
              type="button"
              className={`sb-seg-item${filters.gender === g.key ? ' sb-seg-item--on' : ''}`}
              aria-pressed={filters.gender === g.key}
              onClick={() => setFilters({ ...filters, gender: g.key })}
            >
              {g.label}
            </button>
          ))}
        </div>

        <label className={`sb-fsel${filters.tournament ? ' sb-fsel--on' : ''}`}>
          <span className="sb-fsel-k">Tournament</span>
          <select
            className="sb-fsel-select"
            value={filters.tournament ?? ''}
            onChange={(e) => setFilters({ ...filters, tournament: e.target.value || null })}
          >
            <option value="">All tournaments</option>
            {tournaments.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <div className="sb-filterbar-right">
          <span className="sb-fcount sb-num">Showing {matches.length}</span>
          {filtered ? (
            <button type="button" className="sb-clearbtn" onClick={clearFilters}>
              Clear
            </button>
          ) : null}
        </div>
      </div>

      {matches.length === 0 ? (
        <div style={{ padding: 18 }}>
          <EmptyState
            title="No matches today"
            hint={
              filtered
                ? 'No matches match the current filters. Clear them to see the full day.'
                : "Scheduled and live matches will appear here once the day's calendar populates."
            }
          />
        </div>
      ) : (
        <div className="sb-tablescroll">
          <table className="sb-table">
            <thead>
              <tr>
                <th>Match</th>
                <th>Tournament</th>
                <th className="sb-c">Sets · Pts</th>
                <th>Win probability</th>
                <th className="sb-r">15m</th>
                <th>Conf.</th>
                <th className="sb-r">Upd</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m) => (
                <MatchRow key={m.id} match={m} selected={m.id === selectedId} onSelect={onSelect} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

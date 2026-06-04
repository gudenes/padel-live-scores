// apps/ops/src/app/(app)/today/_components/MatchesTable.tsx
'use client'

import { EmptyState } from '@/components/ui'
import type { Match } from '../_lib/types'
import { MatchRow } from './MatchRow'

export function MatchesTable({ matches, selectedId, onSelect }: { matches: Match[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const liveCount = matches.filter((m) => m.status === 'live').length
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
      {/* filter bar: added in Task 10 */}
      {matches.length === 0 ? (
        <div style={{ padding: 18 }}>
          <EmptyState title="No matches today" hint="Scheduled and live matches will appear here once the day's calendar populates." />
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

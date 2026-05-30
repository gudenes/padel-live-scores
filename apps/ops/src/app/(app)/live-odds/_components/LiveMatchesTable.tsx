// apps/ops/src/app/(app)/live-odds/_components/LiveMatchesTable.tsx
import type { ConnectionState, Filters, Match } from '../_lib/types'
import { MatchRow } from './MatchRow'
import { ConnectionBanner } from './ConnectionBanner'
import { TableSkeleton } from './TableSkeleton'

export function LiveMatchesTable({ matches, selectedId, onSelect, connection, filters: _filters, setFilters: _setFilters, onRetry }: {
  matches: Match[]; selectedId: string | null; onSelect: (id: string) => void
  connection: ConnectionState; filters: Filters; setFilters: (f: Filters) => void; onRetry: () => void
}) {
  const liveCount = matches.filter(m => m.status === 'Live').length
  const shown = matches // real filtering applied by the parent (LiveOddsView)
  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Live Matches</h3><span className="mut">Premier Padel Italy Major · QF</span>
        <span className="livecount"><span className="d" />{liveCount} live</span>
      </div>
      <div className="filters">
        <span className="fsel on"><span className="k">Tournament</span> Italy Major <span className="caret">▾</span></span>
        <span className="fsel"><span className="k">Gender</span> All <span className="caret">▾</span></span>
        <span className="fsel"><span className="k">Tier</span> All <span className="caret">▾</span></span>
        <span className="fsel"><span className="k">Round</span> All <span className="caret">▾</span></span>
        <div className="seg">{['All', 'Live', 'Break', 'Sched'].map((s, i) => <span key={s} className={i === 0 ? 'on' : ''}>{s}</span>)}</div>
        <div className="right"><span className="chiptog"><span className="sw2" />Swinging</span><span className="clearbtn">Clear</span></div>
      </div>
      <div className="fsummary"><span className="fcount">Showing <b>{shown.length}</b> of <b>{matches.length}</b></span><span className="ftag">Premier Padel Italy Major <span className="x">✕</span></span></div>
      <ConnectionBanner state={connection} onRetry={onRetry} />
      <TableSkeleton />
      <div className="tablescroll">
        <table>
          <thead><tr>
            <th>Match</th><th>Tournament</th><th className="c">Sets · Pts</th><th>Win probability</th>
            <th className="r c-mv">15m</th><th className="c-conf">Conf.</th><th className="r c-upd">Upd</th>
          </tr></thead>
          <tbody>
            {shown.map(m => <MatchRow key={m.id} m={m} selected={m.id === selectedId} onSelect={() => onSelect(m.id)} />)}
          </tbody>
        </table>
      </div>
      <div className="tfoot">View all {matches.length} live matches →</div>
    </div>
  )
}

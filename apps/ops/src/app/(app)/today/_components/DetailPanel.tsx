// apps/ops/src/app/(app)/today/_components/DetailPanel.tsx
// Ports the mockup's "SELECTED MATCH" panel (docs/superpowers/mockups/live-odds-admin.html `.detail`).
'use client'

import type { Match } from '../_lib/types'
import { WinProbChart } from './WinProbChart'

function statusLabel(status: Match['status']): string {
  if (status === 'live') return 'Live'
  if (status === 'break') return 'Break'
  return 'Scheduled'
}

export function DetailPanel({ match }: { match: Match | null }) {
  if (match == null) {
    return <aside className="sb-detail sb-detail--empty">Select a match</aside>
  }

  const pct1 = Math.round(match.winProb1 * 100)
  const pct2 = 100 - pct1
  const lead1 = match.winProb1 >= 0.5
  const meta = [match.tournament, match.court, match.round, statusLabel(match.status)]
    .filter(Boolean)
    .join(' · ')

  return (
    <aside className="sb-detail">
      <div className="sb-dhead">
        <div className="sb-dhead-lab">Selected match</div>
        <div className="sb-dhead-ttl">
          {match.pair1.name} vs {match.pair2.name}
        </div>
        <small className="sb-dhead-meta">{meta}</small>
      </div>

      <div className="sb-dbody">
        <div className={`sb-prow${match.pair1.serving ? ' sb-prow--serving' : ''}`}>
          <div className="sb-pname">
            <span className="sb-sv" />
            {match.pair1.name}
          </div>
          <div className="sb-pvals">
            <span className={`sb-big sb-num${lead1 ? ' sb-big--lead' : ' sb-big--trail'}`}>{pct1}%</span>
            <span className="sb-fair sb-num">{match.fairOdds1 ? match.fairOdds1.toFixed(2) : '—'}</span>
          </div>
        </div>
        <div className={`sb-prow${match.pair2.serving ? ' sb-prow--serving' : ''}`}>
          <div className="sb-pname">
            <span className="sb-sv" />
            {match.pair2.name}
          </div>
          <div className="sb-pvals">
            <span className={`sb-big sb-num${!lead1 ? ' sb-big--lead' : ' sb-big--trail'}`}>{pct2}%</span>
            <span className="sb-fair sb-num">{match.fairOdds2 ? match.fairOdds2.toFixed(2) : '—'}</span>
          </div>
        </div>

        <div className="sb-dh">
          <span className="sb-dh-lab">Win probability · this match</span>
        </div>
        <div className="sb-well">
          <WinProbChart match={match} />
        </div>

        {/* drivers: deferred — Premier-only match_stats, not in snapshot */}
      </div>
    </aside>
  )
}

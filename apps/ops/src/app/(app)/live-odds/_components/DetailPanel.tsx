// apps/ops/src/app/(app)/live-odds/_components/DetailPanel.tsx
import type { Match } from '../_lib/types'
import { WinProbChart } from './WinProbChart'
import { Icon } from './icons'

export function DetailPanel({ m }: { m: Match }) {
  const leadA = m.winProbA >= 50
  return (
    <div className="panel detail">
      <div className="dhead">
        <div className="lab"><span className="d" />Selected match</div>
        <div className="ttl">{m.pair1.name} vs {m.pair2.name}</div>
        <small>{m.tournament} · {m.court} · {m.round} · {m.status}</small>
      </div>
      <div className="dbody">
        <div className="prow">
          <div className={`pname ${m.pair1.serving ? 'serving' : ''}`}><span className="sv" />{m.pair1.name}</div>
          <div className="pright"><span className={`big disp ${leadA ? 'lead' : 'trail'}`}>{m.winProbA}%</span><span className="fair mono">{m.fairOddsA.toFixed(2)}</span></div>
        </div>
        <div className="prow">
          <div className={`pname ${m.pair2.serving ? 'serving' : ''}`}><span className="sv" />{m.pair2.name}</div>
          <div className="pright"><span className={`big disp ${!leadA ? 'lead' : 'trail'}`}>{100 - m.winProbA}%</span><span className="fair mono">{m.fairOddsB.toFixed(2)}</span></div>
        </div>

        <div className="dh"><span className="lab">Win probability · this match</span><span className="seg2"><span>Set</span><span className="on">Match</span></span></div>
        <WinProbChart history={m.winProbHistory} />
        <div className="legend"><span><i style={{ background: 'var(--lime)' }} />{m.pair1.name}</span><span><i style={{ background: 'var(--border-strong)' }} />{m.pair2.name}</span></div>

        <div className="dh"><span className="lab">Live drivers</span></div>
        {m.drivers && (
          <>
            <div className="stat"><div className="name">1st serve win %</div></div>
            <div className="stat mono"><div className="l">{m.drivers.firstServe[0]}%</div><div className="stbar"><div className="a" style={{ width: `${m.drivers.firstServe[0]}%` }} /><div className="b" style={{ width: `${100 - m.drivers.firstServe[0]}%` }} /></div><div className="r">{m.drivers.firstServe[1]}%</div></div>
            <div className="stat"><div className="name">Break points won</div></div>
            <div className="stat mono"><div className="l">{m.drivers.breakPts[0]}</div><div className="stbar"><div className="a" style={{ width: '60%' }} /><div className="b" style={{ width: '40%' }} /></div><div className="r">{m.drivers.breakPts[1]}</div></div>
            <div className="stat"><div className="name">Total points won</div></div>
            <div className="stat mono"><div className="l">{m.drivers.totalPts[0]}</div><div className="stbar"><div className="a" style={{ width: '55%' }} /><div className="b" style={{ width: '45%' }} /></div><div className="r">{m.drivers.totalPts[1]}</div></div>
          </>
        )}
        <div className="dcta">
          <button className="dbtn primary"><Icon id="pin" />Pin to wall</button>
          <button className="dbtn"><Icon id="share" />Share</button>
        </div>
      </div>
    </div>
  )
}

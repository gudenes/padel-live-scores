// apps/ops/src/app/(app)/live-odds/_components/MatchRow.tsx
import type { Match } from '../_lib/types'
import { OddsBar } from './OddsBar'

function Pairs({ m }: { m: Match }) {
  const lead = m.winProbA >= 50 ? 1 : 2
  const row = (p: Match['pair1'], n: 1 | 2) => (
    <div className={`pp ${n === lead ? 'lead' : 'trail'} ${p.serving ? 'serving' : ''}`}>
      <span className="srv" />{p.name}
      <span className={`gtag ${p.gender === 'men' ? 'g-men' : 'g-women'}`}>{p.gender === 'men' ? 'M' : 'W'}</span>
    </div>
  )
  return <td className="match">{row(m.pair1, 1)}{row(m.pair2, 2)}</td>
}

export function MatchRow({ m, selected, onSelect }: { m: Match; selected: boolean; onSelect: () => void }) {
  const mv = m.movement15m
  return (
    <tr className={selected ? 'sel' : ''} onClick={onSelect}>
      <Pairs m={m} />
      <td className="tour">{m.tournamentShort}<small>{m.court} · {m.round}</small></td>
      <td>
        <div className="score scoreflash">
          <div className="scols mono">
            {m.setScores.map((s, i) => (
              <div key={i} className={`col ${s.current ? 'cur' : ''}`}><span className="a">{s.a}</span><span className="b">{s.b}</span></div>
            ))}
          </div>
          {m.status === 'Scheduled'
            ? <><span className="schedtime mono">{m.scheduledTime}</span><span className="badge b-sched">Sched</span></>
            : <>
                <div className={`gpcol mono ${m.pair1.serving ? 'serveA' : m.pair2.serving ? 'serveB' : ''}`}>
                  <span className="a">{m.gamePoints?.a ?? '—'}</span><span className="b">{m.gamePoints?.b ?? '—'}</span>
                </div>
                <span className={`badge ${m.status === 'Live' ? 'b-live' : 'b-break'}`}>{m.status}</span>
              </>}
        </div>
      </td>
      <td className="c-odds"><OddsBar pa={m.winProbA} pb={100 - m.winProbA} oa={m.fairOddsA} ob={m.fairOddsB} /></td>
      <td className="r c-mv"><span className={`mv mono ${mv > 0 ? 'up' : mv < 0 ? 'dn' : 'flat'}`}><span className="ar">{mv > 0 ? '▲' : mv < 0 ? '▼' : '—'}</span>{mv === 0 ? ' 0' : (mv > 0 ? '+' : '') + mv}</span></td>
      <td className="c-conf"><span className={`conf ${m.confidence}`}><span className="bars"><i style={{ height: 6 }} /><i style={{ height: 9 }} /><i style={{ height: 13 }} /></span><span className="t">{m.confidence === 'full' ? 'Full' : m.confidence === 'med' ? (m.status === 'Scheduled' ? 'Pre' : 'Settling') : 'Thin'}</span></span></td>
      <td className="r upd mono c-upd">{m.status === 'Scheduled' ? '—' : `${m.lastUpdatedSeconds}s`}</td>
    </tr>
  )
}

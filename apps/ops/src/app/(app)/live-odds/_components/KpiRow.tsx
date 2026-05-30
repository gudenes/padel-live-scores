// apps/ops/src/app/(app)/live-odds/_components/KpiRow.tsx
import type { Kpis } from '../_lib/types'
import { Icon } from './icons'

export function KpiRow({ kpis }: { kpis: Kpis }) {
  return (
    <div className="kpis">
      <div className="kpi"><div className="l"><Icon id="odds" />Live matches<span className="trend up">▲ +5</span></div><div className="v disp">{kpis.liveMatches}</div><div className="s">across <b>6</b> tournaments · <b>+5</b> in last 15m</div></div>
      <div className="kpi"><div className="l"><Icon id="today" />Pre-match modeled</div><div className="v disp">{kpis.preMatchModeled}</div><div className="s">queued for next <b>48h</b></div></div>
      <div className="kpi orange"><div className="l"><Icon id="odds" />Biggest swing · 15m</div><div className="v disp">{kpis.biggestSwing.pct > 0 ? '+' : ''}{kpis.biggestSwing.pct}%</div><div className="s">{kpis.biggestSwing.label}</div></div>
      <div className="kpi muted"><div className="l"><Icon id="eye" />Low coverage</div><div className="v disp">{kpis.lowCoverage}</div><div className="s">live, <span className="dn">no point-by-point</span> yet</div></div>
    </div>
  )
}

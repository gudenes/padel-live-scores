// apps/ops/src/app/(app)/live-odds/_components/WinProbChart.tsx
import { chartPoints } from '../_lib/odds-math'

const CW = 348, CH = 120
export function WinProbChart({ history }: { history: number[] }) {
  const pts = chartPoints(history.length ? history : [50], CW, CH)
  const line = 'M' + pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L')
  const area = `${line} L${CW},${CH} L0,${CH} Z`
  const last = pts[pts.length - 1]
  return (
    <div className="chart">
      <svg width="100%" height={CH} viewBox={`0 0 ${CW} ${CH}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="wp" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--lime)" stopOpacity="0.28" />
            <stop offset="1" stopColor="var(--lime)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" y1={CH / 2} x2={CW} y2={CH / 2} stroke="var(--border)" strokeDasharray="3 4" />
        <path d={area} fill="url(#wp)" />
        <path d={line} fill="none" stroke="var(--lime)" strokeWidth="2.2" />
        <circle cx={last[0]} cy={last[1]} r="3.5" fill="var(--lime)" stroke="var(--bg-sunken)" strokeWidth="1.5" />
      </svg>
    </div>
  )
}

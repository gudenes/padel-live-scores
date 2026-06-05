// apps/ops/src/app/(app)/today/_components/OddsBar.tsx
export function OddsBar({ prob1, fair1, fair2 }: { prob1: number; fair1: number; fair2: number }) {
  const pct1 = Math.round(prob1 * 100)
  return (
    <div className="sb-oddsbar">
      <div className="sb-oddsbar-track">
        <div className="sb-oddsbar-fill" style={{ width: `${pct1}%` }} />
        <span className="sb-oddsbar-pct sb-oddsbar-pct--fav">{pct1}%</span>
        <span className="sb-oddsbar-pct sb-oddsbar-pct--dog">{100 - pct1}%</span>
      </div>
      <div className="sb-oddsbar-fair">
        <span>{fair1 ? fair1.toFixed(2) : '—'}</span>
        <span>{fair2 ? fair2.toFixed(2) : '—'}</span>
      </div>
    </div>
  )
}

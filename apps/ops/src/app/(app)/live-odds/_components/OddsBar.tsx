// apps/ops/src/app/(app)/live-odds/_components/OddsBar.tsx
export function OddsBar({ pa, pb, oa, ob }: { pa: number; pb: number; oa: number; ob: number }) {
  return (
    <div className="odds">
      <div className="obar mono">
        <div className="a" style={{ width: `${pa}%` }}>{pa}%</div>
        <div className="b">{pb}%</div>
      </div>
      <div className="osub mono"><span className="fo">{oa.toFixed(2)}</span><span className="fo">{ob.toFixed(2)}</span></div>
    </div>
  )
}

// apps/ops/src/app/(app)/live-odds/_components/TableSkeleton.tsx
export function TableSkeleton() {
  return (
    <div className="skel">
      {Array.from({ length: 6 }).map((_, i) => (
        <div className="skrow" key={i}>
          <div className="skb" style={{ width: 160 }} />
          <div className="skb" style={{ width: 120 }} />
          <div className="skb skb-bar" style={{ width: 150 }} />
        </div>
      ))}
    </div>
  )
}

// apps/ops/src/app/(app)/system/seo/_components/Sparkline.tsx
interface Props {
  data: number[]
  width?: number
  height?: number
}

export function Sparkline({ data, width = 200, height = 40 }: Props) {
  if (data.length === 0) {
    return <svg width={width} height={height} aria-label="empty sparkline" />
  }
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const step = data.length > 1 ? width / (data.length - 1) : 0
  const points = data.map((v, i) => {
    const x = i * step
    const y = height - ((v - min) / range) * height
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg width={width} height={height} aria-label="clicks last 90 days">
      <polyline
        fill="none"
        stroke="var(--accent, #4ade80)"
        strokeWidth="1.5"
        points={points}
      />
    </svg>
  )
}

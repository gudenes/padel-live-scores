export interface SparkPoint { x: number; y: number }

/** Map a value series to points in a [w × h] box. Values clamped to [0,1];
 *  y inverted (1 → top). x evenly spaced. Flat/single series renders safe. */
export function sparklinePoints(values: number[], w: number, h: number): SparkPoint[] {
  const n = values.length
  if (n === 0) return []
  return values.map((v, i) => {
    const clamped = Math.max(0, Math.min(1, v))
    const x = n === 1 ? 0 : (i / (n - 1)) * w
    const y = h - clamped * h
    return { x, y }
  })
}

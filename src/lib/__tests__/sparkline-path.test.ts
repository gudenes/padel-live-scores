import { describe, it, expect } from 'vitest'
import { sparklinePoints } from '@/lib/sparkline-path'

describe('sparklinePoints', () => {
  it('maps values to x,y across the box (y inverted; higher value = higher up)', () => {
    const pts = sparklinePoints([0, 0.5, 1], 100, 20)
    expect(pts[0]).toEqual({ x: 0, y: 20 })
    expect(pts[2]).toEqual({ x: 100, y: 0 })
    expect(pts[1]).toEqual({ x: 50, y: 10 })
  })
  it('handles a flat series without NaN', () => {
    const pts = sparklinePoints([0.3, 0.3], 100, 20)
    expect(pts.every(p => Number.isFinite(p.y))).toBe(true)
  })
})

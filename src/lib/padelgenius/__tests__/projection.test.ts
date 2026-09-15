// src/lib/padelgenius/__tests__/projection.test.ts
import { describe, it, expect } from 'vitest'
import { toSvg, fromSvg } from '../projection'
import { DEFAULT_COURT } from '../default-court'

const W = 400
const H = 600
const b = DEFAULT_COURT.bounds

describe('toSvg', () => {
  it('maps back glass (y=0) to backGlassY * H', () => {
    const [, y] = toSvg(50, 0, b)
    expect(y).toBeCloseTo(b.backGlassY * H, 1)
  })

  it('maps net (y=50) to netY * H', () => {
    const [, y] = toSvg(50, 50, b)
    expect(y).toBeCloseTo(b.netY * H, 1)
  })

  it('maps near glass (y=100) to nearGlassY * H', () => {
    const [, y] = toSvg(50, 100, b)
    expect(y).toBeCloseTo(b.nearGlassY * H, 1)
  })

  it('interpolates between net and near glass at y=75', () => {
    const [, y50] = toSvg(50, 50, b)
    const [, y75] = toSvg(50, 75, b)
    const [, y100] = toSvg(50, 100, b)
    expect(y75).toBeGreaterThan(y50)
    expect(y75).toBeLessThan(y100)
  })

  it('places x=0 on the trapezoid left edge', () => {
    const [x] = toSvg(0, 50, b)
    expect(x).toBeGreaterThan(0)
    expect(x).toBeLessThan(W / 2)
  })

  it('places x=100 on the trapezoid right edge', () => {
    const [x] = toSvg(100, 50, b)
    expect(x).toBeGreaterThan(W / 2)
    expect(x).toBeLessThan(W)
  })
})

describe('fromSvg', () => {
  it('round-trips with toSvg at the center', () => {
    const [sx, sy] = toSvg(50, 50, b)
    const [nx, ny] = fromSvg(sx, sy, b)
    expect(nx).toBeCloseTo(50, 0)
    expect(ny).toBeCloseTo(50, 0)
  })

  it('returns [-1, -1] for points above the back glass', () => {
    const [nx, ny] = fromSvg(200, 0, b)
    expect(nx).toBe(-1)
    expect(ny).toBe(-1)
  })
})

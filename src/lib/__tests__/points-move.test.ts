import { describe, it, expect } from 'vitest'
import { computePointsMove, formatPointsMove } from '@/lib/points-move'

describe('computePointsMove', () => {
  it('returns current minus previous', () => {
    expect(computePointsMove(21000, 20550)).toBe(450)
    expect(computePointsMove(17669, 17749)).toBe(-80)
  })

  it('returns null when previous is missing', () => {
    expect(computePointsMove(7800, null)).toBeNull()
  })
})

describe('formatPointsMove', () => {
  it('renders gained points as +N', () => {
    expect(formatPointsMove(450)).toEqual({ text: '+450', kind: 'up' })
  })

  it('renders lost points as -N', () => {
    expect(formatPointsMove(-80)).toEqual({ text: '-80', kind: 'down' })
  })

  it('renders zero and missing as --', () => {
    expect(formatPointsMove(0)).toEqual({ text: '--', kind: 'flat' })
    expect(formatPointsMove(null)).toEqual({ text: '--', kind: 'flat' })
    expect(formatPointsMove(undefined)).toEqual({ text: '--', kind: 'flat' })
  })
})

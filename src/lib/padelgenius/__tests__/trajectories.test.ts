// src/lib/padelgenius/__tests__/trajectories.test.ts
import { describe, it, expect } from 'vitest'
import { trajectoryPath } from '../trajectories'
import type { TrajectoryStyle } from '../types'

const styles: TrajectoryStyle[] = ['flat', 'lob', 'bandeja', 'vibora', 'smash', 'chiquita', 'wall-bounce', 'cross']

describe('trajectoryPath', () => {
  styles.forEach(style => {
    it(`${style}: starts with M at the from point`, () => {
      const d = trajectoryPath(style, [10, 100], [200, 50])
      expect(d).toMatch(/^M\s*10[\s,]+100/)
    })

    it(`${style}: path ends near the to point`, () => {
      const d = trajectoryPath(style, [10, 100], [200, 50])
      // The path string should contain "200" and "50" somewhere near the end
      const tail = d.slice(-60)
      expect(tail).toMatch(/200/)
      expect(tail).toMatch(/50/)
    })
  })

  it('lob: uses a quadratic curve (Q)', () => {
    const d = trajectoryPath('lob', [10, 200], [200, 60])
    expect(d).toMatch(/Q/)
  })

  it('flat: uses a straight line (L)', () => {
    const d = trajectoryPath('flat', [10, 200], [200, 60])
    expect(d).toMatch(/L/)
  })

  it('wall-bounce: contains at least one bounce point (two segments)', () => {
    const d = trajectoryPath('wall-bounce', [10, 200], [10, 100])
    // Bounce path: M start L bounce L end → two L commands
    const ls = d.match(/L/g) || []
    expect(ls.length).toBeGreaterThanOrEqual(2)
  })
})

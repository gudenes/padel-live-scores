import { describe, it, expect } from 'vitest'
import {
  SLOT_PX, LABEL_PX,
  roundHeight, cellCenterY, cellHeight,
} from '../bracket-layout'

describe('roundHeight', () => {
  it('scales with selected match count', () => {
    expect(roundHeight(8)).toBe(8 * SLOT_PX)
    expect(roundHeight(1)).toBe(SLOT_PX)
  })
})

describe('cellCenterY pyramid alignment', () => {
  it('the midpoint of two feeder cells equals the destination center', () => {
    const H = roundHeight(4)            // selected = QF (4), feeders = R16 (8)
    for (let j = 0; j < 4; j++) {
      const top = cellCenterY(2 * j, 8, H)
      const bot = cellCenterY(2 * j + 1, 8, H)
      const dst = cellCenterY(j, 4, H)
      expect((top + bot) / 2).toBeCloseTo(dst, 6)
    }
  })

  it('offsets every center by the label band', () => {
    expect(cellCenterY(0, 1, roundHeight(1))).toBeCloseTo(LABEL_PX + SLOT_PX / 2, 6)
  })
})

describe('cellHeight', () => {
  it('never returns less than 12 and fits the spacing for compressed tiers', () => {
    expect(cellHeight('full', 84)).toBe(46)
    expect(cellHeight('peek', 84)).toBe(46)
    expect(cellHeight('mini', 20)).toBe(Math.max(12, Math.min(40, 20 - 3)))
    expect(cellHeight('sliver', 8)).toBe(12)
  })
})

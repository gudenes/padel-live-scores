import { describe, it, expect } from 'vitest'
import {
  SLOT_PX, LABEL_PX, GAP_PX, TIER_WIDTH,
  tierForDistance, roundHeight, cellCenterY,
  computeColumns, trackWidth, panOffset, cellHeight,
} from '../bracket-layout'

describe('tierForDistance', () => {
  it('maps distance to tier', () => {
    expect(tierForDistance(0)).toBe('full')
    expect(tierForDistance(1)).toBe('peek')
    expect(tierForDistance(-1)).toBe('mini')
    expect(tierForDistance(2)).toBe('sliver')
    expect(tierForDistance(-3)).toBe('sliver')
  })
})

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

describe('computeColumns', () => {
  it('assigns tiers and cumulative left offsets around the selected index', () => {
    const cols = computeColumns(4, 1)   // rounds R16,QF,SF,F ; QF selected
    expect(cols.map(c => c.tier)).toEqual(['mini', 'full', 'peek', 'sliver'])
    expect(cols[0].left).toBe(0)
    expect(cols[1].left).toBe(TIER_WIDTH.mini + GAP_PX)
    expect(cols[2].left).toBe(TIER_WIDTH.mini + GAP_PX + TIER_WIDTH.full + GAP_PX)
  })
})

describe('trackWidth', () => {
  it('is the right edge of the last column', () => {
    const cols = computeColumns(4, 0)
    const last = cols[cols.length - 1]
    expect(trackWidth(cols)).toBe(last.left + last.width)
  })
})

describe('panOffset', () => {
  it('is 0 when the first round is selected', () => {
    const cols = computeColumns(4, 0)
    expect(panOffset(cols, 0)).toBe(0)
  })
  it('keeps one mini column peeking before the focused column', () => {
    const cols = computeColumns(4, 2)   // SF selected
    expect(panOffset(cols, 2)).toBe(Math.max(0, cols[2].left - TIER_WIDTH.mini - GAP_PX))
  })
})

describe('cellHeight', () => {
  it('never returns less than 12 and fits the spacing for compressed tiers', () => {
    expect(cellHeight('full', 58)).toBe(46)
    expect(cellHeight('mini', 20)).toBe(Math.max(12, Math.min(40, 20 - 3)))
    expect(cellHeight('sliver', 8)).toBe(12)
  })
})

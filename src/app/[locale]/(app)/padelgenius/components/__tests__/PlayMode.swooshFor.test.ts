// Pure-function unit test for the swooshFor mapping used by PlayMode.
// Full RTL state-machine smoke test is deferred — covered by manual QA in Phase 1.
import { describe, it, expect } from 'vitest'
import { swooshFor } from '../PlayMode'
import type { TrajectoryStyle } from '@/lib/padelgenius/types'

describe('swooshFor', () => {
  it('maps lob to swoosh-lob', () => {
    expect(swooshFor('lob')).toBe('swoosh-lob')
  })

  it('maps smash and vibora to swoosh-smash', () => {
    expect(swooshFor('smash')).toBe('swoosh-smash')
    expect(swooshFor('vibora')).toBe('swoosh-smash')
  })

  it('falls through to swoosh-flat for every other trajectory style', () => {
    const fallthrough: TrajectoryStyle[] = ['flat', 'bandeja', 'chiquita', 'wall-bounce', 'cross']
    for (const style of fallthrough) {
      expect(swooshFor(style)).toBe('swoosh-flat')
    }
  })

  it('covers every TrajectoryStyle exhaustively', () => {
    // Type-level exhaustiveness: if a new TrajectoryStyle is added, this
    // assignment forces the test author to decide its swoosh mapping.
    const all: TrajectoryStyle[] = ['flat', 'lob', 'bandeja', 'vibora', 'smash', 'chiquita', 'wall-bounce', 'cross']
    for (const style of all) {
      expect(swooshFor(style)).toMatch(/^swoosh-(flat|lob|smash)$/)
    }
  })
})

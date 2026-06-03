import { describe, it, expect } from 'vitest'
import { runWithConcurrency } from '@/lib/run-with-concurrency'

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))

describe('runWithConcurrency', () => {
  it('processes every item exactly once', async () => {
    const seen: number[] = []
    await runWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => { await tick(1); seen.push(n) })
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })

  it('never exceeds the concurrency limit', async () => {
    let active = 0
    let peak = 0
    await runWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      active++; peak = Math.max(peak, active); await tick(5); active--
    })
    expect(peak).toBeLessThanOrEqual(3)
  })

  it('stops starting new items once shouldStop returns true', async () => {
    const processed: number[] = []
    let stop = false
    await runWithConcurrency([1, 2, 3, 4, 5, 6], 1, async (n) => {
      processed.push(n)
      if (n === 2) stop = true
    }, () => stop)
    expect(processed).toEqual([1, 2])
  })

  it('an item worker that throws does not reject the whole run', async () => {
    const done: number[] = []
    await expect(
      runWithConcurrency([1, 2, 3], 2, async (n) => { if (n === 2) throw new Error('boom'); done.push(n) }),
    ).resolves.toBeUndefined()
    expect(done.sort()).toEqual([1, 3])
  })
})

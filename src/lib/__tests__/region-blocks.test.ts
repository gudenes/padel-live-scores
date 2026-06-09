import { describe, it, expect } from 'vitest'
import { aggregateRegionBlocks, computeBlockSuggestions } from '@/lib/where-to-watch/region-blocks'

describe('aggregateRegionBlocks', () => {
  it('counts only videos that carry a blocked list', () => {
    const obs = aggregateRegionBlocks([
      { regionRestriction: { blocked: ['ar', 'br'] } },
      { regionRestriction: { blocked: ['ar'] } },
      {},                                  // no restriction → not sampled
      { regionRestriction: { allowed: ['es'] } }, // allow-only → not sampled
    ])
    expect(obs.sampleSize).toBe(2)
    expect(obs.blocked).toEqual({ ar: 2, br: 1 })
  })

  it('returns an empty observation for no input', () => {
    expect(aggregateRegionBlocks([])).toEqual({ sampleSize: 0, blocked: {} })
  })
})

describe('computeBlockSuggestions', () => {
  it('suggests countries blocked in >= threshold of samples', () => {
    const out = computeBlockSuggestions({
      observed: { sampleSize: 50, blocked: { cl: 47, mx: 3 } },
      broadcasterCountries: [],
      alreadyBlocked: [],
    })
    expect(out.map(s => s.country)).toEqual(['cl'])
    expect(out[0].reasons).toContain('yt_api')
    expect(out[0].ytBlockedCount).toBe(47)
    expect(out[0].ytSampleSize).toBe(50)
  })

  it('does NOT suggest a country just because it has a broadcaster', () => {
    // A broadcaster existing is not evidence the YouTube stream is blocked.
    const out = computeBlockSuggestions({
      observed: null,
      broadcasterCountries: ['co', 'gb', 'us'],
      alreadyBlocked: [],
    })
    expect(out).toEqual([])
  })

  it('annotates a YouTube-driven suggestion when a broadcaster also exists', () => {
    const out = computeBlockSuggestions({
      observed: { sampleSize: 20, blocked: { cl: 18 } },
      broadcasterCountries: ['cl'],
      alreadyBlocked: [],
    })
    expect(out.map(s => s.country)).toEqual(['cl'])
    expect(out[0].reasons).toEqual(['yt_api', 'broadcaster'])
  })

  it('excludes already-blocked countries and ignores tiny samples', () => {
    const out = computeBlockSuggestions({
      observed: { sampleSize: 4, blocked: { pe: 4 } }, // sample < minSample
      broadcasterCountries: ['ar'],
      alreadyBlocked: ['ar'],
    })
    expect(out).toEqual([])
  })
})

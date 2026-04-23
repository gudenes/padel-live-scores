import { describe, it, expect } from 'vitest'
import sharedJson from '../../../shared/country-codes-3to2.json'
import padelgodJson from '../../../padelgod/src/lib/country-codes-3to2.json'
import { ISO3_TO_ISO2 } from '../fip-scraper'

// Drift guard.
//
// The country-code mapping is duplicated at two paths:
//   - /shared/country-codes-3to2.json          ← canonical (this side)
//   - /padelgod/src/lib/country-codes-3to2.json ← mirror for Railway build
//
// Padelgod's tsconfig has `rootDir: ./src`, so it can't import from the
// repo-root `/shared/` dir directly. Duplicating the JSON is the pragmatic
// path — with this test enforcing byte-identical content across CI.
//
// If this test fails, one of the two was edited without the other.
// Re-sync them:
//   cp shared/country-codes-3to2.json padelgod/src/lib/country-codes-3to2.json
// (or the other direction) and re-run.
//
// Additionally: `src/lib/fip-scraper.ts` re-exports `ISO3_TO_ISO2` which
// must equal the shared JSON — that's a third copy path verified here.

describe('country-code map sync', () => {
  it('shared/ and padelgod/ JSON copies are byte-identical', () => {
    expect(padelgodJson).toEqual(sharedJson)
  })

  it('fip-scraper.ts ISO3_TO_ISO2 matches the shared JSON', () => {
    expect(ISO3_TO_ISO2).toEqual(sharedJson)
  })

  it('every mapped value is a 2-letter alpha-2 code', () => {
    // Sanity — catches a typo like `ESP: "ESP"` before it corrupts data.
    for (const [k, v] of Object.entries(sharedJson as Record<string, string>)) {
      expect(v, `${k} maps to invalid alpha-2 "${v}"`).toMatch(/^[A-Z]{2}$/)
    }
  })

  it('the 11 FIFA aliases that leaked pre-2026-04-23 are present', () => {
    // Regression guard: without this, another PR could "clean up" the
    // JSON and silently reintroduce the gap that caused the flag bug.
    const required = ['RUS', 'INA', 'SIN', 'PAK', 'KOS', 'NGR', 'GEO', 'BRN', 'LIT', 'ARM', 'AZE']
    const json = sharedJson as Record<string, string>
    for (const code of required) {
      expect(json[code], `${code} missing from shared/country-codes-3to2.json`).toBeDefined()
    }
  })
})

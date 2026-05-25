import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { countryToTimezone as nextSide } from '../country-timezone'
import { countryToTimezone as padelgodSide } from '../../../padelgod/src/lib/country-timezone'

// Drift guard.
//
// The country-timezone module is duplicated at two paths:
//   - /src/lib/country-timezone.ts                  ← canonical (this side)
//   - /padelgod/src/lib/country-timezone.ts         ← mirror for Railway build
//
// Same trade-off as `country-codes-3to2.json` and `avatar-rehost.ts`:
// padelgod's tsconfig has `rootDir: ./src` and runs as a separate
// Railway service, so it can't import from the repo-root `src/` tree
// directly. Duplicating the file is the pragmatic path — with this
// test enforcing byte-identical content (modulo the leading header)
// across CI.
//
// If this test fails, one side was edited without the other. Re-sync:
//   cp src/lib/country-timezone.ts padelgod/src/lib/country-timezone.ts
// then re-add the padelgod-side header block at the top, OR copy the
// other way and drop the header lines.

const ROOT = resolve(__dirname, '..', '..', '..')
const CANONICAL = resolve(ROOT, 'src', 'lib', 'country-timezone.ts')
const MIRROR = resolve(ROOT, 'padelgod', 'src', 'lib', 'country-timezone.ts')

/** Drop the leading header comment block — everything up to and
 *  including the first blank line BEFORE `const COUNTRY_TZ`. The
 *  bodies must be byte-identical from `const COUNTRY_TZ` onward. */
function stripHeader(src: string): string {
  const marker = 'const COUNTRY_TZ'
  const idx = src.indexOf(marker)
  if (idx === -1) {
    throw new Error(`marker "${marker}" not found in source`)
  }
  return src.slice(idx)
}

describe('country-timezone mirror sync', () => {
  it('canonical and padelgod mirror bodies are byte-identical', () => {
    const canonical = stripHeader(readFileSync(CANONICAL, 'utf8'))
    const mirror = stripHeader(readFileSync(MIRROR, 'utf8'))
    expect(mirror).toBe(canonical)
  })

  it('both sides resolve the same timezone for every covered country', () => {
    // Sample probe — any divergence in the maps trips at least one of
    // these. The body-equality test above catches everything else.
    const codes = [
      'AL', 'AR', 'AU', 'BR', 'CA', 'CH', 'CN', 'DE', 'EG', 'ES',
      'FR', 'GB', 'GE', 'HK', 'ID', 'IL', 'IN', 'IT', 'JP', 'KR',
      'MA', 'MT', 'MX', 'NL', 'PT', 'QA', 'SA', 'SE', 'SG', 'SN',
      'TH', 'TR', 'US', 'XK', 'ZA',
    ]
    for (const cc of codes) {
      expect(padelgodSide(cc), `${cc}`).toBe(nextSide(cc))
    }
  })

  it('both sides agree on unknown codes (null)', () => {
    expect(padelgodSide('ZZ')).toBeNull()
    expect(nextSide('ZZ')).toBeNull()
    expect(padelgodSide(null)).toBeNull()
    expect(nextSide(null)).toBeNull()
  })
})

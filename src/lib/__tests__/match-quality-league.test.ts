import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tierWeight } from '../match-quality'

describe('tierWeight team-league', () => {
  it('scores team-league below every circuit tier', () => {
    expect(tierWeight('ppl')).toBeLessThan(tierWeight('fip_bronze'))
    expect(tierWeight('ppl_ii')).toBeLessThan(tierWeight('fip_bronze'))
  })

  it('scores team-league below the unknown-level fallback', () => {
    expect(tierWeight('ppl')).toBeLessThan(tierWeight('some_new_tier'))
  })

  it('leaves circuit weights untouched', () => {
    expect(tierWeight('p1')).toBe(1.00)
    expect(tierWeight('fip_silver')).toBe(0.70)
    expect(tierWeight(null)).toBe(0.70)
  })
})

// apps/ops is a separate npm package that resolves `@/*` to its OWN src/,
// so it carries a byte-identical copy of this module rather than importing
// it. The ops highlight picker consumes `tierWeight` from that copy — if the
// two drift, a team-league match keeps scoring at the fip_silver fallback in
// ops while scoring correctly in the app. apps/ops has no installed test
// harness of its own, so the identity check lives here, in the suite that
// actually runs.
describe('apps/ops mirror', () => {
  it('is byte-identical to the root copy', () => {
    const root = join(__dirname, '..', '..', '..')
    const a = readFileSync(join(root, 'src/lib/match-quality.ts'), 'utf8')
    const b = readFileSync(join(root, 'apps/ops/src/lib/match-quality.ts'), 'utf8')
    expect(b).toBe(a)
  })
})

// Guards the padelgod ⇄ app mirror of the LMSR pricing engine.
//
// padelgod's market-generator seeds a market's q values; the app's trade route
// quotes and books against them. If the two copies of lmsr.ts ever disagree —
// a rounding tweak applied to one and not the other is the realistic way — the
// cost charged to a user stops matching the cost the book records. That gap is
// guacas created or destroyed out of nothing, silently, on every trade.
//
// A diff is not a style problem here, so this asserts byte equality rather
// than behavioural equivalence: any edit to one file must be made to both.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..', '..')
const APP_COPY = join(ROOT, 'src', 'lib', 'lmsr.ts')
const ENGINE_COPY = join(ROOT, 'padelgod', 'src', 'lib', 'lmsr.ts')

describe('lmsr.ts mirror', () => {
  it('is byte-identical between the app and padelgod', () => {
    const app = readFileSync(APP_COPY)
    const engine = readFileSync(ENGINE_COPY)

    // Compare as text first: a failure message showing the differing line is
    // far more actionable than "Buffer !== Buffer".
    expect(app.toString('utf8')).toBe(engine.toString('utf8'))
    expect(app.equals(engine)).toBe(true)
  })
})

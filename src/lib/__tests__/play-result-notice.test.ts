import { describe, it, expect } from 'vitest'
import { parsePlayResultNotice } from '../play-result-notice'

// Exactly what play_settle_market writes.
const row = (outcome: string, revision = 1, delta = 240) => ({
  category: 'play_result',
  body: `Outcome: ${outcome}. Balance adjustment: ${delta} G. Confirmed resolver result`,
  metadata: { market_id: 'm1', revision, delta },
})

describe('parsePlayResultNotice', () => {
  it('reads outcome from the SQL body and delta from metadata', () => {
    expect(parsePlayResultNotice(row('yes'))).toEqual({ corrected: false, outcome: 'yes', delta: 240 })
  })
  it('flags a correction from revision > 1', () => {
    expect(parsePlayResultNotice(row('no', 2, -120))).toEqual({ corrected: true, outcome: 'no', delta: -120 })
  })
  it('handles a void refund', () => {
    expect(parsePlayResultNotice(row('void'))?.outcome).toBe('void')
  })
  it('prefers metadata.outcome when the row carries it', () => {
    expect(parsePlayResultNotice({ ...row('yes'), metadata: { revision: 1, delta: 5, outcome: 'no' } })?.outcome).toBe('no')
  })
  it('leaves other categories and unparseable rows alone (they render stored text)', () => {
    expect(parsePlayResultNotice({ ...row('yes'), category: 'match_live' })).toBeNull()
    expect(parsePlayResultNotice({ ...row('yes'), body: 'something else' })).toBeNull()
    expect(parsePlayResultNotice({ ...row('yes'), metadata: {} })).toBeNull()
  })
})

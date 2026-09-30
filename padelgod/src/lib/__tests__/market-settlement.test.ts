import { describe, it, expect } from 'vitest'
import { decideSettlement, type MarketState } from '../market-settlement.js'
const now = new Date('2026-09-27T14:00:00Z')
const market = (status: MarketState['status']): MarketState => ({ status, proposedOutcome: true, proposedAt: null, settlesAt: null })
describe('immediate settlement', () => {
  it('settles a decided locked market without a waiting period', () => {
    expect(decideSettlement(market('locked'), { state: 'decided', outcome: true, evidence: {} }, now)).toEqual({ action: 'settle', outcome: true })
  })
  it('catches up old proposals using the current authoritative result', () => {
    expect(decideSettlement(market('proposed'), { state: 'decided', outcome: false, evidence: {} }, now)).toEqual({ action: 'settle', outcome: false })
  })
  it('waits for missing results and refunds cancelled markets', () => {
    expect(decideSettlement(market('locked'), { state: 'undecided' }, now)).toEqual({ action: 'none' })
    expect(decideSettlement(market('locked'), { state: 'void', reason: 'cancelled' }, now)).toEqual({ action: 'void', reason: 'cancelled' })
  })
  it('does not reopen held or settled markets', () => {
    for (const status of ['open', 'held', 'settled', 'void'] as const) {
      expect(decideSettlement(market(status), { state: 'decided', outcome: true, evidence: {} }, now)).toEqual({ action: 'none' })
    }
  })
})

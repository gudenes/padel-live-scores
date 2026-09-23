import { describe, it, expect } from 'vitest'
import { decideSettlement, CONFIRMATION_WINDOW_MS, type MarketState } from '../market-settlement.js'
import type { ResolverResult } from '../market-resolvers/types.js'

const NOW = new Date('2026-09-23T18:00:00Z')

function market(over: Partial<MarketState> = {}): MarketState {
  return {
    status: 'locked',
    proposedOutcome: null,
    proposedAt: null,
    settlesAt: null,
    ...over,
  }
}

describe('decideSettlement', () => {
  it('does nothing while the resolver is undecided', () => {
    expect(decideSettlement(market(), { state: 'undecided' }, NOW)).toEqual({ action: 'none' })
  })

  it('proposes when a locked market first becomes decidable', () => {
    const r: ResolverResult = { state: 'decided', outcome: true, evidence: { winner_pair: 1 } }
    const d = decideSettlement(market(), r, NOW)
    expect(d.action).toBe('propose')
    if (d.action === 'propose') {
      expect(d.outcome).toBe(true)
      expect(d.settlesAt.getTime()).toBe(NOW.getTime() + CONFIRMATION_WINDOW_MS)
    }
  })

  it('does not re-propose while the window is still running', () => {
    const m = market({
      status: 'proposed', proposedOutcome: true,
      proposedAt: new Date(NOW.getTime() - 60_000),
      settlesAt: new Date(NOW.getTime() + 60_000),
    })
    const r: ResolverResult = { state: 'decided', outcome: true, evidence: {} }
    expect(decideSettlement(m, r, NOW)).toEqual({ action: 'none' })
  })

  it('settles once the window has elapsed and the answer is unchanged', () => {
    const m = market({
      status: 'proposed', proposedOutcome: true,
      proposedAt: new Date(NOW.getTime() - 3_600_000),
      settlesAt: new Date(NOW.getTime() - 1_000),
    })
    const r: ResolverResult = { state: 'decided', outcome: true, evidence: {} }
    const d = decideSettlement(m, r, NOW)
    expect(d.action).toBe('settle')
    if (d.action === 'settle') expect(d.outcome).toBe(true)
  })

  it('HOLDS when the answer flips before the window elapses', () => {
    // The Crionet case: winner_pair=1 at 14:02, flipped to 2 at 14:21.
    const m = market({
      status: 'proposed', proposedOutcome: true,
      proposedAt: new Date(NOW.getTime() - 60_000),
      settlesAt: new Date(NOW.getTime() + 60_000),
    })
    const r: ResolverResult = { state: 'decided', outcome: false, evidence: {} }
    const d = decideSettlement(m, r, NOW)
    expect(d.action).toBe('hold')
    if (d.action === 'hold') expect(d.reason).toMatch(/changed/i)
  })

  it('HOLDS when the answer flips even after the window elapsed', () => {
    const m = market({
      status: 'proposed', proposedOutcome: true,
      proposedAt: new Date(NOW.getTime() - 3_600_000),
      settlesAt: new Date(NOW.getTime() - 1_000),
    })
    const r: ResolverResult = { state: 'decided', outcome: false, evidence: {} }
    expect(decideSettlement(m, r, NOW).action).toBe('hold')
  })

  it('HOLDS when a proposed market becomes undecided again', () => {
    const m = market({
      status: 'proposed', proposedOutcome: true,
      proposedAt: new Date(NOW.getTime() - 60_000),
      settlesAt: new Date(NOW.getTime() + 60_000),
    })
    expect(decideSettlement(m, { state: 'undecided' }, NOW).action).toBe('hold')
  })

  it('voids immediately — no confirmation window for a refund', () => {
    const d = decideSettlement(market(), { state: 'void', reason: 'walkover' }, NOW)
    expect(d).toEqual({ action: 'void', reason: 'walkover' })
  })

  it('ignores markets that are still open — locking comes first', () => {
    const r: ResolverResult = { state: 'decided', outcome: true, evidence: {} }
    expect(decideSettlement(market({ status: 'open' }), r, NOW)).toEqual({ action: 'none' })
  })

  it('ignores markets that are already settled or void', () => {
    const r: ResolverResult = { state: 'decided', outcome: true, evidence: {} }
    expect(decideSettlement(market({ status: 'settled' }), r, NOW)).toEqual({ action: 'none' })
    expect(decideSettlement(market({ status: 'void' }), r, NOW)).toEqual({ action: 'none' })
  })
})

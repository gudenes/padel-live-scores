import { describe, it, expect } from 'vitest'
import { toMarketState, applyDecisionPatch } from '../market-resolver.js'

const NOW = new Date('2026-09-23T18:00:00Z')

describe('toMarketState', () => {
  it('parses timestamps into Dates', () => {
    const s = toMarketState({
      status: 'proposed',
      proposed_outcome: true,
      proposed_at: '2026-09-23T17:30:00Z',
      settles_at: '2026-09-23T18:00:00Z',
    })
    expect(s.status).toBe('proposed')
    expect(s.proposedOutcome).toBe(true)
    expect(s.proposedAt?.toISOString()).toBe('2026-09-23T17:30:00.000Z')
    expect(s.settlesAt?.toISOString()).toBe('2026-09-23T18:00:00.000Z')
  })

  it('handles a never-proposed market', () => {
    const s = toMarketState({
      status: 'locked', proposed_outcome: null, proposed_at: null, settles_at: null,
    })
    expect(s.proposedAt).toBeNull()
    expect(s.settlesAt).toBeNull()
  })
})

describe('applyDecisionPatch', () => {
  it('writes the proposal plus its evidence and window', () => {
    const p = applyDecisionPatch({
      action: 'propose',
      outcome: true,
      evidence: { winner_pair: 1 },
      settlesAt: new Date('2026-09-23T18:30:00Z'),
    }, NOW)
    expect(p).toEqual({
      status: 'proposed',
      proposed_outcome: true,
      proposed_evidence: { winner_pair: 1 },
      proposed_at: NOW.toISOString(),
      settles_at: '2026-09-23T18:30:00.000Z',
    })
  })

  it('settles with an auto attribution', () => {
    expect(applyDecisionPatch({ action: 'settle', outcome: false }, NOW)).toEqual({
      status: 'settled',
      outcome: false,
      settled_at: NOW.toISOString(),
      settled_by: 'auto',
    })
  })

  it('voids with a reason', () => {
    expect(applyDecisionPatch({ action: 'void', reason: 'walkover' }, NOW)).toEqual({
      status: 'void',
      void_reason: 'walkover',
      settled_at: NOW.toISOString(),
      settled_by: 'auto',
    })
  })

  it('PERSISTS a hold — this is where the safety guarantee is actually enforced', () => {
    // If a hold left the row at 'proposed', the next pass would auto-settle it
    // the moment the upstream answer flapped back. That hole was measured.
    expect(applyDecisionPatch({ action: 'hold', reason: 'answer changed' }, NOW)).toEqual({
      status: 'held',
      hold_reason: 'answer changed',
    })
  })

  it('no-op returns null', () => {
    expect(applyDecisionPatch({ action: 'none' }, NOW)).toBeNull()
  })
})

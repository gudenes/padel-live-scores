import { describe, it, expect } from 'vitest'
import { evaluateClaim, NOTE_MAX_LENGTH, type ClaimContext } from '../player-claim'

const base: ClaimContext = {
  userId: 'user-1',
  player: { id: 'player-1', tier: 'amateur' },
  playerOwnerUserId: null,
  accountPlayerId: null,
  hasPendingClaim: false,
}

describe('evaluateClaim', () => {
  it('accepts a logged-in user claiming an unclaimed amateur', () => {
    expect(evaluateClaim(base)).toEqual({ ok: true })
  })

  it('rejects an anonymous visitor', () => {
    expect(evaluateClaim({ ...base, userId: null }))
      .toEqual({ ok: false, reason: 'unauthenticated', status: 401 })
  })

  it('rejects an unknown player', () => {
    expect(evaluateClaim({ ...base, player: null }))
      .toEqual({ ok: false, reason: 'not_found', status: 404 })
  })

  it('rejects a professional — only amateurs are claimable', () => {
    expect(evaluateClaim({ ...base, player: { id: 'player-1', tier: 'pro' } }))
      .toEqual({ ok: false, reason: 'not_claimable', status: 403 })
  })

  it('rejects a player already linked to another account', () => {
    expect(evaluateClaim({ ...base, playerOwnerUserId: 'user-2' }))
      .toEqual({ ok: false, reason: 'already_claimed', status: 409 })
  })

  it('rejects a player already linked to this same account', () => {
    expect(evaluateClaim({ ...base, playerOwnerUserId: 'user-1', accountPlayerId: 'player-1' }))
      .toEqual({ ok: false, reason: 'already_claimed', status: 409 })
  })

  it('rejects an account that already owns a different player', () => {
    expect(evaluateClaim({ ...base, accountPlayerId: 'player-9' }))
      .toEqual({ ok: false, reason: 'account_linked', status: 409 })
  })

  it('rejects a duplicate pending request', () => {
    expect(evaluateClaim({ ...base, hasPendingClaim: true }))
      .toEqual({ ok: false, reason: 'pending', status: 409 })
  })

  it('checks identity before ownership — an anonymous visitor is never told who owns the player', () => {
    expect(evaluateClaim({ ...base, userId: null, playerOwnerUserId: 'user-2' }))
      .toEqual({ ok: false, reason: 'unauthenticated', status: 401 })
  })
})

describe('NOTE_MAX_LENGTH', () => {
  it('caps the free-text note', () => {
    expect(NOTE_MAX_LENGTH).toBe(280)
  })
})

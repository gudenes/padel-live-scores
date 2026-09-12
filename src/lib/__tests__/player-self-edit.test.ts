// src/lib/__tests__/player-self-edit.test.ts
import { describe, it, expect } from 'vitest'
import { parseSelfEditPayload } from '../player-self-edit'

describe('parseSelfEditPayload', () => {
  it('accepts a side-only patch and leaves the racket untouched', () => {
    expect(parseSelfEditPayload({ side: 'drive' }))
      .toEqual({ ok: true, patch: { side: 'drive' } })
  })

  it('accepts a racket-only patch and leaves the side untouched', () => {
    expect(parseSelfEditPayload({ racketId: 'racket-1' }))
      .toEqual({ ok: true, patch: { racketId: 'racket-1' } })
  })

  it('accepts both at once', () => {
    expect(parseSelfEditPayload({ side: 'backhand', racketId: 'racket-1' }))
      .toEqual({ ok: true, patch: { side: 'backhand', racketId: 'racket-1' } })
  })

  it('does NOT clear the racket when racketId is absent', () => {
    const result = parseSelfEditPayload({ side: 'drive' })
    expect(result).toEqual({ ok: true, patch: { side: 'drive' } })
    expect('racketId' in (result as { patch: object }).patch).toBe(false)
  })

  it('does NOT clear the side when side is absent', () => {
    const result = parseSelfEditPayload({ racketId: 'racket-1' })
    expect('side' in (result as { patch: object }).patch).toBe(false)
  })

  it('clears the side on an explicit null', () => {
    expect(parseSelfEditPayload({ side: null }))
      .toEqual({ ok: true, patch: { side: null } })
  })

  it('clears the racket on an explicit null', () => {
    expect(parseSelfEditPayload({ racketId: null }))
      .toEqual({ ok: true, patch: { racketId: null } })
  })

  it('rejects a side outside the allowed values', () => {
    expect(parseSelfEditPayload({ side: 'left' }))
      .toEqual({ ok: false, error: 'bad_side', status: 400 })
  })

  it('rejects a non-string racketId', () => {
    expect(parseSelfEditPayload({ racketId: 42 }))
      .toEqual({ ok: false, error: 'bad_racket', status: 400 })
  })

  it('rejects an empty patch — nothing to do is a client bug, not a no-op', () => {
    expect(parseSelfEditPayload({}))
      .toEqual({ ok: false, error: 'empty', status: 400 })
  })

  it('ignores fields it does not own — a playerId in the body changes nothing', () => {
    expect(parseSelfEditPayload({ side: 'drive', playerId: 'someone-else', ranking: 1 }))
      .toEqual({ ok: true, patch: { side: 'drive' } })
  })

  it('rejects a non-object body', () => {
    expect(parseSelfEditPayload(null))
      .toEqual({ ok: false, error: 'empty', status: 400 })
  })
})

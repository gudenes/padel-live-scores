import { describe, it, expect } from 'vitest'
import { validatePatchInput } from '../route'

describe('validatePatchInput', () => {
  it('accepts a positive integer', () => {
    expect(validatePatchInput({ tournamentId: 'abc-123', prizeMoneyEur: 25000 }))
      .toEqual({ ok: true, value: { tournamentId: 'abc-123', prizeMoneyEur: 25000 } })
  })

  it('accepts zero (amateur event)', () => {
    expect(validatePatchInput({ tournamentId: 'abc-123', prizeMoneyEur: 0 }))
      .toEqual({ ok: true, value: { tournamentId: 'abc-123', prizeMoneyEur: 0 } })
  })

  it('accepts null (clears the value)', () => {
    expect(validatePatchInput({ tournamentId: 'abc-123', prizeMoneyEur: null }))
      .toEqual({ ok: true, value: { tournamentId: 'abc-123', prizeMoneyEur: null } })
  })

  it('rejects missing tournamentId', () => {
    expect(validatePatchInput({ prizeMoneyEur: 100 }).ok).toBe(false)
  })

  it('rejects empty tournamentId', () => {
    expect(validatePatchInput({ tournamentId: '', prizeMoneyEur: 100 }).ok).toBe(false)
  })

  it('rejects non-integer prizeMoneyEur', () => {
    expect(validatePatchInput({ tournamentId: 'abc-123', prizeMoneyEur: 25.5 }).ok).toBe(false)
  })

  it('rejects negative prizeMoneyEur', () => {
    expect(validatePatchInput({ tournamentId: 'abc-123', prizeMoneyEur: -1 }).ok).toBe(false)
  })

  it('rejects string prizeMoneyEur', () => {
    expect(validatePatchInput({ tournamentId: 'abc-123', prizeMoneyEur: '25000' as unknown as number }).ok).toBe(false)
  })

  it('rejects null body', () => {
    expect(validatePatchInput(null).ok).toBe(false)
  })
})

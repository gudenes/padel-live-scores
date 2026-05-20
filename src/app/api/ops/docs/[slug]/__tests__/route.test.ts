import { describe, it, expect } from 'vitest'
import { validatePutInput } from '../route'

describe('validatePutInput', () => {
  it('accepts a non-empty content string', () => {
    expect(validatePutInput({ content: '# Hello\n\nWorld' }))
      .toEqual({ ok: true, value: { content: '# Hello\n\nWorld' } })
  })

  it('accepts an empty content string (operator wants to blank the doc)', () => {
    expect(validatePutInput({ content: '' }))
      .toEqual({ ok: true, value: { content: '' } })
  })

  it('rejects missing content', () => {
    expect(validatePutInput({}).ok).toBe(false)
  })

  it('rejects non-string content', () => {
    expect(validatePutInput({ content: 123 as unknown as string }).ok).toBe(false)
  })

  it('rejects null body', () => {
    expect(validatePutInput(null).ok).toBe(false)
  })

  it('rejects array body', () => {
    expect(validatePutInput([] as unknown).ok).toBe(false)
  })

  it('rejects explicit undefined content (same path as missing)', () => {
    expect(validatePutInput({ content: undefined }).ok).toBe(false)
  })

  it('caps content at 200_000 chars to avoid runaway payloads', () => {
    const huge = 'x'.repeat(200_001)
    expect(validatePutInput({ content: huge }).ok).toBe(false)
  })

  it('accepts content right at the 200_000 limit', () => {
    const exactly = 'x'.repeat(200_000)
    expect(validatePutInput({ content: exactly }).ok).toBe(true)
  })
})

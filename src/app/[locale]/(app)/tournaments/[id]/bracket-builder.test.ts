// src/app/[locale]/(app)/tournaments/[id]/bracket-builder.test.ts
import { describe, expect, it } from 'vitest'
import { pairKeyFor } from './bracket-builder'

describe('pairKeyFor', () => {
  it('produces a stable key regardless of player order', () => {
    expect(pairKeyFor('aaa', 'bbb')).toBe(pairKeyFor('bbb', 'aaa'))
  })

  it('formats as "smaller::larger"', () => {
    expect(pairKeyFor('zzz', 'aaa')).toBe('aaa::zzz')
  })

  it('handles equal IDs deterministically', () => {
    expect(pairKeyFor('xxx', 'xxx')).toBe('xxx::xxx')
  })
})

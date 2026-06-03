// src/lib/__tests__/player-suggestion-fields.test.ts
// Run with: npx vitest run src/lib/__tests__/player-suggestion-fields.test.ts

import { describe, it, expect } from 'vitest'
import {
  SUGGESTABLE_FIELDS,
  isSuggestableField,
  columnForField,
  sanitizeChanges,
  sanitizeComment,
} from '../player-suggestion-fields'

describe('isSuggestableField', () => {
  it('accepts whitelisted keys', () => {
    expect(isSuggestableField('full_name')).toBe(true)
    expect(isSuggestableField('hand')).toBe(true)
  })
  it('rejects anything else', () => {
    expect(isSuggestableField('id')).toBe(false)
    expect(isSuggestableField('ranking')).toBe(false)
    expect(isSuggestableField('')).toBe(false)
  })
})

describe('columnForField', () => {
  it('maps form keys to players columns', () => {
    expect(columnForField('full_name')).toBe('name')
    expect(columnForField('birthdate')).toBe('birthdate')
  })
})

describe('sanitizeChanges', () => {
  it('drops non-whitelisted fields', () => {
    const out = sanitizeChanges([{ field: 'ranking', suggested: '5' }])
    expect(out).toEqual([])
  })
  it('drops empty suggestions', () => {
    const out = sanitizeChanges([{ field: 'country', current: 'ES', suggested: '   ' }])
    expect(out).toEqual([])
  })
  it('drops no-op changes (suggested === current)', () => {
    const out = sanitizeChanges([{ field: 'country', current: 'Spain', suggested: 'Spain' }])
    expect(out).toEqual([])
  })
  it('keeps real changes, trims, and normalizes current to null when absent', () => {
    const out = sanitizeChanges([{ field: 'country', suggested: '  Spain  ' }])
    expect(out).toEqual([{ field: 'country', current: null, suggested: 'Spain' }])
  })
  it('dedupes repeated fields (first wins)', () => {
    const out = sanitizeChanges([
      { field: 'height', current: '190', suggested: '193' },
      { field: 'height', current: '190', suggested: '999' },
    ])
    expect(out).toEqual([{ field: 'height', current: '190', suggested: '193' }])
  })
  it('caps suggested length at 200 chars', () => {
    const long = 'x'.repeat(300)
    const out = sanitizeChanges([{ field: 'birthplace', suggested: long }])
    expect(out[0].suggested).toHaveLength(200)
  })
  it('returns [] for non-array input', () => {
    expect(sanitizeChanges(undefined)).toEqual([])
    expect(sanitizeChanges('nope')).toEqual([])
  })
})

describe('sanitizeComment', () => {
  it('trims and returns null for empty', () => {
    expect(sanitizeComment('   ')).toBeNull()
    expect(sanitizeComment(undefined)).toBeNull()
  })
  it('caps at 1000 chars', () => {
    expect(sanitizeComment('y'.repeat(1500))).toHaveLength(1000)
  })
  it('returns trimmed text', () => {
    expect(sanitizeComment('  hello  ')).toBe('hello')
  })
})

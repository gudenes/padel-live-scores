import { describe, it, expect } from 'vitest'
import { lastName, playerLastName } from '../player-name'

describe('lastName', () => {
  it('returns the last whitespace-delimited token', () => {
    expect(lastName('Agustin Tapia')).toBe('Tapia')
  })
  it('returns empty string for null/undefined/empty', () => {
    expect(lastName(null)).toBe('')
    expect(lastName(undefined)).toBe('')
    expect(lastName('   ')).toBe('')
  })
})

describe('playerLastName', () => {
  it('prefers display_name over canonical name', () => {
    expect(playerLastName({ name: 'Gemma Triay Pons', display_name: 'Gemma Triay' })).toBe('Triay')
  })
  it('falls back to name when display_name is null', () => {
    expect(playerLastName({ name: 'Agustin Tapia', display_name: null })).toBe('Tapia')
  })
  it('returns empty string for null player', () => {
    expect(playerLastName(null)).toBe('')
  })
})

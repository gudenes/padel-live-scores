import { describe, it, expect } from 'vitest'
import { shouldShowRecap, defaultFinishedTab } from '../recap-visibility'

describe('shouldShowRecap', () => {
  it('shows for a Premier match with no breaks', () => {
    expect(shouldShowRecap({ isPremier: true, hasBreaks: false, webtugaSourced: false })).toBe(true)
  })
  it('shows for a non-Premier match that has break data', () => {
    expect(shouldShowRecap({ isPremier: false, hasBreaks: true, webtugaSourced: false })).toBe(true)
  })
  it('HIDES for a webtuga-sourced match even though it is Premier-classified', () => {
    expect(shouldShowRecap({ isPremier: true, hasBreaks: true, webtugaSourced: true })).toBe(false)
  })
  it('hides for a non-Premier match with no breaks', () => {
    expect(shouldShowRecap({ isPremier: false, hasBreaks: false, webtugaSourced: false })).toBe(false)
  })
})

describe('defaultFinishedTab', () => {
  it('lands on recap for a Premier non-webtuga match', () => {
    expect(defaultFinishedTab({ isPremier: true, webtugaSourced: false })).toBe('recap')
  })
  it('lands on players for a webtuga match (recap is hidden)', () => {
    expect(defaultFinishedTab({ isPremier: true, webtugaSourced: true })).toBe('players')
  })
  it('lands on players for a non-Premier match', () => {
    expect(defaultFinishedTab({ isPremier: false, webtugaSourced: false })).toBe('players')
  })
})

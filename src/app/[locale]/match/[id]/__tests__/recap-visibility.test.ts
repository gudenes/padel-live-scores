import { describe, it, expect } from 'vitest'
import { shouldShowRecap, defaultFinishedTab, matchDetailTabKeys } from '../recap-visibility'

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

describe('matchDetailTabKeys', () => {
  it('finished + recap + live → recap, live, players, h2h', () => {
    expect(matchDetailTabKeys({ isFinished: true, isScheduled: false, showRecap: true, showLive: true }))
      .toEqual(['recap', 'live', 'players', 'h2h'])
  })
  it('finished webtuga: recap hidden but Live Feed STAYS → live, players, h2h', () => {
    expect(matchDetailTabKeys({ isFinished: true, isScheduled: false, showRecap: false, showLive: true }))
      .toEqual(['live', 'players', 'h2h'])
  })
  it('finished + recap, no live → recap, players, h2h', () => {
    expect(matchDetailTabKeys({ isFinished: true, isScheduled: false, showRecap: true, showLive: false }))
      .toEqual(['recap', 'players', 'h2h'])
  })
  it('finished, neither recap nor live → players, h2h', () => {
    expect(matchDetailTabKeys({ isFinished: true, isScheduled: false, showRecap: false, showLive: false }))
      .toEqual(['players', 'h2h'])
  })
  it('scheduled → players, h2h (never recap/live)', () => {
    expect(matchDetailTabKeys({ isFinished: false, isScheduled: true, showRecap: true, showLive: true }))
      .toEqual(['players', 'h2h'])
  })
  it('live with PBP → live, players, h2h', () => {
    expect(matchDetailTabKeys({ isFinished: false, isScheduled: false, showRecap: false, showLive: true }))
      .toEqual(['live', 'players', 'h2h'])
  })
  it('live without PBP → players, h2h', () => {
    expect(matchDetailTabKeys({ isFinished: false, isScheduled: false, showRecap: false, showLive: false }))
      .toEqual(['players', 'h2h'])
  })
})

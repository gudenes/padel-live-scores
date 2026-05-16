import { describe, it, expect } from 'vitest'
import { isPremierTier, isLiveStatus, isPresenceOnlyLive } from '../tournament-tier'

describe('isPremierTier', () => {
  it('returns true for P1/P2/Major/Premier_* levels', () => {
    expect(isPremierTier('P1')).toBe(true)
    expect(isPremierTier('P2')).toBe(true)
    expect(isPremierTier('Major')).toBe(true)
    expect(isPremierTier('Premier_Mens')).toBe(true)
    expect(isPremierTier('Premier_Womens')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isPremierTier('p1')).toBe(true)
    expect(isPremierTier('major')).toBe(true)
    expect(isPremierTier('PREMIER_MENS')).toBe(true)
  })

  it('returns false for FIP-tier levels', () => {
    expect(isPremierTier('fip_bronze')).toBe(false)
    expect(isPremierTier('fip_silver')).toBe(false)
    expect(isPremierTier('fip_gold')).toBe(false)
    expect(isPremierTier('FIP_Bronze')).toBe(false)
  })

  it('returns false for null/undefined/empty', () => {
    expect(isPremierTier(null)).toBe(false)
    expect(isPremierTier(undefined)).toBe(false)
    expect(isPremierTier('')).toBe(false)
  })

  it('returns false for unknown levels', () => {
    expect(isPremierTier('apt')).toBe(false)
    expect(isPremierTier('local_league')).toBe(false)
  })
})

describe('isLiveStatus', () => {
  it('returns true for live and on_court', () => {
    expect(isLiveStatus('live')).toBe(true)
    expect(isLiveStatus('on_court')).toBe(true)
  })

  it('returns false for other statuses', () => {
    expect(isLiveStatus('scheduled')).toBe(false)
    expect(isLiveStatus('finished')).toBe(false)
    expect(isLiveStatus('ended')).toBe(false)
    expect(isLiveStatus('retired')).toBe(false)
    expect(isLiveStatus('walkover')).toBe(false)
    expect(isLiveStatus('')).toBe(false)
  })
})

describe('isPresenceOnlyLive', () => {
  it('returns true when status is live/on_court AND tournament is non-Premier', () => {
    expect(isPresenceOnlyLive(
      { status: 'live' },
      { level: 'fip_bronze' },
    )).toBe(true)
    expect(isPresenceOnlyLive(
      { status: 'on_court' },
      { level: 'fip_gold' },
    )).toBe(true)
  })

  it('returns false when tournament is Premier-tier (PBP is expected soon)', () => {
    expect(isPresenceOnlyLive(
      { status: 'live' },
      { level: 'P1' },
    )).toBe(false)
    expect(isPresenceOnlyLive(
      { status: 'on_court' },
      { level: 'Premier_Mens' },
    )).toBe(false)
  })

  it('returns false when status is not live/on_court', () => {
    expect(isPresenceOnlyLive(
      { status: 'finished' },
      { level: 'fip_bronze' },
    )).toBe(false)
    expect(isPresenceOnlyLive(
      { status: 'scheduled' },
      { level: 'fip_bronze' },
    )).toBe(false)
  })

  it('treats unknown tier (null level) as non-Premier — calmer default', () => {
    expect(isPresenceOnlyLive(
      { status: 'live' },
      { level: null },
    )).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import {
  isPremierTier,
  isLiveStatus,
  isPresenceOnlyLive,
  hasLivePointByPoint,
} from '../tournament-tier'

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
      { level: 'p1' },
    )).toBe(false)
    expect(isPresenceOnlyLive(
      { status: 'on_court' },
      { level: 'major' },
    )).toBe(false)
  })

  // FIP Platinum gets PBP from Crionet via padelgod's live-poller —
  // we have evolving sets/games on the match-detail page during play.
  // Distinct from Bronze/Silver/Gold which never see PBP. The Live
  // Feed tab on a Platinum match must NOT be hidden.
  it('returns false for fip_platinum live matches (Crionet PBP via padelgod)', () => {
    expect(isPresenceOnlyLive(
      { status: 'live' },
      { level: 'fip_platinum' },
    )).toBe(false)
    expect(isPresenceOnlyLive(
      { status: 'on_court' },
      { level: 'fip_platinum' },
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

describe('hasLivePointByPoint', () => {
  it('returns false for null/undefined/empty sets', () => {
    expect(hasLivePointByPoint(null)).toBe(false)
    expect(hasLivePointByPoint(undefined)).toBe(false)
    expect(hasLivePointByPoint([])).toBe(false)
  })

  it('returns false when games carry no server and no points', () => {
    expect(hasLivePointByPoint([
      { games: [{ server_player_id: null, points: [] }] },
    ])).toBe(false)
    expect(hasLivePointByPoint([{ games: null }])).toBe(false)
    expect(hasLivePointByPoint([{}])).toBe(false)
  })

  it('returns true when a game has a server assignment', () => {
    expect(hasLivePointByPoint([
      { games: [{ server_player_id: 'player-uuid', points: [] }] },
    ])).toBe(true)
  })

  it('returns true when a game has a non-empty points array', () => {
    expect(hasLivePointByPoint([
      { games: [{ server_player_id: null, points: ['1', '2'] }] },
    ])).toBe(true)
  })
})

describe('isPresenceOnlyLive with live PBP data', () => {
  it('returns false for a non-Premier live match once PBP data is present', () => {
    expect(isPresenceOnlyLive(
      {
        status: 'live',
        sets: [{ games: [{ server_player_id: 'p1-uuid', points: [] }] }],
      },
      { level: 'fip_gold' },
    )).toBe(false)
  })

  it('stays presence-only for a non-Premier live match with no PBP data yet', () => {
    expect(isPresenceOnlyLive(
      { status: 'live', sets: [{ games: [{ server_player_id: null, points: [] }] }] },
      { level: 'fip_gold' },
    )).toBe(true)
  })
})

describe('PPL current-score display', () => {
  const game = { is_current: true, game_score: '15-30', serving_pair: 2, points: [], server_player_id: null }
  const match = { status: 'live', sets: [{ is_current: true, games: [game] }] }
  it.each(['ppl', 'ppl_ii'])('shows %s snapshots without pretending to have point history', level => {
    expect(isPresenceOnlyLive(match, { level })).toBe(false)
    expect(hasLivePointByPoint(match.sets)).toBe(false)
  })
  it.each([
    { ...game, game_score: null }, { ...game, game_score: '' },
    { ...game, game_score: 'bad' }, { ...game, game_score: '2-3' },
    { ...game, serving_pair: null }, { ...game, is_current: false },
  ])('keeps incomplete or inactive snapshots presence-only: %j', g => {
    expect(isPresenceOnlyLive({ ...match, sets: [{ is_current: true, games: [g] }] }, { level: 'ppl' })).toBe(true)
  })
  it('requires a current set and confirmed live status', () => {
    expect(isPresenceOnlyLive({ ...match, sets: [{ is_current: false, games: [game] }] }, { level: 'ppl' })).toBe(true)
    expect(isPresenceOnlyLive({ ...match, status: 'on_court' }, { level: 'ppl' })).toBe(true)
    expect(isPresenceOnlyLive({ status: 'live' }, { level: 'ppl' })).toBe(true)
  })
  it.each([{ ...game, game_score: '0-0' }, { ...game, game_score: '8-9', is_tiebreak: true }])('shows game resets and tiebreaks: %j', g => {
    expect(isPresenceOnlyLive({ ...match, sets: [{ is_current: true, games: [g] }] }, { level: 'ppl' })).toBe(false)
  })
  it('leaves other circuits unchanged for the same snapshot', () => {
    for (const level of ['p1', 'p2', 'major', 'fip_platinum']) expect(isPresenceOnlyLive(match, { level })).toBe(false)
    for (const level of ['fip_gold', 'fip_silver', 'fip_bronze', null]) expect(isPresenceOnlyLive(match, { level })).toBe(true)
  })
})

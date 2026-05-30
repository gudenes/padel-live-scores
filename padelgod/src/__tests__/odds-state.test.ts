import { describe, it, expect } from 'vitest'
import { parsePadelPoints, buildOddsInput, type MatchRows } from '../lib/odds-state'

describe('parsePadelPoints', () => {
  it('maps padel point labels to counts', () => {
    expect(parsePadelPoints('0')).toBe(0)
    expect(parsePadelPoints('15')).toBe(1)
    expect(parsePadelPoints('30')).toBe(2)
    expect(parsePadelPoints('40')).toBe(3)
    expect(parsePadelPoints('AD')).toBe(4)
    expect(parsePadelPoints('A')).toBe(4)
  })
})

describe('buildOddsInput', () => {
  const base: MatchRows = {
    rankings: [1, 2, 200, 210],
    status: 'live',
    sets: [{ pair1_games: 4, pair2_games: 2, is_current: true }],
    currentGame: { game_score: '30-15', server_player_id: null },
    hasRecentPoints: true,
  }
  it('live with points → full confidence input, oriented score', () => {
    const input = buildOddsInput(base)
    expect(input.pointByPoint).toBe(true)
    expect(input.score?.gamesInSet).toEqual([4, 2])
    expect(input.score?.currentGamePoints).toEqual([2, 1]) // 30-15
    expect(input.score?.goldenPoint).toBe(true)
  })
  it('scheduled → score null (pre-match)', () => {
    const input = buildOddsInput({ ...base, status: 'scheduled', sets: [], currentGame: null, hasRecentPoints: false })
    expect(input.score).toBeNull()
  })
  it('6-6 with a current game → tiebreak', () => {
    const input = buildOddsInput({
      ...base,
      sets: [{ pair1_games: 6, pair2_games: 6, is_current: true }],
      currentGame: { game_score: '5-3', server_player_id: null },
    })
    expect(input.score?.inTiebreak).toBe(true)
    expect(input.score?.tiebreakPoints).toEqual([5, 3])
  })
})

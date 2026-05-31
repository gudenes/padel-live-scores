import { describe, it, expect } from 'vitest'
import { parsePadelPoints, buildScoreState, type SetRow } from '../live-score-state.js'

describe('parsePadelPoints', () => {
  it('maps labels to counts', () => {
    expect([parsePadelPoints('0'), parsePadelPoints('15'), parsePadelPoints('30'),
            parsePadelPoints('40'), parsePadelPoints('AD'), parsePadelPoints('A')])
      .toEqual([0, 1, 2, 3, 4, 4])
  })
})

describe('buildScoreState', () => {
  const sets: SetRow[] = [
    { pair1_games: 6, pair2_games: 3, is_current: false },
    { pair1_games: 4, pair2_games: 2, is_current: true },
  ]
  it('sets won + current games + current points (30-15)', () => {
    const s = buildScoreState(sets, { game_score: '30-15' })
    expect(s.setsWon).toEqual([1, 0])
    expect(s.gamesInSet).toEqual([4, 2])
    expect(s.currentGamePoints).toEqual([2, 1])
    expect(s.inTiebreak).toBe(false)
    expect(s.goldenPoint).toBe(true)
  })
  it('6-6 with a current game → tiebreak with raw points', () => {
    const s = buildScoreState([{ pair1_games: 6, pair2_games: 6, is_current: true }], { game_score: '5-3' })
    expect(s.inTiebreak).toBe(true)
    expect(s.tiebreakPoints).toEqual([5, 3])
  })
  it('no current game → zero points', () => {
    const s = buildScoreState([{ pair1_games: 2, pair2_games: 1, is_current: true }], null)
    expect(s.currentGamePoints).toEqual([0, 0])
  })
})

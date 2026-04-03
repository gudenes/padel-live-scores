/**
 * padel-scoring.test.ts
 *
 * Comprehensive unit tests for the padel scoring engine.
 * Run with: npx vitest run src/lib/__tests__/padel-scoring.test.ts
 */

import { describe, it, expect } from 'vitest'
import {
  createInitialState,
  addPoint,
  undoPoint,
  quickGame,
  stateToRelayPayload,
  stateToDbFormat,
} from '../padel-scoring'
import type { MatchState } from '../padel-scoring'

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------

describe('createInitialState', () => {
  it('returns a match in scheduled status', () => {
    const state = createInitialState()
    expect(state.status).toBe('scheduled')
  })

  it('starts at set 1, game 1', () => {
    const state = createInitialState()
    expect(state.currentSet).toBe(1)
    expect(state.currentGame).toBe(1)
  })

  it('has one set with one game at 0:0', () => {
    const state = createInitialState()
    expect(state.sets).toHaveLength(1)
    const set = state.sets[0]
    expect(set.setNumber).toBe(1)
    expect(set.pair1Games).toBe(0)
    expect(set.pair2Games).toBe(0)
    expect(set.games).toHaveLength(1)
    expect(set.games[0].pair1Points).toBe('0')
    expect(set.games[0].pair2Points).toBe('0')
    expect(set.games[0].winner).toBeNull()
  })

  it('has no winner', () => {
    const state = createInitialState()
    expect(state.winner).toBeNull()
  })

  it('servingPair is 1', () => {
    const state = createInitialState()
    expect(state.servingPair).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// addPoint — standard game scoring
// ---------------------------------------------------------------------------

describe('addPoint — standard game scoring', () => {
  it('transitions 0 → 15 → 30 → 40 → game for pair 1', () => {
    let state = createInitialState()
    state = addPoint(state, 1)
    expect(state.sets[0].games[0].pair1Points).toBe('15')
    expect(state.sets[0].games[0].pair2Points).toBe('0')

    state = addPoint(state, 1)
    expect(state.sets[0].games[0].pair1Points).toBe('30')

    state = addPoint(state, 1)
    expect(state.sets[0].games[0].pair1Points).toBe('40')

    state = addPoint(state, 1)
    // Game won — a new game should be started
    expect(state.sets[0].pair1Games).toBe(1)
    expect(state.sets[0].pair2Games).toBe(0)
  })

  it('transitions 0 → 15 → 30 → 40 → game for pair 2', () => {
    let state = createInitialState()
    state = addPoint(state, 2)
    state = addPoint(state, 2)
    state = addPoint(state, 2)
    state = addPoint(state, 2)
    expect(state.sets[0].pair1Games).toBe(0)
    expect(state.sets[0].pair2Games).toBe(1)
  })

  it('records points array in game state', () => {
    let state = createInitialState()
    state = addPoint(state, 1)
    state = addPoint(state, 2)
    const game = state.sets[0].games[0]
    expect(game.points).toContain('15:0')
    expect(game.points).toContain('15:15')
  })

  it('sets status to live on first point', () => {
    let state = createInitialState()
    state = addPoint(state, 1)
    expect(state.status).toBe('live')
  })
})

// ---------------------------------------------------------------------------
// addPoint — deuce / advantage
// ---------------------------------------------------------------------------

describe('addPoint — deuce and advantage', () => {
  function reachDeuce(): MatchState {
    let state = createInitialState()
    // 40-40 deuce: each pair scores 3 points
    for (let i = 0; i < 3; i++) state = addPoint(state, 1)
    for (let i = 0; i < 3; i++) state = addPoint(state, 2)
    return state
  }

  it('reaches deuce at 40-40', () => {
    const state = reachDeuce()
    const game = state.sets[0].games[0]
    expect(game.pair1Points).toBe('40')
    expect(game.pair2Points).toBe('40')
    expect(game.winner).toBeNull()
  })

  it('awards advantage to pair 1 after deuce', () => {
    let state = reachDeuce()
    state = addPoint(state, 1)
    const game = state.sets[0].games[0]
    expect(game.pair1Points).toBe('A')
    expect(game.pair2Points).toBe('40')
  })

  it('awards advantage to pair 2 after deuce', () => {
    let state = reachDeuce()
    state = addPoint(state, 2)
    const game = state.sets[0].games[0]
    expect(game.pair1Points).toBe('40')
    expect(game.pair2Points).toBe('A')
  })

  it('pair 1 wins game from advantage', () => {
    let state = reachDeuce()
    state = addPoint(state, 1) // A:40
    state = addPoint(state, 1) // game
    expect(state.sets[0].pair1Games).toBe(1)
  })

  it('pair 2 wins game from advantage', () => {
    let state = reachDeuce()
    state = addPoint(state, 2) // 40:A
    state = addPoint(state, 2) // game
    expect(state.sets[0].pair2Games).toBe(1)
  })

  it('returns to deuce when opponent scores against advantage', () => {
    let state = reachDeuce()
    state = addPoint(state, 1) // A:40
    state = addPoint(state, 2) // back to 40:40
    const game = state.sets[0].games[0]
    expect(game.pair1Points).toBe('40')
    expect(game.pair2Points).toBe('40')
  })

  it('can oscillate deuce multiple times before winning', () => {
    let state = reachDeuce()
    for (let i = 0; i < 3; i++) {
      state = addPoint(state, 1)  // A:40
      state = addPoint(state, 2)  // 40:40
    }
    state = addPoint(state, 1) // A:40
    state = addPoint(state, 1) // game for pair 1
    expect(state.sets[0].pair1Games).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// addPoint — set scoring
// ---------------------------------------------------------------------------

describe('addPoint — set scoring', () => {
  function playGame(state: MatchState, winner: 1 | 2): MatchState {
    // Score 4 points for the winner (love game)
    for (let i = 0; i < 4; i++) {
      state = addPoint(state, winner)
    }
    return state
  }

  it('pair 1 wins set 6-0', () => {
    let state = createInitialState()
    for (let g = 0; g < 6; g++) state = playGame(state, 1)
    expect(state.sets[0].pair1Games).toBe(6)
    expect(state.sets[0].pair2Games).toBe(0)
    expect(state.sets[0].winner).toBe(1)
  })

  it('pair 2 wins set 6-0', () => {
    let state = createInitialState()
    for (let g = 0; g < 6; g++) state = playGame(state, 2)
    expect(state.sets[0].winner).toBe(2)
    expect(state.sets[0].pair1Games).toBe(0)
    expect(state.sets[0].pair2Games).toBe(6)
  })

  it('pair 1 wins set 6-4', () => {
    let state = createInitialState()
    for (let g = 0; g < 4; g++) state = playGame(state, 1)
    for (let g = 0; g < 4; g++) state = playGame(state, 2)
    for (let g = 0; g < 2; g++) state = playGame(state, 1)
    expect(state.sets[0].pair1Games).toBe(6)
    expect(state.sets[0].pair2Games).toBe(4)
    expect(state.sets[0].winner).toBe(1)
  })

  it('pair 1 wins set 7-5', () => {
    let state = createInitialState()
    for (let g = 0; g < 5; g++) state = playGame(state, 1)
    for (let g = 0; g < 5; g++) state = playGame(state, 2)
    // 5-5, now pair 1 wins 2 more
    state = playGame(state, 1)
    state = playGame(state, 1)
    expect(state.sets[0].pair1Games).toBe(7)
    expect(state.sets[0].pair2Games).toBe(5)
    expect(state.sets[0].winner).toBe(1)
  })

  it('no set win until 2-game lead at 6+', () => {
    // Interleave game wins to reach 6-5 without triggering a 6-0/6-4 set win
    let state = createInitialState()
    // Each pair wins alternating games: 1,2,1,2,1,2,1,2,1,2 = 5-5, then pair1 gets to 6-5
    for (let g = 0; g < 5; g++) {
      state = playGame(state, 1)
      state = playGame(state, 2)
    }
    // Now 5-5, pair 1 wins one more → 6-5
    state = playGame(state, 1)
    // 6-5: no winner yet (need 2-game lead)
    const currentSet = state.sets[state.currentSet - 1]
    expect(currentSet.winner).toBeNull()
    state = playGame(state, 2)
    // 6-6: tiebreak should trigger, still no set winner
    const afterSet = state.sets[state.currentSet - 1]
    expect(afterSet.winner).toBeNull()
    expect(afterSet.isTiebreak).toBe(true)
  })

  it('starts a new set after set win', () => {
    let state = createInitialState()
    for (let g = 0; g < 6; g++) state = playGame(state, 1)
    expect(state.sets).toHaveLength(2)
    expect(state.currentSet).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// addPoint — tiebreak
// ---------------------------------------------------------------------------

describe('addPoint — tiebreak', () => {
  /** Play to 6-6 in set 1 by alternating game wins, then pair 2 catches up */
  function reachTiebreak(): MatchState {
    let state = createInitialState()
    // Alternate 6 games each to reach 6-6
    for (let g = 0; g < 6; g++) {
      for (let p = 0; p < 4; p++) state = addPoint(state, 1)
      for (let p = 0; p < 4; p++) state = addPoint(state, 2)
    }
    return state
  }

  it('triggers tiebreak at 6-6', () => {
    const state = reachTiebreak()
    const set = state.sets[0]
    expect(set.pair1Games).toBe(6)
    expect(set.pair2Games).toBe(6)
    expect(set.isTiebreak).toBe(true)
  })

  it('uses numeric scoring in tiebreak (not 15/30/40)', () => {
    let state = reachTiebreak()
    state = addPoint(state, 1)
    const currentSet = state.sets.find(s => s.winner === null)!
    const currentGame = currentSet.games[currentSet.games.length - 1]
    expect(currentGame.pair1Points).toBe('1')
    expect(currentGame.pair2Points).toBe('0')
  })

  it('tiebreak increments numerically', () => {
    let state = reachTiebreak()
    state = addPoint(state, 1)
    state = addPoint(state, 1)
    state = addPoint(state, 2)
    const currentSet = state.sets.find(s => s.winner === null)!
    const currentGame = currentSet.games[currentSet.games.length - 1]
    expect(currentGame.pair1Points).toBe('2')
    expect(currentGame.pair2Points).toBe('1')
  })

  it('tiebreak win at 7-0 (minimum win)', () => {
    let state = reachTiebreak()
    for (let i = 0; i < 7; i++) state = addPoint(state, 1)
    expect(state.sets[0].winner).toBe(1)
    expect(state.sets[0].pair1Games).toBe(7)
    expect(state.sets[0].pair2Games).toBe(6)
  })

  it('tiebreak requires 2-point lead at 6+', () => {
    let state = reachTiebreak()
    for (let i = 0; i < 6; i++) state = addPoint(state, 1)
    for (let i = 0; i < 6; i++) state = addPoint(state, 2)
    // 6-6 tiebreak score: no winner yet
    expect(state.sets[0].winner).toBeNull()
  })

  it('tiebreak win at 8-6', () => {
    let state = reachTiebreak()
    for (let i = 0; i < 6; i++) state = addPoint(state, 1)
    for (let i = 0; i < 6; i++) state = addPoint(state, 2)
    state = addPoint(state, 1)
    state = addPoint(state, 1)
    expect(state.sets[0].winner).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// addPoint — service alternation
// ---------------------------------------------------------------------------

describe('addPoint — service alternation', () => {
  function playGame(state: MatchState, winner: 1 | 2): MatchState {
    for (let i = 0; i < 4; i++) state = addPoint(state, winner)
    return state
  }

  it('server does not change within a game', () => {
    let state = createInitialState()
    const initialServer = state.servingPair
    state = addPoint(state, 1)
    expect(state.servingPair).toBe(initialServer)
    state = addPoint(state, 1)
    expect(state.servingPair).toBe(initialServer)
  })

  it('server alternates after each game', () => {
    let state = createInitialState()
    const initialServer = state.servingPair
    state = playGame(state, 1)
    expect(state.servingPair).toBe(initialServer === 1 ? 2 : 1)
    state = playGame(state, 1)
    expect(state.servingPair).toBe(initialServer)
  })
})

// ---------------------------------------------------------------------------
// addPoint — match completion
// ---------------------------------------------------------------------------

describe('addPoint — match completion', () => {
  function playGame(state: MatchState, winner: 1 | 2): MatchState {
    for (let i = 0; i < 4; i++) state = addPoint(state, winner)
    return state
  }

  function playSet(state: MatchState, winner: 1 | 2): MatchState {
    for (let g = 0; g < 6; g++) state = playGame(state, winner)
    return state
  }

  it('match ends after 2 sets won by same pair (2-0)', () => {
    let state = createInitialState()
    state = playSet(state, 1)
    state = playSet(state, 1)
    expect(state.status).toBe('finished')
    expect(state.winner).toBe(1)
  })

  it('pair 2 wins match 2-0', () => {
    let state = createInitialState()
    state = playSet(state, 2)
    state = playSet(state, 2)
    expect(state.winner).toBe(2)
    expect(state.status).toBe('finished')
  })

  it('third set plays when 1-1 in sets', () => {
    let state = createInitialState()
    state = playSet(state, 1)
    state = playSet(state, 2)
    expect(state.status).toBe('live')
    expect(state.winner).toBeNull()
    expect(state.sets).toHaveLength(3)
    expect(state.currentSet).toBe(3)
  })

  it('match decided in third set', () => {
    let state = createInitialState()
    state = playSet(state, 1)
    state = playSet(state, 2)
    state = playSet(state, 1)
    expect(state.winner).toBe(1)
    expect(state.status).toBe('finished')
  })

  it('no more points accepted after match is finished', () => {
    let state = createInitialState()
    state = playSet(state, 1)
    state = playSet(state, 1)
    const finishedState = state
    const after = addPoint(state, 2)
    // State should be unchanged
    expect(after.winner).toBe(1)
    expect(after.sets.length).toBe(finishedState.sets.length)
  })
})

// ---------------------------------------------------------------------------
// undoPoint
// ---------------------------------------------------------------------------

describe('undoPoint', () => {
  it('restores previous state', () => {
    const initial = createInitialState()
    const after = addPoint(initial, 1)
    const history = [initial]
    const result = undoPoint(after, history)
    expect(result.state.sets[0].games[0].pair1Points).toBe('0')
    expect(result.history).toHaveLength(0)
  })

  it('returns same state and empty history when history is empty', () => {
    const state = createInitialState()
    const result = undoPoint(state, [])
    expect(result.state).toBe(state)
    expect(result.history).toHaveLength(0)
  })

  it('pops the last item from history', () => {
    const s0 = createInitialState()
    const s1 = addPoint(s0, 1)
    const s2 = addPoint(s1, 1)
    const history = [s0, s1]
    const result = undoPoint(s2, history)
    expect(result.state.sets[0].games[0].pair1Points).toBe('15')
    expect(result.history).toHaveLength(1)
  })

  it('can undo through a game completion', () => {
    let state = createInitialState()
    const history: MatchState[] = []
    for (let i = 0; i < 4; i++) {
      history.push(state)
      state = addPoint(state, 1)
    }
    // pair 1 has won a game; undo once
    const result = undoPoint(state, history)
    expect(result.state.sets[0].pair1Games).toBe(0)
    expect(result.state.sets[0].games[0].pair1Points).toBe('40')
  })
})

// ---------------------------------------------------------------------------
// quickGame
// ---------------------------------------------------------------------------

describe('quickGame', () => {
  it('completes a game for pair 1', () => {
    const initial = createInitialState()
    const { state } = quickGame(initial, 1)
    expect(state.sets[0].pair1Games).toBe(1)
    expect(state.sets[0].pair2Games).toBe(0)
  })

  it('completes a game for pair 2', () => {
    const initial = createInitialState()
    const { state } = quickGame(initial, 2)
    expect(state.sets[0].pair1Games).toBe(0)
    expect(state.sets[0].pair2Games).toBe(1)
  })

  it('collects history along the way', () => {
    const initial = createInitialState()
    const { history } = quickGame(initial, 1)
    // At least 4 states should be in history (one per point before the last)
    expect(history.length).toBeGreaterThanOrEqual(4)
  })

  it('history starts from initial state', () => {
    const initial = createInitialState()
    const { history } = quickGame(initial, 1)
    expect(history[0]).toBe(initial)
  })

  it('state is different from initial', () => {
    const initial = createInitialState()
    const { state } = quickGame(initial, 1)
    expect(state).not.toBe(initial)
    expect(state.sets[0].pair1Games + state.sets[0].pair2Games).toBeGreaterThan(0)
  })

  it('completes a game already in progress (mid-game, no bleed)', () => {
    let state = createInitialState()
    state = addPoint(state, 1) // 15:0
    state = addPoint(state, 1) // 30:0
    const result = quickGame(state, 1)
    // Should complete this game, not bleed into next
    expect(result.state.sets[0].pair1Games).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// stateToRelayPayload
// ---------------------------------------------------------------------------

describe('stateToRelayPayload', () => {
  it('returns an object with matchId and externalId', () => {
    const state = createInitialState()
    const payload = stateToRelayPayload(state, 'match-1', 'ext-1', 'update')
    expect(payload.matchId).toBe('match-1')
    expect(payload.externalId).toBe('ext-1')
  })

  it('includes the action field', () => {
    const state = createInitialState()
    const payload = stateToRelayPayload(state, 'match-1', 'ext-1', 'simulate')
    expect(payload.action).toBe('simulate')
  })

  it('includes status and sets', () => {
    let state = createInitialState()
    state = addPoint(state, 1)
    const payload = stateToRelayPayload(state, 'match-1', 'ext-1', 'update')
    expect(payload.status).toBe('live')
    expect(Array.isArray(payload.sets)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// stateToDbFormat
// ---------------------------------------------------------------------------

describe('stateToDbFormat', () => {
  it('includes status', () => {
    const state = createInitialState()
    const db = stateToDbFormat(state)
    expect(db.status).toBe('scheduled')
  })

  it('includes sets array', () => {
    const state = createInitialState()
    const db = stateToDbFormat(state)
    expect(Array.isArray(db.sets)).toBe(true)
    expect(db.sets).toHaveLength(1)
  })

  it('set has required fields', () => {
    const state = createInitialState()
    const db = stateToDbFormat(state)
    const set = db.sets[0]
    expect(set).toHaveProperty('set_number', 1)
    expect(set).toHaveProperty('pair1_games', 0)
    expect(set).toHaveProperty('pair2_games', 0)
    expect(set).toHaveProperty('is_current', true)
    expect(set).toHaveProperty('set_score', null) // in progress
  })

  it('game has required fields', () => {
    const state = createInitialState()
    const db = stateToDbFormat(state)
    const game = db.sets[0].games[0]
    expect(game).toHaveProperty('game_number', 1)
    expect(game).toHaveProperty('is_current', true)
    expect(Array.isArray(game.points)).toBe(true)
  })

  it('game_score reflects games won at start of game', () => {
    let state = createInitialState()
    // Win first game for pair 1
    for (let i = 0; i < 4; i++) state = addPoint(state, 1)
    const db = stateToDbFormat(state)
    // Second game's game_score should be "1-0"
    const set = db.sets[0]
    const secondGame = set.games[1]
    expect(secondGame.game_score).toBe('1-0')
  })

  it('set_score is null while set in progress', () => {
    let state = createInitialState()
    state = addPoint(state, 1)
    const db = stateToDbFormat(state)
    expect(db.sets[0].set_score).toBeNull()
  })

  it('set_score is "X-Y" format when set is complete', () => {
    let state = createInitialState()
    for (let g = 0; g < 6; g++) {
      for (let p = 0; p < 4; p++) state = addPoint(state, 1)
    }
    // First set is done (6-0)
    const db = stateToDbFormat(state)
    expect(db.sets[0].set_score).toBe('6-0')
  })

  it('set_score with tiebreak has "(X)" loser points', () => {
    let state = createInitialState()
    // Play to 6-6 by alternating game wins
    for (let g = 0; g < 6; g++) {
      for (let p = 0; p < 4; p++) state = addPoint(state, 1)
      for (let p = 0; p < 4; p++) state = addPoint(state, 2)
    }
    // Win tiebreak 7-0 for pair 1
    for (let i = 0; i < 7; i++) state = addPoint(state, 1)
    const db = stateToDbFormat(state)
    expect(db.sets[0].set_score).toBe('7-6(0)')
  })

  it('formats tiebreak set score with non-zero loser points (7-4 tiebreak)', () => {
    let state = createInitialState()
    // Play to 6-6 by alternating game wins
    for (let g = 0; g < 6; g++) {
      for (let p = 0; p < 4; p++) state = addPoint(state, 1)
      for (let p = 0; p < 4; p++) state = addPoint(state, 2)
    }
    // Tiebreak: pair 2 scores 4 points, pair 1 scores 7 to win 7-4
    for (let i = 0; i < 4; i++) state = addPoint(state, 2)
    for (let i = 0; i < 7; i++) state = addPoint(state, 1)
    const db = stateToDbFormat(state)
    expect(db.sets[0].set_score).toBe('7-6(4)')
  })

  it('completed game has winner_pair set', () => {
    let state = createInitialState()
    for (let i = 0; i < 4; i++) state = addPoint(state, 1)
    const db = stateToDbFormat(state)
    const completedGame = db.sets[0].games[0]
    expect(completedGame.winner_pair).toBe(1)
  })

  it('is_current is false for completed sets', () => {
    let state = createInitialState()
    for (let g = 0; g < 6; g++) {
      for (let p = 0; p < 4; p++) state = addPoint(state, 1)
    }
    const db = stateToDbFormat(state)
    // First set complete, second set is current
    expect(db.sets[0].is_current).toBe(false)
    expect(db.sets[1].is_current).toBe(true)
  })
})

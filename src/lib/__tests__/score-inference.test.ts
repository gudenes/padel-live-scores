/**
 * score-inference.test.ts
 * 
 * Unit tests for the pure scoring functions.
 * Run with: npx vitest run src/lib/__tests__/score-inference.test.ts
 * 
 * These tests cover:
 * - Standard game scoring (0, 15, 30, 40, A)
 * - Tiebreak numeric scoring
 * - Edge cases: empty points, phantom "0:0", golden point, deuce
 * - Set score calculation and validation
 * - Game score parsing
 */

import { describe, it, expect } from 'vitest'
import {
  determineGameWinner,
  isTiebreakGame,
  calculateSetScore,
  parseGameScore,
  isValidSetScore,
} from '../score-inference'

// ---------------------------------------------------------------------------
// determineGameWinner
// ---------------------------------------------------------------------------

describe('determineGameWinner', () => {
  describe('standard scoring', () => {
    it('team 1 wins at 40:0 (love game)', () => {
      const points = ['15:0', '30:0', '40:0']
      expect(determineGameWinner(points, false)).toBe(1)
    })

    it('team 2 wins at 0:40', () => {
      const points = ['0:15', '0:30', '0:40']
      expect(determineGameWinner(points, false)).toBe(2)
    })

    it('team 1 wins at 40:30', () => {
      const points = ['15:0', '15:15', '30:15', '40:15', '40:30']
      expect(determineGameWinner(points, false)).toBe(1)
    })

    it('team 2 wins at 30:40', () => {
      const points = ['0:15', '15:15', '15:30', '30:30', '30:40']
      expect(determineGameWinner(points, false)).toBe(2)
    })

    it('team 1 wins with advantage (A:40)', () => {
      const points = ['15:0', '15:15', '30:15', '30:30', '40:30', '40:40', 'A:40']
      expect(determineGameWinner(points, false)).toBe(1)
    })

    it('team 2 wins with advantage (40:A)', () => {
      const points = ['0:15', '15:15', '30:15', '30:30', '30:40', '40:40', '40:A']
      expect(determineGameWinner(points, false)).toBe(2)
    })

    it('golden point: team 1 wins at 40:40 → next point decides (last recorded = 40:30 equivalent)', () => {
      // In golden point, the API just records the game as won after 40:40
      // The last meaningful point before game end would show the winner ahead
      // But with golden point the winning point is just the last one in array
      const points = ['15:0', '30:0', '30:15', '30:30', '40:30']
      expect(determineGameWinner(points, false)).toBe(1)
    })
  })

  describe('tiebreak scoring', () => {
    it('team 1 wins tiebreak 7:5', () => {
      const points = ['1:0', '2:0', '2:1', '3:1', '3:2', '4:2', '4:3', '5:3', '5:4', '6:4', '6:5', '7:5']
      expect(determineGameWinner(points, true)).toBe(1)
    })

    it('team 2 wins tiebreak 5:7', () => {
      const points = ['0:1', '1:1', '1:2', '2:2', '2:3', '3:3', '3:4', '3:5', '4:5', '5:5', '5:6', '5:7']
      expect(determineGameWinner(points, true)).toBe(2)
    })

    it('team 1 wins extended tiebreak 10:8', () => {
      const points = ['6:6', '7:6', '7:7', '8:7', '8:8', '9:8', '9:9', '10:9', '10:8']
      // Note: the last point shows team 1 ahead
      expect(determineGameWinner(points, true)).toBe(1)
    })

    it('team 2 wins minimal tiebreak 0:7', () => {
      const points = ['0:1', '0:2', '0:3', '0:4', '0:5', '0:6', '0:7']
      expect(determineGameWinner(points, true)).toBe(2)
    })
  })

  describe('edge cases', () => {
    it('returns null for empty points array', () => {
      expect(determineGameWinner([], false)).toBeNull()
    })

    it('filters out "0:0" phantom points and still works', () => {
      const points = ['0:0', '15:0', '30:0', '40:0']
      expect(determineGameWinner(points, false)).toBe(1)
    })

    it('returns null when only "0:0" phantom points exist', () => {
      const points = ['0:0']
      expect(determineGameWinner(points, false)).toBeNull()
    })

    it('returns null for tied score (40:40 with no resolution)', () => {
      const points = ['15:0', '15:15', '30:15', '30:30', '40:30', '40:40']
      expect(determineGameWinner(points, false)).toBeNull()
    })

    it('returns null for malformed point string', () => {
      const points = ['invalid']
      expect(determineGameWinner(points, false)).toBeNull()
    })

    it('returns null for empty string point', () => {
      const points = ['']
      expect(determineGameWinner(points, false)).toBeNull()
    })

    it('handles numeric fallback for unknown standard point values', () => {
      // If we encounter unexpected values, try numeric comparison
      const points = ['99:50']
      expect(determineGameWinner(points, false)).toBe(1)
    })

    it('returns null for equal tiebreak values', () => {
      const points = ['6:6']
      expect(determineGameWinner(points, true)).toBeNull()
    })
  })
})

// ---------------------------------------------------------------------------
// isTiebreakGame
// ---------------------------------------------------------------------------

describe('isTiebreakGame', () => {
  it('is tiebreak when both at 6', () => {
    expect(isTiebreakGame(6, 6)).toBe(true)
  })

  it('is NOT tiebreak at 5-4', () => {
    expect(isTiebreakGame(5, 4)).toBe(false)
  })

  it('is NOT tiebreak at 6-5', () => {
    expect(isTiebreakGame(6, 5)).toBe(false)
  })

  it('is NOT tiebreak at 0-0', () => {
    expect(isTiebreakGame(0, 0)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// calculateSetScore
// ---------------------------------------------------------------------------

describe('calculateSetScore', () => {
  it('5-4 + team 1 wins = 6-4', () => {
    expect(calculateSetScore(5, 4, 1)).toBe('6-4')
  })

  it('4-5 + team 2 wins = 4-6', () => {
    expect(calculateSetScore(4, 5, 2)).toBe('4-6')
  })

  it('5-3 + team 1 wins = 6-3', () => {
    expect(calculateSetScore(5, 3, 1)).toBe('6-3')
  })

  it('6-5 + team 1 wins = 7-5', () => {
    expect(calculateSetScore(6, 5, 1)).toBe('7-5')
  })

  it('5-6 + team 2 wins = 5-7', () => {
    expect(calculateSetScore(5, 6, 2)).toBe('5-7')
  })

  it('6-6 + team 1 wins tiebreak = 7-6', () => {
    expect(calculateSetScore(6, 6, 1)).toBe('7-6')
  })

  it('6-6 + team 2 wins tiebreak = 6-7', () => {
    expect(calculateSetScore(6, 6, 2)).toBe('6-7')
  })

  it('0-5 + team 2 wins = 0-6 (bagel)', () => {
    expect(calculateSetScore(0, 5, 2)).toBe('0-6')
  })

  it('returns null for invalid result: 5-5 + team 1 = 6-5 (not valid)', () => {
    expect(calculateSetScore(5, 5, 1)).toBeNull()
  })

  it('returns null for result exceeding 7 games', () => {
    expect(calculateSetScore(7, 5, 1)).toBeNull()
  })

  it('returns null for too few games: 3-2 + team 1 = 4-2', () => {
    expect(calculateSetScore(3, 2, 1)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// parseGameScore
// ---------------------------------------------------------------------------

describe('parseGameScore', () => {
  it('parses "5 - 4"', () => {
    expect(parseGameScore('5 - 4')).toEqual({ team1: 5, team2: 4 })
  })

  it('parses "5-4" (no spaces)', () => {
    expect(parseGameScore('5-4')).toEqual({ team1: 5, team2: 4 })
  })

  it('parses "0 - 0"', () => {
    expect(parseGameScore('0 - 0')).toEqual({ team1: 0, team2: 0 })
  })

  it('parses "6 - 6"', () => {
    expect(parseGameScore('6 - 6')).toEqual({ team1: 6, team2: 6 })
  })

  it('returns null for null input', () => {
    expect(parseGameScore(null)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseGameScore('')).toBeNull()
  })

  it('returns null for malformed input', () => {
    expect(parseGameScore('abc')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// isValidSetScore
// ---------------------------------------------------------------------------

describe('isValidSetScore', () => {
  const valid = ['6-0', '6-1', '6-2', '6-3', '6-4', '7-5', '7-6', '7-6(4)',
                  '0-6', '1-6', '2-6', '3-6', '4-6', '5-7', '6-7', '6-7(5)']
  const invalid = ['6-5', '5-6', '8-6', '6-8', '0-0', '5-5', '7-7', '7-6()', '']

  valid.forEach(score => {
    it(`"${score}" is valid`, () => {
      expect(isValidSetScore(score)).toBe(true)
    })
  })

  invalid.forEach(score => {
    it(`"${score}" is invalid`, () => {
      expect(isValidSetScore(score)).toBe(false)
    })
  })
})

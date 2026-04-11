import { describe, it, expect } from 'vitest'
import {
  selectDailyQuestions,
  scoreAnswer,
  scoreTapAnswer,
  adjustDifficulty,
} from '../genius-engine'
import type { GeniusQuestion } from '../genius-engine'

const makeQ = (overrides: Partial<GeniusQuestion> = {}): GeniusQuestion => ({
  id: 1,
  type: 'court-scenario',
  difficulty: 1,
  theme: 'shots',
  question: 'Test?',
  court: { players: [] },
  options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
  correctOption: 'a',
  explanation: { title: 'Why', text: 'Because' },
  xp: 100,
  ...overrides,
})

describe('selectDailyQuestions', () => {
  it('returns 5 questions matching theme and difficulty', () => {
    const pool = Array.from({ length: 20 }, (_, i) =>
      makeQ({ id: i + 1, theme: 'shots', difficulty: (i % 3 + 1) as 1 | 2 | 3 })
    )
    const result = selectDailyQuestions(pool, 'shots', 1, [], [])
    expect(result).toHaveLength(5)
    result.forEach(q => expect(q.theme).toBe('shots'))
  })

  it('excludes already-answered questions', () => {
    const pool = Array.from({ length: 10 }, (_, i) =>
      makeQ({ id: i + 1, theme: 'shots', difficulty: 1 })
    )
    const answered = [1, 2, 3, 4, 5]
    const result = selectDailyQuestions(pool, 'shots', 1, answered, [])
    result.forEach(q => expect(answered).not.toContain(q.id))
  })

  it('recycles wrong answers when pool is small', () => {
    const pool = [
      makeQ({ id: 1, theme: 'shots', difficulty: 1 }),
      makeQ({ id: 2, theme: 'shots', difficulty: 1 }),
    ]
    const answered = [1, 2]
    const wrong = [1]
    const result = selectDailyQuestions(pool, 'shots', 1, answered, wrong)
    expect(result.length).toBeGreaterThanOrEqual(2)
    expect(result.some(q => q.id === 1)).toBe(true)
  })

  it('uses all themes for mixed', () => {
    const pool = [
      makeQ({ id: 1, theme: 'shots', difficulty: 1 }),
      makeQ({ id: 2, theme: 'rules', difficulty: 1 }),
      makeQ({ id: 3, theme: 'positioning', difficulty: 1 }),
      makeQ({ id: 4, theme: 'communication', difficulty: 1 }),
      makeQ({ id: 5, theme: 'mixed', difficulty: 1 }),
    ]
    const result = selectDailyQuestions(pool, 'mixed', 1, [], [])
    expect(result).toHaveLength(5)
  })
})

describe('scoreAnswer', () => {
  it('returns correct=true and xp for right answer', () => {
    const q = makeQ({ correctOption: 'a', xp: 150 })
    const result = scoreAnswer(q, 'a', 1)
    expect(result.correct).toBe(true)
    expect(result.xp).toBe(150)
  })

  it('returns correct=false and 0 xp for wrong answer', () => {
    const q = makeQ({ correctOption: 'a', xp: 150 })
    const result = scoreAnswer(q, 'b', 1)
    expect(result.correct).toBe(false)
    expect(result.xp).toBe(0)
  })

  it('applies weekend multiplier', () => {
    const q = makeQ({ correctOption: 'a', xp: 150 })
    const result = scoreAnswer(q, 'a', 2)
    expect(result.xp).toBe(300)
  })
})

describe('scoreTapAnswer', () => {
  it('returns full xp when tap is inside correct zone', () => {
    const q = makeQ({ type: 'court-tap', correctZone: { x: 50, y: 50, radius: 15 }, xp: 150 })
    const result = scoreTapAnswer(q, 50, 50, 1)
    expect(result.correct).toBe(true)
    expect(result.xp).toBe(150)
  })

  it('returns partial xp when close but outside zone', () => {
    const q = makeQ({ type: 'court-tap', correctZone: { x: 50, y: 50, radius: 10 }, xp: 150 })
    const result = scoreTapAnswer(q, 50, 65, 1)
    expect(result.correct).toBe(false)
    expect(result.xp).toBeLessThan(150)
    expect(result.xp).toBeGreaterThan(0)
  })

  it('returns 0 xp when far away', () => {
    const q = makeQ({ type: 'court-tap', correctZone: { x: 50, y: 50, radius: 10 }, xp: 150 })
    const result = scoreTapAnswer(q, 10, 10, 1)
    expect(result.xp).toBe(0)
  })
})

describe('adjustDifficulty', () => {
  it('increases difficulty when accuracy > 80%', () => {
    const recent = [1, 1, 1, 1, 1, 1, 1, 1, 1, 0]
    expect(adjustDifficulty(1, recent)).toBe(2)
  })

  it('decreases difficulty when accuracy < 40%', () => {
    const recent = [0, 0, 0, 0, 0, 0, 0, 1, 1, 1]
    expect(adjustDifficulty(2, recent)).toBe(1)
  })

  it('stays same when accuracy is between 40-80%', () => {
    const recent = [1, 1, 1, 1, 1, 0, 0, 0, 0, 0]
    expect(adjustDifficulty(2, recent)).toBe(2)
  })

  it('caps at 3', () => {
    const recent = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
    expect(adjustDifficulty(3, recent)).toBe(3)
  })

  it('floors at 1', () => {
    const recent = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    expect(adjustDifficulty(1, recent)).toBe(1)
  })

  it('does nothing when fewer than 10 answers', () => {
    const recent = [1, 1, 1, 1, 1]
    expect(adjustDifficulty(1, recent)).toBe(1)
  })
})

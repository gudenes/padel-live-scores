// src/lib/padelgenius/__tests__/scoring.test.ts
import { describe, it, expect } from 'vitest'
import { scoreAnswer } from '../scoring'
import type { Question } from '../types'

const q: Question = {
  id: 1, prompt: 't', theme: 'shots', difficulty: 1,
  court: { players: [] },
  options: [
    { id: 'a', label: 'A', direction: '', letter: { x: 0, y: 0 }, isCorrect: false, outcome: { ball: { x: 0, y: 0 }, trajectory: { from: [0, 0], to: [0, 0], style: 'flat' } } },
    { id: 'b', label: 'B', direction: '', letter: { x: 0, y: 0 }, isCorrect: true,  outcome: { ball: { x: 0, y: 0 }, trajectory: { from: [0, 0], to: [0, 0], style: 'flat' } } },
  ],
  explanation: { title: 't', body: 'b' },
}

describe('scoreAnswer', () => {
  it('returns correct=true and xp=100 when picked is the correct option', () => {
    expect(scoreAnswer(q, 'b')).toEqual({ correct: true, xp: 100 })
  })

  it('returns correct=false and xp=0 when picked is wrong', () => {
    expect(scoreAnswer(q, 'a')).toEqual({ correct: false, xp: 0 })
  })

  it('returns correct=false and xp=0 when picked is null', () => {
    expect(scoreAnswer(q, null)).toEqual({ correct: false, xp: 0 })
  })
})

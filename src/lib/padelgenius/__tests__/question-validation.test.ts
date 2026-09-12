import { describe, it, expect } from 'vitest'
import { validateQuestion } from '../question-validation'
import type { Question } from '../types'

function makeQ(overrides: Partial<Question> = {}): Question {
  return {
    id: 1, prompt: 'Test', theme: 'shots', difficulty: 1,
    court: { players: [
      { role: 'you', x: 40, y: 80 }, { role: 'partner', x: 60, y: 80 },
      { role: 'opponent1', x: 40, y: 20 }, { role: 'opponent2', x: 60, y: 20 },
    ] },
    options: [
      { id: 'a', label: 'A', direction: '', letter: { x: 30, y: 30 }, isCorrect: true,
        outcome: { ball: { x: 30, y: 30 }, trajectory: { from: [50, 50], to: [30, 30], style: 'flat' } } },
      { id: 'b', label: 'B', direction: '', letter: { x: 70, y: 30 }, isCorrect: false,
        outcome: { ball: { x: 70, y: 30 }, trajectory: { from: [50, 50], to: [70, 30], style: 'flat' } } },
    ],
    explanation: { title: 'T', body: 'B' },
    ...overrides,
  }
}

describe('validateQuestion', () => {
  it('passes a valid question', () => {
    const r = validateQuestion(makeQ())
    expect(r.ok).toBe(true)
  })

  it('rejects when no option is correct', () => {
    const q = makeQ()
    q.options.forEach(o => o.isCorrect = false)
    const r = validateQuestion(q)
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('Exactly one option must be marked correct (found 0)')
  })

  it('rejects when multiple options are correct', () => {
    const q = makeQ()
    q.options[1].isCorrect = true
    const r = validateQuestion(q)
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('Exactly one option must be marked correct (found 2)')
  })

  it('rejects coords outside 0–100', () => {
    const q = makeQ()
    q.options[0].letter.x = 150
    const r = validateQuestion(q)
    expect(r.ok).toBe(false)
    expect(r.errors.some(e => /letter|coords|range/i.test(e))).toBe(true)
  })

  it('warns when two letters are very close (overlap)', () => {
    const q = makeQ()
    q.options[1].letter = { x: 31, y: 31 } // ~1.4 units from option a
    const r = validateQuestion(q)
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it('rejects empty prompt', () => {
    const q = makeQ({ prompt: '' })
    const r = validateQuestion(q)
    expect(r.ok).toBe(false)
    expect(r.errors.some(e => /prompt/i.test(e))).toBe(true)
  })

  it('rejects fewer than 3 options', () => {
    const q = makeQ()
    q.options = q.options.slice(0, 1)
    const r = validateQuestion(q)
    expect(r.ok).toBe(false)
    expect(r.errors.some(e => /3.*options|at least/i.test(e))).toBe(true)
  })
})

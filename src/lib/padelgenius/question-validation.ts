// src/lib/padelgenius/question-validation.ts
import type { Question } from './types'

export interface ValidationResult {
  ok: boolean
  errors: string[]
  warnings: string[]
}

function inRange(v: number): boolean { return v >= 0 && v <= 100 }
function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function validateQuestion(q: Question): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!q.prompt || q.prompt.trim().length === 0) errors.push('Prompt is required')
  if (q.options.length < 2) errors.push(`At least 3 options required (got ${q.options.length})`)
  if (q.options.length > 4) errors.push(`At most 4 options (got ${q.options.length})`)

  const correctCount = q.options.filter(o => o.isCorrect).length
  if (correctCount !== 1) errors.push(`Exactly one option must be marked correct (found ${correctCount})`)

  for (const opt of q.options) {
    if (!inRange(opt.letter.x) || !inRange(opt.letter.y)) errors.push(`Option ${opt.id.toUpperCase()}: letter coords out of range 0–100`)
    if (!inRange(opt.outcome.ball.x) || !inRange(opt.outcome.ball.y)) errors.push(`Option ${opt.id.toUpperCase()}: outcome ball out of range`)
    if (opt.outcome.trajectory) {
      const [tfx, tfy] = opt.outcome.trajectory.from
      const [ttx, tty] = opt.outcome.trajectory.to
      if (!inRange(tfx) || !inRange(tfy) || !inRange(ttx) || !inRange(tty)) errors.push(`Option ${opt.id.toUpperCase()}: trajectory endpoints out of range`)
    }
  }

  // Overlap warnings — letters within 5 normalized units of each other
  for (let i = 0; i < q.options.length; i++) {
    for (let j = i + 1; j < q.options.length; j++) {
      if (dist(q.options[i].letter, q.options[j].letter) < 5) {
        warnings.push(`Options ${q.options[i].id.toUpperCase()} and ${q.options[j].id.toUpperCase()} are very close — they may visually overlap`)
      }
    }
  }

  // Player positions
  for (const p of q.court.players) {
    if (!inRange(p.x) || !inRange(p.y)) errors.push(`Player ${p.role}: coords out of range`)
  }

  return { ok: errors.length === 0, errors, warnings }
}

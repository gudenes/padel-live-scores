// src/lib/padelgenius/scoring.ts
import type { Question, OptionId } from './types'

export interface AnswerResult {
  correct: boolean
  xp: number
}

export function scoreAnswer(q: Question, picked: OptionId | null): AnswerResult {
  if (!picked) return { correct: false, xp: 0 }
  const opt = q.options.find(o => o.id === picked)
  if (!opt) return { correct: false, xp: 0 }
  return { correct: opt.isCorrect, xp: opt.isCorrect ? 100 : 0 }
}

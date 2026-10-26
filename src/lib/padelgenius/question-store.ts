// src/lib/padelgenius/question-store.ts
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Question } from './types'

const FILE = path.join(process.cwd(), 'src', 'data', 'genius-questions.json')

export async function loadAllQuestions(): Promise<Question[]> {
  const raw = await fs.readFile(FILE, 'utf-8')
  return JSON.parse(raw) as Question[]
}

export async function loadQuestion(id: number): Promise<Question | null> {
  const all = await loadAllQuestions()
  return all.find(q => q.id === id) ?? null
}

export async function saveQuestion(q: Question): Promise<void> {
  const all = await loadAllQuestions()
  const idx = all.findIndex(x => x.id === q.id)
  if (idx === -1) all.push(q)
  else all[idx] = q
  await fs.writeFile(FILE, JSON.stringify(all, null, 2) + '\n')
}

export async function createQuestion(): Promise<Question> {
  const all = await loadAllQuestions()
  const nextId = (all.reduce((m, q) => Math.max(m, q.id), 0)) + 1
  const newQ: Question = {
    id: nextId,
    prompt: 'New question — edit me',
    theme: 'shots',
    difficulty: 1,
    court: {
      players: [
        { role: 'you',       x: 40, y: 85 },
        { role: 'partner',   x: 60, y: 85 },
        { role: 'opponent1', x: 40, y: 15 },
        { role: 'opponent2', x: 60, y: 15 },
      ],
    },
    options: [
      { id: 'a', label: 'Option A', direction: '', letter: { x: 30, y: 30 }, isCorrect: true,
        outcome: { ball: { x: 30, y: 30 }, trajectory: { from: [50, 50], to: [30, 30], style: 'flat' } } },
      { id: 'b', label: 'Option B', direction: '', letter: { x: 50, y: 30 }, isCorrect: false,
        outcome: { ball: { x: 50, y: 30 }, trajectory: { from: [50, 50], to: [50, 30], style: 'flat' } } },
      { id: 'c', label: 'Option C', direction: '', letter: { x: 70, y: 30 }, isCorrect: false,
        outcome: { ball: { x: 70, y: 30 }, trajectory: { from: [50, 50], to: [70, 30], style: 'flat' } } },
    ],
    explanation: { title: 'Explanation', body: 'Why the correct option works.' },
  }
  all.push(newQ)
  await fs.writeFile(FILE, JSON.stringify(all, null, 2) + '\n')
  return newQ
}

export async function deleteQuestion(id: number): Promise<void> {
  const all = await loadAllQuestions()
  const next = all.filter(q => q.id !== id)
  await fs.writeFile(FILE, JSON.stringify(next, null, 2) + '\n')
}

// scripts/migrate-genius-questions.ts
import { readFileSync, writeFileSync } from 'node:fs'
import type { Question, TrajectoryStyle } from '../src/lib/padelgenius/types'

interface OldQuestion {
  id: number
  type: string
  difficulty: 1 | 2 | 3
  theme: string
  question: string
  court: {
    players: { role: string; x: number; y: number }[]
    ball?: { x: number; y: number }
    trajectory?: { from: [number, number]; to: [number, number] }
  }
  options?: { id: string; label: string; emoji?: string }[]
  correctOption?: string
  explanation: {
    title: string
    text: string
    proTip?: string
    courtOverlay?: { trajectory?: { from: [number, number]; to: [number, number] }; label?: string }
  }
}

const KEYWORDS_TO_STYLE: { regex: RegExp; style: TrajectoryStyle }[] = [
  { regex: /smash/i,    style: 'smash'    },
  { regex: /v[ií]bora/i,style: 'vibora'   },
  { regex: /bandeja/i,  style: 'bandeja'  },
  { regex: /chiquita|drop/i, style: 'chiquita' },
  { regex: /lob|globo/i,style: 'lob'      },
  { regex: /wall|glass/i, style: 'wall-bounce' },
  { regex: /cross/i,    style: 'cross'    },
]

function pickStyle(label: string): TrajectoryStyle {
  for (const { regex, style } of KEYWORDS_TO_STYLE) {
    if (regex.test(label)) return style
  }
  return 'flat'
}

function defaultLetterPosition(idx: number, side: 'far' | 'near' | 'mid'): { x: number; y: number } {
  // Spread letters across the opponent half by default
  const xs = [30, 50, 70, 50]
  const ys = side === 'far' ? [8, 35, 8, 45] : [85, 60, 85, 50]
  return { x: xs[idx] ?? 50, y: ys[idx] ?? 30 }
}

function migrate(old: OldQuestion): Question {
  const correctId = (old.correctOption ?? 'b') as 'a' | 'b' | 'c' | 'd'
  const options = (old.options ?? []).slice(0, 4).map((opt, idx) => {
    const style = pickStyle(opt.label)
    const letter = defaultLetterPosition(idx, 'far')
    const overlayTraj = old.explanation.courtOverlay?.trajectory
    const trajectory = (opt.id === correctId && overlayTraj)
      ? { from: overlayTraj.from, to: overlayTraj.to, style }
      : { from: [50, 50] as [number, number], to: [letter.x, letter.y] as [number, number], style }
    return {
      id: opt.id as 'a' | 'b' | 'c' | 'd',
      label: opt.label.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/\s*[—-]\s*.*/, '').trim() || opt.label,
      direction: '',
      letter,
      isCorrect: opt.id === correctId,
      outcome: {
        ball: { x: trajectory.to[0], y: trajectory.to[1] },
        trajectory,
      },
    }
  })

  return {
    id: old.id,
    prompt: old.question,
    theme: (old.theme as Question['theme']) ?? 'mixed',
    difficulty: old.difficulty,
    court: {
      players: old.court.players.map(p => ({ role: p.role as Question['court']['players'][0]['role'], x: p.x, y: p.y })),
      ball: old.court.ball,
      trajectory: old.court.trajectory ? { ...old.court.trajectory, style: 'flat' } : undefined,
    },
    options,
    explanation: {
      title: old.explanation.title,
      body: old.explanation.text,
      proTip: old.explanation.proTip,
    },
  }
}

const inPath = 'src/data/genius-questions.json'
const old: OldQuestion[] = JSON.parse(readFileSync(inPath, 'utf-8'))
const migrated = old
  .filter(q => q.type === 'court-scenario' || q.type === 'rules-card')
  .map(migrate)
writeFileSync(inPath, JSON.stringify(migrated, null, 2) + '\n')
console.log(`Migrated ${migrated.length} questions (skipped ${old.length - migrated.length} non-court-scenario)`)

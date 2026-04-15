# PadelGenius Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build PadelGenius — a daily padel learning mini-game with 3D court visualization, 3 game modes, avatar system, and daily themed challenges.

**Architecture:** Static JSON question bank + localStorage progress. Pure SVG court rendering with behind-the-player 3D perspective. Single-page app at `/padelgenius` with state-driven view switching (hub → playing → explanation → summary). No new backend tables, no auth required.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS 4, SVG for court rendering. All state in localStorage via custom hooks.

**Spec:** `docs/superpowers/specs/2026-04-11-padelgenius-design.md`

---

## File Structure

```
src/data/
  genius-avatars.ts              # Avatar definitions (icons, colors, names, unlockable flags)
  genius-levels.ts               # Level thresholds, titles, XP requirements
  genius-themes.ts               # Daily theme schedule (day→theme mapping)
  genius-questions.json          # Question bank (50 questions)

src/hooks/
  useGeniusProgress.ts           # localStorage progress hook (read/write/daily reset/streak)

src/app/(app)/padelgenius/
  page.tsx                       # Main page — view state machine + orchestration
  components/
    CourtView.tsx                # 3D SVG court renderer (players, ball, walls, sponsors)
    ChibiPlayer.tsx              # Single chibi character SVG (configurable: role, color, facing)
    HubView.tsx                  # Daily hub — theme card, stats, CTA, week strip, avatar
    QuestionView.tsx             # Question display + answer selection + court tap
    ExplanationView.tsx          # Post-answer explanation with court overlay
    SummaryView.tsx              # End-of-day results — score, XP, streak, breakdown
    AvatarPicker.tsx             # Avatar customization (icon + color picker)
    WeekStrip.tsx                # Mon-Sun calendar strip with completion indicators

src/lib/
  genius-engine.ts               # Pure functions: question selection, scoring, difficulty adjustment
```

---

### Task 1: Data Layer — Avatars, Levels, Themes

**Files:**
- Create: `src/data/genius-avatars.ts`
- Create: `src/data/genius-levels.ts`
- Create: `src/data/genius-themes.ts`

- [ ] **Step 1: Create avatar definitions**

```typescript
// src/data/genius-avatars.ts

export interface GeniusAvatar {
  icon: string
  name: string
  colorFrom: string
  colorTo: string
  minLevel: number  // 0 = starter, 5/7 = unlockable
}

export const GENIUS_AVATARS: GeniusAvatar[] = [
  { icon: '🎾', name: 'Ace',    colorFrom: '#38C8FF', colorTo: '#0066aa', minLevel: 0 },
  { icon: '🏸', name: 'Volley', colorFrom: '#F472B6', colorTo: '#cc3388', minLevel: 0 },
  { icon: '💪', name: 'Smash',  colorFrom: '#7ED321', colorTo: '#4a8c10', minLevel: 0 },
  { icon: '⚡', name: 'Flash',  colorFrom: '#FFDD00', colorTo: '#cc9900', minLevel: 0 },
  { icon: '🔥', name: 'Fuego',  colorFrom: '#FF4655', colorTo: '#cc2233', minLevel: 0 },
  { icon: '🧠', name: 'Tactic', colorFrom: '#9B59B6', colorTo: '#6c3483', minLevel: 0 },
  { icon: '🌶️', name: 'Nacho',  colorFrom: '#E67E22', colorTo: '#a85c16', minLevel: 0 },
  { icon: '🎯', name: 'Sniper', colorFrom: '#1ABC9C', colorTo: '#0e8c72', minLevel: 0 },
  { icon: '🧊', name: 'Ice',    colorFrom: '#3498DB', colorTo: '#1a6aab', minLevel: 0 },
  { icon: '🦁', name: 'Leon',   colorFrom: '#E74C3C', colorTo: '#a83229', minLevel: 0 },
  { icon: '👑', name: 'King',   colorFrom: '#F5A623', colorTo: '#c47d0a', minLevel: 5 },
  { icon: '💎', name: 'Diamond',colorFrom: '#00D4FF', colorTo: '#0088aa', minLevel: 5 },
  { icon: '🏆', name: 'Champ',  colorFrom: '#FFD700', colorTo: '#b8960f', minLevel: 7 },
  { icon: '🌟', name: 'Legend', colorFrom: '#FF6B9D', colorTo: '#cc2266', minLevel: 7 },
]

export function getStarterAvatars(): GeniusAvatar[] {
  return GENIUS_AVATARS.filter(a => a.minLevel === 0)
}

export function getRandomStarterAvatar(): GeniusAvatar {
  const starters = getStarterAvatars()
  return starters[Math.floor(Math.random() * starters.length)]
}

export function getUnlockedAvatars(level: number): GeniusAvatar[] {
  return GENIUS_AVATARS.filter(a => a.minLevel <= level)
}
```

- [ ] **Step 2: Create level definitions**

```typescript
// src/data/genius-levels.ts

export interface GeniusLevel {
  level: number
  title: string
  xpRequired: number
}

export const GENIUS_LEVELS: GeniusLevel[] = [
  { level: 1, title: 'Rookie',       xpRequired: 0 },
  { level: 2, title: 'Club Player',  xpRequired: 500 },
  { level: 3, title: 'Regular',      xpRequired: 1500 },
  { level: 4, title: 'Tactician',    xpRequired: 3000 },
  { level: 5, title: 'Court Reader', xpRequired: 5000 },
  { level: 6, title: 'Strategist',   xpRequired: 8000 },
  { level: 7, title: 'PadelGenius',  xpRequired: 12000 },
]

export function getLevelForXp(xp: number): GeniusLevel {
  for (let i = GENIUS_LEVELS.length - 1; i >= 0; i--) {
    if (xp >= GENIUS_LEVELS[i].xpRequired) return GENIUS_LEVELS[i]
  }
  return GENIUS_LEVELS[0]
}

export function getNextLevel(currentLevel: number): GeniusLevel | null {
  const idx = GENIUS_LEVELS.findIndex(l => l.level === currentLevel)
  return idx < GENIUS_LEVELS.length - 1 ? GENIUS_LEVELS[idx + 1] : null
}

export function getXpProgress(xp: number): { current: GeniusLevel; next: GeniusLevel | null; progress: number } {
  const current = getLevelForXp(xp)
  const next = getNextLevel(current.level)
  if (!next) return { current, next: null, progress: 1 }
  const range = next.xpRequired - current.xpRequired
  const earned = xp - current.xpRequired
  return { current, next, progress: range > 0 ? earned / range : 0 }
}
```

- [ ] **Step 3: Create theme schedule**

```typescript
// src/data/genius-themes.ts

export interface DailyTheme {
  key: 'rules' | 'shots' | 'positioning' | 'communication' | 'mixed'
  name: string
  emoji: string
  description: string
  isWeekendBonus: boolean
  xpMultiplier: number
}

const THEME_SCHEDULE: Record<number, DailyTheme> = {
  1: { key: 'rules',         name: 'Rules & Scoring',   emoji: '📐', description: 'Test your knowledge of padel rules, scoring, and court regulations.', isWeekendBonus: false, xpMultiplier: 1 },
  2: { key: 'shots',         name: 'Shot Selection',    emoji: '🎯', description: 'Master when to play a bandeja, vibora, smash, or chiquita.', isWeekendBonus: false, xpMultiplier: 1 },
  3: { key: 'positioning',   name: 'Positioning',       emoji: '📍', description: 'Learn where to stand on court in every situation.', isWeekendBonus: false, xpMultiplier: 1 },
  4: { key: 'communication', name: 'Communication',     emoji: '💬', description: 'Know what to call and when to talk to your partner.', isWeekendBonus: false, xpMultiplier: 1 },
  5: { key: 'mixed',         name: 'Mixed Challenge',   emoji: '⚡', description: 'A mix of everything — rules, shots, positioning, and communication.', isWeekendBonus: false, xpMultiplier: 1 },
  6: { key: 'mixed',         name: 'Weekend Bonus',     emoji: '🏆', description: 'Harder questions, double XP. Prove yourself.', isWeekendBonus: true, xpMultiplier: 2 },
  0: { key: 'mixed',         name: 'Weekend Bonus',     emoji: '🏆', description: 'Harder questions, double XP. Prove yourself.', isWeekendBonus: true, xpMultiplier: 2 },
}

export function getTodayTheme(): DailyTheme {
  const dayOfWeek = new Date().getDay() // 0=Sun, 1=Mon, ...
  return THEME_SCHEDULE[dayOfWeek]
}

export function getThemeForDay(dayOfWeek: number): DailyTheme {
  return THEME_SCHEDULE[dayOfWeek] || THEME_SCHEDULE[5]
}
```

- [ ] **Step 4: Commit**

```bash
git add src/data/genius-avatars.ts src/data/genius-levels.ts src/data/genius-themes.ts
git commit -m "feat(genius): add avatar, level, and theme data definitions"
```

---

### Task 2: Game Engine — Pure Functions

**Files:**
- Create: `src/lib/genius-engine.ts`
- Create: `src/lib/__tests__/genius-engine.test.ts`

- [ ] **Step 1: Write failing tests for the engine**

```typescript
// src/lib/__tests__/genius-engine.test.ts
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
    expect(result.some(q => q.id === 1)).toBe(true) // wrong answer recycled
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
    const result = scoreTapAnswer(q, 50, 65, 1) // 15 units away, radius 10
    expect(result.correct).toBe(false)
    expect(result.xp).toBeLessThan(150)
    expect(result.xp).toBeGreaterThan(0)
  })

  it('returns 0 xp when far away', () => {
    const q = makeQ({ type: 'court-tap', correctZone: { x: 50, y: 50, radius: 10 }, xp: 150 })
    const result = scoreTapAnswer(q, 10, 10, 1) // very far
    expect(result.xp).toBe(0)
  })
})

describe('adjustDifficulty', () => {
  it('increases difficulty when accuracy > 80%', () => {
    const recent = [1, 1, 1, 1, 1, 1, 1, 1, 1, 0] // 90%
    expect(adjustDifficulty(1, recent)).toBe(2)
  })

  it('decreases difficulty when accuracy < 40%', () => {
    const recent = [0, 0, 0, 0, 0, 0, 0, 1, 1, 1] // 30%
    expect(adjustDifficulty(2, recent)).toBe(1)
  })

  it('stays same when accuracy is between 40-80%', () => {
    const recent = [1, 1, 1, 1, 1, 0, 0, 0, 0, 0] // 50%
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/genius-engine.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the engine**

```typescript
// src/lib/genius-engine.ts

export interface GeniusQuestion {
  id: number
  type: 'court-scenario' | 'court-tap' | 'rules-card'
  difficulty: 1 | 2 | 3
  theme: 'rules' | 'shots' | 'positioning' | 'communication' | 'mixed'
  question: string
  context?: string
  court: {
    players: { role: 'you' | 'partner' | 'opponent1' | 'opponent2'; x: number; y: number }[]
    ball?: { x: number; y: number }
    trajectory?: { from: [number, number]; to: [number, number] }
    highlights?: { type: 'zone' | 'arrow' | 'label'; coords: number[]; label?: string; color?: string }[]
  }
  options?: { id: string; label: string; description?: string; emoji?: string }[]
  correctOption?: string
  correctZone?: { x: number; y: number; radius: number }
  explanation: {
    title: string
    text: string
    proTip?: string
    courtOverlay?: {
      trajectory?: { from: [number, number]; to: [number, number] }
      wrongTrajectory?: { from: [number, number]; to: [number, number]; label?: string }
      label?: string
    }
  }
  xp: number
}

export interface AnswerResult {
  correct: boolean
  xp: number
  distance?: number // for court-tap, normalized 0-100
}

// ── Question Selection ─────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function selectDailyQuestions(
  allQuestions: GeniusQuestion[],
  themeKey: string,
  currentDifficulty: 1 | 2 | 3,
  answeredAll: number[],
  wrongAnswers: number[],
  count: number = 5,
): GeniusQuestion[] {
  const answeredSet = new Set(answeredAll)
  const wrongSet = new Set(wrongAnswers)

  // Filter by theme (mixed = all themes)
  const themeFiltered = themeKey === 'mixed'
    ? allQuestions
    : allQuestions.filter(q => q.theme === themeKey || q.theme === 'mixed')

  // Filter by difficulty range (±1)
  const diffMin = Math.max(1, currentDifficulty - 1) as 1 | 2 | 3
  const diffMax = Math.min(3, currentDifficulty + 1) as 1 | 2 | 3
  const diffFiltered = themeFiltered.filter(q => q.difficulty >= diffMin && q.difficulty <= diffMax)

  // Prefer unseen questions
  const unseen = diffFiltered.filter(q => !answeredSet.has(q.id))

  if (unseen.length >= count) {
    return shuffle(unseen).slice(0, count)
  }

  // Not enough unseen — add wrong answers for retry
  const wrongRetry = diffFiltered.filter(q => wrongSet.has(q.id) && !unseen.some(u => u.id === q.id))
  const combined = [...unseen, ...wrongRetry]

  if (combined.length >= count) {
    return shuffle(combined).slice(0, count)
  }

  // Still not enough — recycle oldest answered
  const recycled = diffFiltered.filter(q => !combined.some(c => c.id === q.id))
  const all = [...combined, ...shuffle(recycled)]

  return all.slice(0, count)
}

// ── Scoring ────────────────────────────────────────────────────

export function scoreAnswer(
  question: GeniusQuestion,
  selectedOptionId: string,
  xpMultiplier: number = 1,
): AnswerResult {
  const correct = selectedOptionId === question.correctOption
  return {
    correct,
    xp: correct ? question.xp * xpMultiplier : 0,
  }
}

export function scoreTapAnswer(
  question: GeniusQuestion,
  tapX: number,
  tapY: number,
  xpMultiplier: number = 1,
): AnswerResult {
  const zone = question.correctZone
  if (!zone) return { correct: false, xp: 0 }

  const dx = tapX - zone.x
  const dy = tapY - zone.y
  const distance = Math.sqrt(dx * dx + dy * dy)

  if (distance <= zone.radius) {
    return { correct: true, xp: question.xp * xpMultiplier, distance }
  }

  // Partial credit: up to 2× radius gives declining XP
  const maxPartialDistance = zone.radius * 2.5
  if (distance <= maxPartialDistance) {
    const ratio = 1 - (distance - zone.radius) / (maxPartialDistance - zone.radius)
    const partialXp = Math.round(question.xp * ratio * 0.5 * xpMultiplier)
    return { correct: false, xp: partialXp, distance }
  }

  return { correct: false, xp: 0, distance }
}

// ── Difficulty Adjustment ──────────────────────────────────────

export function adjustDifficulty(
  currentDifficulty: 1 | 2 | 3,
  recentAccuracy: number[],
): 1 | 2 | 3 {
  if (recentAccuracy.length < 10) return currentDifficulty

  const last10 = recentAccuracy.slice(-10)
  const accuracy = last10.reduce((a, b) => a + b, 0) / 10

  if (accuracy > 0.8 && currentDifficulty < 3) {
    return (currentDifficulty + 1) as 1 | 2 | 3
  }
  if (accuracy < 0.4 && currentDifficulty > 1) {
    return (currentDifficulty - 1) as 1 | 2 | 3
  }
  return currentDifficulty
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/genius-engine.test.ts`
Expected: All 11 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/genius-engine.ts src/lib/__tests__/genius-engine.test.ts
git commit -m "feat(genius): add game engine with question selection, scoring, difficulty"
```

---

### Task 3: Progress Hook — localStorage

**Files:**
- Create: `src/hooks/useGeniusProgress.ts`

- [ ] **Step 1: Implement the progress hook**

```typescript
// src/hooks/useGeniusProgress.ts
'use client'

import { useState, useEffect, useCallback } from 'react'
import { getRandomStarterAvatar } from '@/data/genius-avatars'
import { getLevelForXp } from '@/data/genius-levels'
import { adjustDifficulty } from '@/lib/genius-engine'

const STORAGE_KEY = 'pn_genius_progress'

export interface GeniusProgressState {
  todayDate: string
  todayAnswered: number[]
  todayCorrect: number
  totalXp: number
  level: number
  streak: number
  bestStreak: number
  lastPlayedDate: string
  answeredAll: number[]
  wrongAnswers: number[]
  currentDifficulty: 1 | 2 | 3
  recentAccuracy: number[]
  avatar: { icon: string; color: string; name: string }
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function createDefaultProgress(): GeniusProgressState {
  const avatar = getRandomStarterAvatar()
  return {
    todayDate: todayStr(),
    todayAnswered: [],
    todayCorrect: 0,
    totalXp: 0,
    level: 1,
    streak: 0,
    bestStreak: 0,
    lastPlayedDate: '',
    answeredAll: [],
    wrongAnswers: [],
    currentDifficulty: 1,
    recentAccuracy: [],
    avatar: { icon: avatar.icon, color: avatar.colorFrom, name: avatar.name },
  }
}

function readProgress(): GeniusProgressState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createDefaultProgress()
    const parsed = JSON.parse(raw) as GeniusProgressState
    // Reset daily state if new day
    if (parsed.todayDate !== todayStr()) {
      parsed.todayDate = todayStr()
      parsed.todayAnswered = []
      parsed.todayCorrect = 0
    }
    return parsed
  } catch {
    return createDefaultProgress()
  }
}

function writeProgress(state: GeniusProgressState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch { /* ignore */ }
}

export function useGeniusProgress() {
  const [progress, setProgress] = useState<GeniusProgressState>(createDefaultProgress)
  const [loaded, setLoaded] = useState(false)

  // Hydrate from localStorage on mount
  useEffect(() => {
    const stored = readProgress()
    setProgress(stored)
    setLoaded(true)
  }, [])

  const save = useCallback((updater: (prev: GeniusProgressState) => GeniusProgressState) => {
    setProgress(prev => {
      const next = updater(prev)
      writeProgress(next)
      return next
    })
  }, [])

  const recordAnswer = useCallback((questionId: number, correct: boolean, xpEarned: number) => {
    save(prev => {
      const recentAccuracy = [...prev.recentAccuracy, correct ? 1 : 0].slice(-20)
      const newDifficulty = adjustDifficulty(prev.currentDifficulty, recentAccuracy)
      const totalXp = prev.totalXp + xpEarned
      const newLevel = getLevelForXp(totalXp).level

      return {
        ...prev,
        todayAnswered: [...prev.todayAnswered, questionId],
        todayCorrect: prev.todayCorrect + (correct ? 1 : 0),
        totalXp,
        level: newLevel,
        answeredAll: prev.answeredAll.includes(questionId) ? prev.answeredAll : [...prev.answeredAll, questionId],
        wrongAnswers: correct
          ? prev.wrongAnswers.filter(id => id !== questionId)
          : prev.wrongAnswers.includes(questionId) ? prev.wrongAnswers : [...prev.wrongAnswers, questionId],
        currentDifficulty: newDifficulty,
        recentAccuracy,
      }
    })
  }, [save])

  const completeDailyChallenge = useCallback(() => {
    save(prev => {
      const today = todayStr()
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const yesterdayStr = yesterday.toISOString().slice(0, 10)

      const isConsecutive = prev.lastPlayedDate === yesterdayStr || prev.lastPlayedDate === today
      const newStreak = isConsecutive ? prev.streak + 1 : 1

      return {
        ...prev,
        streak: newStreak,
        bestStreak: Math.max(prev.bestStreak, newStreak),
        lastPlayedDate: today,
      }
    })
  }, [save])

  const updateAvatar = useCallback((icon: string, color: string, name: string) => {
    save(prev => ({ ...prev, avatar: { icon, color, name } }))
  }, [save])

  const todayCompleted = progress.todayAnswered.length >= 5

  return {
    progress,
    loaded,
    recordAnswer,
    completeDailyChallenge,
    updateAvatar,
    todayCompleted,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useGeniusProgress.ts
git commit -m "feat(genius): add localStorage progress hook"
```

---

### Task 4: Court View — 3D SVG Renderer

**Files:**
- Create: `src/app/(app)/padelgenius/components/ChibiPlayer.tsx`
- Create: `src/app/(app)/padelgenius/components/CourtView.tsx`

- [ ] **Step 1: Create ChibiPlayer SVG component**

```tsx
// src/app/(app)/padelgenius/components/ChibiPlayer.tsx
'use client'

interface ChibiPlayerProps {
  role: 'you' | 'partner' | 'opponent1' | 'opponent2'
  jerseyColor: string
  x: number   // SVG x position
  y: number   // SVG y position
  scale?: number
  facingAway?: boolean  // true for your team (back of head), false for opponents
  label?: string
}

export default function ChibiPlayer({ role, jerseyColor, x, y, scale = 1, facingAway = false, label }: ChibiPlayerProps) {
  const isYou = role === 'you'
  const headRadius = isYou ? 18 : 14
  const bodyW = isYou ? 36 : 24
  const bodyH = isYou ? 34 : 24

  return (
    <g transform={`translate(${x}, ${y}) scale(${scale})`}>
      {/* Ground shadow */}
      <ellipse cx={0} cy={bodyH + headRadius + 12} rx={bodyW * 0.5} ry={5} fill="rgba(0,0,0,0.25)" />

      {/* Legs */}
      <rect x={-bodyW * 0.2} y={bodyH} width={bodyW * 0.22} height={bodyH * 0.45} rx={3} fill="#FFD5A8" />
      <rect x={bodyW * 0.02} y={bodyH} width={bodyW * 0.22} height={bodyH * 0.45} rx={3} fill="#EECAA0" />
      {/* Shoes */}
      <rect x={-bodyW * 0.22} y={bodyH + bodyH * 0.38} width={bodyW * 0.26} height={6} rx={3} fill={jerseyColor} />
      <rect x={bodyW * 0} y={bodyH + bodyH * 0.38} width={bodyW * 0.26} height={6} rx={3} fill={jerseyColor} />

      {/* Body/jersey */}
      <rect x={-bodyW * 0.5} y={0} width={bodyW} height={bodyH} rx={bodyW * 0.15} fill={jerseyColor} />
      {/* Collar */}
      <rect x={-bodyW * 0.3} y={-2} width={bodyW * 0.6} height={6} rx={3} fill={jerseyColor} opacity={0.7} />

      {/* Head */}
      <circle cx={0} cy={-headRadius + 2} r={headRadius} fill="#FFD5A8" />

      {facingAway ? (
        /* Back of head — hair only */
        <path
          d={`M${-headRadius},2 Q${-headRadius},${-headRadius * 1.2} ${-headRadius * 0.4},${-headRadius * 1.5}
              L${-headRadius * 0.2},${-headRadius * 0.7}
              Q0,${-headRadius * 1.7} ${headRadius * 0.2},${-headRadius * 0.7}
              L${headRadius * 0.4},${-headRadius * 1.5}
              Q${headRadius},${-headRadius * 1.2} ${headRadius},2
              Q${headRadius * 0.5},${-headRadius * 0.2} 0,${-headRadius * 0.5}
              Q${-headRadius * 0.5},${-headRadius * 0.2} ${-headRadius},2Z`}
          fill="#1a1a2e"
        />
      ) : (
        /* Front face */
        <>
          {/* Hair */}
          <path
            d={`M${-headRadius},0 Q${-headRadius},${-headRadius * 1.1} 0,${-headRadius * 1.2}
                Q${headRadius},${-headRadius * 1.1} ${headRadius},0
                Q${headRadius * 0.5},${-headRadius * 0.5} 0,${-headRadius * 0.6}
                Q${-headRadius * 0.5},${-headRadius * 0.5} ${-headRadius},0Z`}
            fill={role === 'opponent1' ? '#C0392B' : '#2C1810'}
          />
          {/* Eyes */}
          <ellipse cx={-headRadius * 0.3} cy={-headRadius * 0.05} rx={headRadius * 0.16} ry={headRadius * 0.2} fill="#fff" />
          <circle cx={-headRadius * 0.25} cy={headRadius * 0.02} r={headRadius * 0.1} fill="#222" />
          <circle cx={-headRadius * 0.22} cy={-headRadius * 0.05} r={headRadius * 0.05} fill="#fff" />
          <ellipse cx={headRadius * 0.3} cy={-headRadius * 0.05} rx={headRadius * 0.16} ry={headRadius * 0.2} fill="#fff" />
          <circle cx={headRadius * 0.35} cy={headRadius * 0.02} r={headRadius * 0.1} fill="#222" />
          <circle cx={headRadius * 0.38} cy={-headRadius * 0.05} r={headRadius * 0.05} fill="#fff" />
          {/* Mouth */}
          <path d={`M${-headRadius * 0.15},${headRadius * 0.35} Q0,${headRadius * 0.5} ${headRadius * 0.15},${headRadius * 0.35}`} stroke="#b37656" strokeWidth={1} fill="none" />
        </>
      )}

      {/* Label */}
      {label && (
        <text x={0} y={bodyH + headRadius + 22} textAnchor="middle" fill={jerseyColor} fontSize={isYou ? 10 : 8} fontWeight={700} opacity={0.8}>
          {label}
        </text>
      )}
    </g>
  )
}
```

- [ ] **Step 2: Create CourtView component**

```tsx
// src/app/(app)/padelgenius/components/CourtView.tsx
'use client'

import ChibiPlayer from './ChibiPlayer'

interface CourtPlayer {
  role: 'you' | 'partner' | 'opponent1' | 'opponent2'
  x: number  // 0-100 normalized
  y: number  // 0-100 normalized
}

interface CourtData {
  players: CourtPlayer[]
  ball?: { x: number; y: number }
  trajectory?: { from: [number, number]; to: [number, number] }
  highlights?: { type: 'zone' | 'arrow' | 'label'; coords: number[]; label?: string; color?: string }[]
}

interface CourtOverlay {
  trajectory?: { from: [number, number]; to: [number, number] }
  wrongTrajectory?: { from: [number, number]; to: [number, number]; label?: string }
  label?: string
}

interface CourtViewProps {
  court: CourtData
  avatarColor?: string
  overlay?: CourtOverlay
  tapMode?: boolean
  onTap?: (x: number, y: number) => void
  tapPoint?: { x: number; y: number } | null
  correctZone?: { x: number; y: number; radius: number } | null
}

const W = 400
const H = 600

// Convert normalized (0-100) coords to perspective SVG coords
// The court is a trapezoid: narrow at top (far), wide at bottom (near)
function toSvg(nx: number, ny: number): [number, number] {
  // y: 0=far (top of court), 100=near (bottom, player side)
  const t = ny / 100 // 0=far, 1=near
  const courtTop = 170
  const courtBot = 560
  const svgY = courtTop + t * (courtBot - courtTop)

  // x: 0=left, 100=right — court widens with perspective
  const leftAtTop = 70
  const rightAtTop = 330
  const leftAtBot = 10
  const rightAtBot = 390
  const leftEdge = leftAtTop + t * (leftAtBot - leftAtTop)
  const rightEdge = rightAtTop + t * (rightAtBot - rightAtTop)
  const svgX = leftEdge + (nx / 100) * (rightEdge - leftEdge)

  return [svgX, svgY]
}

function playerScale(ny: number): number {
  return 0.5 + (ny / 100) * 0.7 // small at far, big at near
}

export default function CourtView({ court, avatarColor = '#38C8FF', overlay, tapMode, onTap, tapPoint, correctZone }: CourtViewProps) {
  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!tapMode || !onTap) return
    const svg = e.currentTarget
    const rect = svg.getBoundingClientRect()
    const svgX = ((e.clientX - rect.left) / rect.width) * W
    const svgY = ((e.clientY - rect.top) / rect.height) * H

    // Reverse the perspective transform (approximate)
    const courtTop = 170
    const courtBot = 560
    if (svgY < courtTop || svgY > courtBot) return
    const t = (svgY - courtTop) / (courtBot - courtTop)
    const ny = t * 100

    const leftAtTop = 70, rightAtTop = 330, leftAtBot = 10, rightAtBot = 390
    const leftEdge = leftAtTop + t * (leftAtBot - leftAtTop)
    const rightEdge = rightAtTop + t * (rightAtBot - rightAtTop)
    const nx = ((svgX - leftEdge) / (rightEdge - leftEdge)) * 100

    if (nx >= 0 && nx <= 100) onTap(Math.round(nx), Math.round(ny))
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block', cursor: tapMode ? 'crosshair' : 'default' }} onClick={handleClick}>
      {/* Background */}
      <rect width={W} height={H} fill="#111" />
      <rect x={0} y={60} width={W} height={100} fill="#1a3028" rx={4} />

      {/* Back wall + sponsor */}
      <polygon points="70,170 330,170 330,148 70,148" fill="rgba(150,210,220,0.15)" stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
      <rect x={70} y={145} width={4} height={28} fill="#888" rx={1} />
      <rect x={326} y={145} width={4} height={28} fill="#888" rx={1} />

      {/* Court surface (perspective trapezoid) */}
      <polygon points="70,170 330,170 390,560 10,560" fill="#1976b8" />
      <polygon points="70,170 330,170 390,560 10,560" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={2} />

      {/* Court lines */}
      <line x1={200} y1={170} x2={200} y2={560} stroke="rgba(255,255,255,0.15)" strokeWidth={1.5} />
      {/* Service lines */}
      {(() => {
        const [sl1, sy1] = toSvg(0, 33)
        const [sr1] = toSvg(100, 33)
        const [sl2, sy2] = toSvg(0, 67)
        const [sr2] = toSvg(100, 67)
        return (
          <>
            <line x1={sl1} y1={sy1} x2={sr1} y2={sy1} stroke="rgba(255,255,255,0.5)" strokeWidth={2} />
            <line x1={sl2} y1={sy2} x2={sr2} y2={sy2} stroke="rgba(255,255,255,0.5)" strokeWidth={2} />
          </>
        )
      })()}

      {/* Net */}
      {(() => {
        const [, netY] = toSvg(0, 48)
        const [nl] = toSvg(0, 48)
        const [nr] = toSvg(100, 48)
        return (
          <>
            <rect x={nl - 4} y={netY - 6} width={nr - nl + 8} height={5} fill="#ccc" rx={1} />
            <rect x={nl - 6} y={netY - 12} width={5} height={16} fill="#999" rx={1} />
            <rect x={nr + 1} y={netY - 12} width={5} height={16} fill="#999" rx={1} />
          </>
        )
      })()}

      {/* Side walls (glass) */}
      <polygon points="70,170 10,560 10,510 70,148" fill="rgba(150,210,220,0.08)" stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
      <polygon points="330,170 390,560 390,510 330,148" fill="rgba(150,210,220,0.08)" stroke="rgba(255,255,255,0.1)" strokeWidth={1} />

      {/* Highlights (zones) */}
      {court.highlights?.map((h, i) => {
        if (h.type === 'zone' && h.coords.length >= 4) {
          const [x1, y1] = toSvg(h.coords[0], h.coords[1])
          const [x2, y2] = toSvg(h.coords[2], h.coords[3])
          return <rect key={i} x={x1} y={y1} width={x2 - x1} height={y2 - y1} rx={6} fill={h.color || 'rgba(126,211,33,0.15)'} stroke={h.color || '#7ED321'} strokeWidth={1.5} strokeDasharray="6,3" />
        }
        return null
      })}

      {/* Ball trajectory */}
      {court.trajectory && (() => {
        const [fx, fy] = toSvg(court.trajectory.from[0], court.trajectory.from[1])
        const [tx, ty] = toSvg(court.trajectory.to[0], court.trajectory.to[1])
        return <line x1={fx} y1={fy} x2={tx} y2={ty} stroke="#FFDD00" strokeWidth={1.5} strokeDasharray="6,4" opacity={0.4} />
      })()}

      {/* Ball */}
      {court.ball && (() => {
        const [bx, by] = toSvg(court.ball.x, court.ball.y)
        return (
          <>
            <circle cx={bx} cy={by} r={12} fill="rgba(255,238,0,0.1)">
              <animate attributeName="r" values="10;16;10" dur="1.2s" repeatCount="indefinite" />
            </circle>
            <circle cx={bx} cy={by} r={7} fill="#CCFF00" stroke="#88aa00" strokeWidth={2} />
            <circle cx={bx - 2} cy={by - 2} r={2.5} fill="rgba(255,255,255,0.4)" />
          </>
        )
      })()}

      {/* Players */}
      {court.players
        .sort((a, b) => a.y - b.y) // render far players first
        .map(p => {
          const [px, py] = toSvg(p.x, p.y)
          const scale = playerScale(p.y)
          const isYourTeam = p.role === 'you' || p.role === 'partner'
          const jerseyColor = isYourTeam ? avatarColor : (p.role === 'opponent1' ? '#E74C3C' : '#F472B6')
          const label = p.role === 'you' ? 'YOU' : p.role === 'partner' ? 'PAR' : 'OPP'

          return (
            <ChibiPlayer
              key={p.role}
              role={p.role}
              jerseyColor={jerseyColor}
              x={px}
              y={py - 30 * scale}
              scale={scale}
              facingAway={isYourTeam}
              label={label}
            />
          )
        })}

      {/* Overlay: correct trajectory */}
      {overlay?.trajectory && (() => {
        const [fx, fy] = toSvg(overlay.trajectory.from[0], overlay.trajectory.from[1])
        const [tx, ty] = toSvg(overlay.trajectory.to[0], overlay.trajectory.to[1])
        return <line x1={fx} y1={fy} x2={tx} y2={ty} stroke="#7ED321" strokeWidth={3} opacity={0.8} />
      })()}

      {/* Overlay: wrong trajectory */}
      {overlay?.wrongTrajectory && (() => {
        const [fx, fy] = toSvg(overlay.wrongTrajectory.from[0], overlay.wrongTrajectory.from[1])
        const [tx, ty] = toSvg(overlay.wrongTrajectory.to[0], overlay.wrongTrajectory.to[1])
        return (
          <>
            <line x1={fx} y1={fy} x2={tx} y2={ty} stroke="#FF4655" strokeWidth={1.5} strokeDasharray="5,4" opacity={0.35} />
            {overlay.wrongTrajectory.label && (
              <text x={tx + 8} y={ty} fill="#FF4655" fontSize={9} opacity={0.5}>✕ {overlay.wrongTrajectory.label}</text>
            )}
          </>
        )
      })()}

      {/* Tap mode: show tap point */}
      {tapPoint && (() => {
        const [tx, ty] = toSvg(tapPoint.x, tapPoint.y)
        return (
          <>
            <circle cx={tx} cy={ty} r={20} fill="none" stroke="#38C8FF" strokeWidth={2} opacity={0.5}>
              <animate attributeName="r" from="8" to="25" dur="0.6s" repeatCount="indefinite" />
              <animate attributeName="opacity" from="0.8" to="0" dur="0.6s" repeatCount="indefinite" />
            </circle>
            <circle cx={tx} cy={ty} r={6} fill="#38C8FF" stroke="#fff" strokeWidth={2} />
          </>
        )
      })()}

      {/* Tap mode: show correct zone after answer */}
      {correctZone && (() => {
        const [zx, zy] = toSvg(correctZone.x, correctZone.y)
        const r = correctZone.radius * 2.5 // visual scaling
        return (
          <circle cx={zx} cy={zy} r={r} fill="rgba(126,211,33,0.12)" stroke="#7ED321" strokeWidth={2} strokeDasharray="6,3">
            <animate attributeName="opacity" values="0.3;0.6;0.3" dur="2s" repeatCount="indefinite" />
          </circle>
        )
      })()}
    </svg>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/padelgenius/components/ChibiPlayer.tsx src/app/\(app\)/padelgenius/components/CourtView.tsx
git commit -m "feat(genius): add 3D SVG court renderer with chibi players"
```

---

### Task 5: View Components — Hub, Question, Explanation, Summary

**Files:**
- Create: `src/app/(app)/padelgenius/components/WeekStrip.tsx`
- Create: `src/app/(app)/padelgenius/components/AvatarPicker.tsx`
- Create: `src/app/(app)/padelgenius/components/HubView.tsx`
- Create: `src/app/(app)/padelgenius/components/QuestionView.tsx`
- Create: `src/app/(app)/padelgenius/components/ExplanationView.tsx`
- Create: `src/app/(app)/padelgenius/components/SummaryView.tsx`

This task creates all the UI view components. Each component is self-contained.

Due to the size of these components, the implementing agent should read the spec's **Page Structure > Views** section and the **Brand & Style Alignment** section, then implement each component following:
- Colors from CSS custom properties (`--bg-base`, `--bg-card`, `--text-primary`, etc.)
- The mockup screens from `.superpowers/brainstorm/78698-1775890224/content/casual-3d-padel.html` for the court game view
- The mockup screens from `.superpowers/brainstorm/78698-1775890224/content/full-flow.html` for hub, explanation, and summary

Key implementation notes for each component:

- [ ] **Step 1: Create WeekStrip**

`WeekStrip.tsx` — renders Mon-Sun strip showing each day's theme emoji, whether it's completed (✓), current (NOW), or upcoming (—). Props: `completedDays: string[]` (ISO date strings), no need for internal state.

- [ ] **Step 2: Create AvatarPicker**

`AvatarPicker.tsx` — modal/panel with icon grid + color picker. Uses `getUnlockedAvatars(level)` from `genius-avatars.ts`. Props: `currentAvatar`, `level`, `onSelect(icon, color, name)`, `onClose`.

- [ ] **Step 3: Create HubView**

`HubView.tsx` — the entry screen. Uses `GeniusProgressState` for stats, `getTodayTheme()` for theme card, `getXpProgress()` for level bar. Props: `progress`, `onStart()`, `onOpenAvatarPicker()`. Shows: avatar + level header, theme card, CTA button, stats row (questions/accuracy/streak), WeekStrip.

- [ ] **Step 4: Create QuestionView**

`QuestionView.tsx` — renders the question. Handles all 3 modes:
- `court-scenario` + `rules-card`: render CourtView + A/B/C option buttons + confirm button
- `court-tap`: render CourtView with `tapMode=true`, show tap instruction, confirm after tap

Props: `question: GeniusQuestion`, `questionIndex: number`, `totalQuestions: number`, `streak: number`, `avatarColor: string`, `onAnswer(result: AnswerResult)`, `onExit()`.

State: `selectedOption`, `tapPoint`, `confirmed`.

- [ ] **Step 5: Create ExplanationView**

`ExplanationView.tsx` — shows result (correct/incorrect), XP earned, CourtView with overlay (correct path green, wrong path red dashed), explanation card with optional Pro Tip, sponsor slot, "Next Question" button.

Props: `question: GeniusQuestion`, `result: AnswerResult`, `userAnswer: string | { x: number; y: number }`, `avatarColor: string`, `xpMultiplier: number`, `onNext()`.

- [ ] **Step 6: Create SummaryView**

`SummaryView.tsx` — end-of-day summary. Shows: celebration header, score card (correct/xp/streak), level progress bar, question breakdown list, "Review Mistakes" + "Share Result" buttons, tomorrow teaser.

Props: `results: { question: GeniusQuestion; result: AnswerResult }[]`, `progress: GeniusProgressState`, `onReviewMistakes()`, `onBackToHub()`.

- [ ] **Step 7: Commit**

```bash
git add src/app/\(app\)/padelgenius/components/
git commit -m "feat(genius): add hub, question, explanation, summary view components"
```

---

### Task 6: Main Page — State Machine + Orchestration

**Files:**
- Create: `src/app/(app)/padelgenius/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
// src/app/(app)/padelgenius/page.tsx
'use client'

import { useState, useCallback, useMemo } from 'react'
import { useGeniusProgress } from '@/hooks/useGeniusProgress'
import { getTodayTheme } from '@/data/genius-themes'
import { selectDailyQuestions, scoreAnswer, scoreTapAnswer } from '@/lib/genius-engine'
import type { GeniusQuestion, AnswerResult } from '@/lib/genius-engine'
import HubView from './components/HubView'
import QuestionView from './components/QuestionView'
import ExplanationView from './components/ExplanationView'
import SummaryView from './components/SummaryView'
import AvatarPicker from './components/AvatarPicker'

// Import question bank
import questionsData from '@/data/genius-questions.json'

type View = 'hub' | 'playing' | 'explanation' | 'summary' | 'avatar'

interface SessionResult {
  question: GeniusQuestion
  result: AnswerResult
  userAnswer: string | { x: number; y: number }
}

export default function PadelGeniusPage() {
  const { progress, loaded, recordAnswer, completeDailyChallenge, updateAvatar, todayCompleted } = useGeniusProgress()

  const [view, setView] = useState<View>('hub')
  const [questions, setQuestions] = useState<GeniusQuestion[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [sessionResults, setSessionResults] = useState<SessionResult[]>([])
  const [lastResult, setLastResult] = useState<{ result: AnswerResult; userAnswer: string | { x: number; y: number } } | null>(null)

  const theme = useMemo(() => getTodayTheme(), [])
  const allQuestions = questionsData as GeniusQuestion[]

  const handleStart = useCallback(() => {
    const selected = selectDailyQuestions(
      allQuestions,
      theme.key,
      progress.currentDifficulty,
      progress.answeredAll,
      progress.wrongAnswers,
    )
    setQuestions(selected)
    setCurrentIndex(0)
    setSessionResults([])
    setLastResult(null)
    setView('playing')
  }, [allQuestions, theme.key, progress.currentDifficulty, progress.answeredAll, progress.wrongAnswers])

  const handleAnswer = useCallback((result: AnswerResult, userAnswer: string | { x: number; y: number }) => {
    const q = questions[currentIndex]
    recordAnswer(q.id, result.correct, result.xp)
    setSessionResults(prev => [...prev, { question: q, result, userAnswer }])
    setLastResult({ result, userAnswer })
    setView('explanation')
  }, [questions, currentIndex, recordAnswer])

  const handleNext = useCallback(() => {
    const nextIdx = currentIndex + 1
    if (nextIdx >= questions.length) {
      completeDailyChallenge()
      setView('summary')
    } else {
      setCurrentIndex(nextIdx)
      setLastResult(null)
      setView('playing')
    }
  }, [currentIndex, questions.length, completeDailyChallenge])

  const handleExit = useCallback(() => {
    setView('hub')
  }, [])

  if (!loaded) return null

  switch (view) {
    case 'hub':
      return (
        <HubView
          progress={progress}
          todayCompleted={todayCompleted}
          onStart={handleStart}
          onOpenAvatarPicker={() => setView('avatar')}
        />
      )

    case 'playing':
      return (
        <QuestionView
          question={questions[currentIndex]}
          questionIndex={currentIndex}
          totalQuestions={questions.length}
          streak={progress.streak}
          avatarColor={progress.avatar.color}
          xpMultiplier={theme.xpMultiplier}
          onAnswer={handleAnswer}
          onExit={handleExit}
        />
      )

    case 'explanation':
      return lastResult ? (
        <ExplanationView
          question={questions[currentIndex]}
          result={lastResult.result}
          userAnswer={lastResult.userAnswer}
          avatarColor={progress.avatar.color}
          xpMultiplier={theme.xpMultiplier}
          onNext={handleNext}
        />
      ) : null

    case 'summary':
      return (
        <SummaryView
          results={sessionResults}
          progress={progress}
          theme={theme}
          onReviewMistakes={() => setView('hub')}
          onBackToHub={() => setView('hub')}
        />
      )

    case 'avatar':
      return (
        <AvatarPicker
          currentAvatar={progress.avatar}
          level={progress.level}
          onSelect={(icon, color, name) => {
            updateAvatar(icon, color, name)
            setView('hub')
          }}
          onClose={() => setView('hub')}
        />
      )
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(app\)/padelgenius/page.tsx
git commit -m "feat(genius): add main page with view state machine"
```

---

### Task 7: Question Bank — 50 Questions

**Files:**
- Create: `src/data/genius-questions.json`

- [ ] **Step 1: Create the question bank**

Create `src/data/genius-questions.json` with 50 questions following the `GeniusQuestion` interface. Distribution:

- 12 × `rules` theme, `rules-card` type (difficulty mix: 5 easy, 5 medium, 2 hard)
- 12 × `shots` theme, `court-scenario` type (difficulty mix: 5 easy, 5 medium, 2 hard)
- 10 × `positioning` theme, mix of `court-tap` and `court-scenario` (4 easy, 4 medium, 2 hard)
- 8 × `communication` theme, `court-scenario` type (3 easy, 3 medium, 2 hard)
- 8 × `mixed` theme, all types (3 easy, 3 medium, 2 hard)

Each question must include:
- Realistic court positions for players (x/y in 0-100 range)
- Ball position where relevant
- Trajectory lines where relevant
- 2-3 answer options (with emoji, label, description)
- Correct answer ID
- Explanation with title, text, and optional proTip
- XP: 100 (easy), 150 (medium), 200 (hard)

Content should cover real padel knowledge: FIP rules, tactical patterns (bandeja vs smash, when to lob, chiquita timing, wall play), positioning fundamentals, communication calls.

This is the most content-heavy task. The implementing agent should use padel knowledge from the spec and generate all 50 questions with accurate padel content.

- [ ] **Step 2: Verify JSON is valid**

Run: `node -e "const q = require('./src/data/genius-questions.json'); console.log(q.length + ' questions loaded')"`
Expected: `50 questions loaded`

- [ ] **Step 3: Commit**

```bash
git add src/data/genius-questions.json
git commit -m "feat(genius): add 50-question bank covering rules, shots, positioning, communication"
```

---

### Task 8: Update PadelGeniusTeaser + Entry Points

**Files:**
- Modify: `src/components/PadelGeniusTeaser.tsx`

- [ ] **Step 1: Update the teaser to link to the game**

The existing `PadelGeniusTeaser.tsx` shows a "Coming Soon" / "Notify Me" card. Update it to:
- Change the CTA to "Play Now →" linking to `/padelgenius`
- Remove the feature_interest Supabase logic (no longer needed — the game is live)
- Keep the visual style (brain icon, PadelGenius branding, CHUNKY clip-paths)
- Add a mini stat line if the user has progress (e.g., "🔥 5 day streak · Level 4")

Read the progress from localStorage directly (not the hook, since this component renders outside the padelgenius page):

```typescript
function getGeniusStreak(): { streak: number; level: number } | null {
  try {
    const raw = localStorage.getItem('pn_genius_progress')
    if (!raw) return null
    const p = JSON.parse(raw)
    return { streak: p.streak || 0, level: p.level || 1 }
  } catch {
    return null
  }
}
```

Replace the button's `onClick` with `router.push('/padelgenius')`.

- [ ] **Step 2: Commit**

```bash
git add src/components/PadelGeniusTeaser.tsx
git commit -m "feat(genius): update teaser to link to live game"
```

---

### Task 9: Smoke Test + Polish

**Files:**
- All padelgenius files

- [ ] **Step 1: Run all tests**

Run: `npx vitest run src/lib/__tests__/genius-engine.test.ts`
Expected: All tests pass

- [ ] **Step 2: Run the dev server and manually test**

Run: `npm run dev`
Navigate to: `http://localhost:3002/padelgenius`

Verify:
1. Hub loads with random avatar, level 1, streak 0
2. Today's theme card shows correct theme for the day of week
3. "Start Daily Challenge" button loads 5 questions
4. Court renders with players, ball, and glass walls
5. Selecting an answer and confirming shows explanation view
6. Completing all 5 shows summary with XP and streak update
7. Returning to hub shows updated stats
8. Avatar picker opens and allows changing icon/color
9. Progress persists after page reload (localStorage)

- [ ] **Step 3: Fix any issues found during smoke test**

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(genius): smoke test fixes"
```

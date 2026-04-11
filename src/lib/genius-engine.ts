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
  distance?: number
}

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

  const themeFiltered = themeKey === 'mixed'
    ? allQuestions
    : allQuestions.filter(q => q.theme === themeKey || q.theme === 'mixed')

  const diffMin = Math.max(1, currentDifficulty - 1) as 1 | 2 | 3
  const diffMax = Math.min(3, currentDifficulty + 1) as 1 | 2 | 3
  const diffFiltered = themeFiltered.filter(q => q.difficulty >= diffMin && q.difficulty <= diffMax)

  const unseen = diffFiltered.filter(q => !answeredSet.has(q.id))

  if (unseen.length >= count) {
    return shuffle(unseen).slice(0, count)
  }

  const wrongRetry = diffFiltered.filter(q => wrongSet.has(q.id) && !unseen.some(u => u.id === q.id))
  const combined = [...unseen, ...wrongRetry]

  if (combined.length >= count) {
    return shuffle(combined).slice(0, count)
  }

  const recycled = diffFiltered.filter(q => !combined.some(c => c.id === q.id))
  const all = [...combined, ...shuffle(recycled)]

  return all.slice(0, count)
}

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

  const maxPartialDistance = zone.radius * 2.5
  if (distance <= maxPartialDistance) {
    const ratio = 1 - (distance - zone.radius) / (maxPartialDistance - zone.radius)
    const partialXp = Math.round(question.xp * ratio * 0.5 * xpMultiplier)
    return { correct: false, xp: partialXp, distance }
  }

  return { correct: false, xp: 0, distance }
}

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

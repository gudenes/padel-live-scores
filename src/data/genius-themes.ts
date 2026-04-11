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
  const dayOfWeek = new Date().getDay()
  return THEME_SCHEDULE[dayOfWeek]
}

export function getThemeForDay(dayOfWeek: number): DailyTheme {
  return THEME_SCHEDULE[dayOfWeek] || THEME_SCHEDULE[5]
}

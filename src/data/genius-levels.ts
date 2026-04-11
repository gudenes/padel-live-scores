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

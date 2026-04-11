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

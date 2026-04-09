// src/lib/ambassador.ts
//
// Ambassador tier spec. Uses the universal padel-themed tier system
// (Rookie → Intermediate → Advanced → Padel Genius) to stay
// consistent with the badge system.

export type AmbassadorTierId = 'rookie' | 'intermediate' | 'advanced' | 'genius'

export interface AmbassadorTierSpec {
  id: AmbassadorTierId
  name: string
  subtitle: string
  icon: string
  color: string
  bgGradient: string
  minInvites: number
  description: string
}

export const AMBASSADOR_TIERS: Record<AmbassadorTierId, AmbassadorTierSpec> = {
  rookie: {
    id: 'rookie',
    name: 'Rookie',
    subtitle: 'First invites',
    icon: '🥨',
    color: '#7ED321',
    bgGradient: 'linear-gradient(135deg, rgba(126,211,33,0.25) 0%, rgba(126,211,33,0.08) 100%)',
    minInvites: 1,
    description: 'You\'ve invited your first friends to PadelNachos. Welcome to the crew!',
  },
  intermediate: {
    id: 'intermediate',
    name: 'Intermediate',
    subtitle: 'Growing the community',
    icon: '🥨',
    color: '#F5A623',
    bgGradient: 'linear-gradient(135deg, rgba(245,166,35,0.3) 0%, rgba(245,166,35,0.08) 100%)',
    minInvites: 5,
    description: 'Five friends and counting — you\'re building momentum.',
  },
  advanced: {
    id: 'advanced',
    name: 'Advanced',
    subtitle: 'Community leader',
    icon: '🥨',
    color: '#FF6B2B',
    bgGradient: 'linear-gradient(135deg, rgba(255,107,43,0.3) 0%, rgba(255,107,43,0.1) 100%)',
    minInvites: 15,
    description: 'Fifteen friends on board. You\'re a true community builder.',
  },
  genius: {
    id: 'genius',
    name: 'Padel Genius',
    subtitle: 'Ambassador legend',
    icon: '🥨',
    color: '#FFD166',
    bgGradient: 'linear-gradient(135deg, rgba(255,209,102,0.35) 0%, rgba(255,209,102,0.12) 100%)',
    minInvites: 50,
    description: 'Fifty friends! You\'re a PadelNachos legend. Top of the ambassadors.',
  },
}

/**
 * Derive an ambassador tier from a successful-invite count.
 * Returns null when count is 0 (no badge yet).
 */
export function tierForCount(count: number): AmbassadorTierSpec | null {
  if (count >= AMBASSADOR_TIERS.genius.minInvites) return AMBASSADOR_TIERS.genius
  if (count >= AMBASSADOR_TIERS.advanced.minInvites) return AMBASSADOR_TIERS.advanced
  if (count >= AMBASSADOR_TIERS.intermediate.minInvites) return AMBASSADOR_TIERS.intermediate
  if (count >= AMBASSADOR_TIERS.rookie.minInvites) return AMBASSADOR_TIERS.rookie
  return null
}

/**
 * Returns the next tier above the current count, and how many more
 * invites are needed to reach it. Used for progress hints on the
 * profile row.
 */
export function nextTierProgress(count: number): { next: AmbassadorTierSpec; remaining: number } | null {
  if (count < AMBASSADOR_TIERS.rookie.minInvites) {
    return { next: AMBASSADOR_TIERS.rookie, remaining: AMBASSADOR_TIERS.rookie.minInvites - count }
  }
  if (count < AMBASSADOR_TIERS.intermediate.minInvites) {
    return { next: AMBASSADOR_TIERS.intermediate, remaining: AMBASSADOR_TIERS.intermediate.minInvites - count }
  }
  if (count < AMBASSADOR_TIERS.advanced.minInvites) {
    return { next: AMBASSADOR_TIERS.advanced, remaining: AMBASSADOR_TIERS.advanced.minInvites - count }
  }
  if (count < AMBASSADOR_TIERS.genius.minInvites) {
    return { next: AMBASSADOR_TIERS.genius, remaining: AMBASSADOR_TIERS.genius.minInvites - count }
  }
  return null  // maxed out
}

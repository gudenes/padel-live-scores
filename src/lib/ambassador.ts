// src/lib/ambassador.ts
//
// Ambassador tier spec. Tiers are earned by inviting friends who
// successfully sign up. Three tiers, all padel-shot + nacho themed.

export type AmbassadorTierId = 'bandeja' | 'vibora' | 'smash'

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
  bandeja: {
    id: 'bandeja',
    name: 'Bandeja',
    subtitle: 'The tray',
    icon: '🥨',
    color: '#7ED321',
    bgGradient: 'linear-gradient(135deg, rgba(126,211,33,0.25) 0%, rgba(126,211,33,0.08) 100%)',
    minInvites: 1,
    description: 'Bandeja means "tray" in Spanish — the padel shot AND what nachos are served on. You\'ve served up your first invites.',
  },
  vibora: {
    id: 'vibora',
    name: 'Víbora Picante',
    subtitle: 'Spicy snake',
    icon: '🌶️',
    color: '#FF6B2B',
    bgGradient: 'linear-gradient(135deg, rgba(255,107,43,0.3) 0%, rgba(255,107,43,0.1) 100%)',
    minInvites: 5,
    description: 'The padel shot with bite + a jalapeño kick. You\'re turning up the heat and bringing the crew.',
  },
  smash: {
    id: 'smash',
    name: 'Smash Supremo',
    subtitle: 'The supreme',
    icon: '🧀',
    color: '#FFD166',
    bgGradient: 'linear-gradient(135deg, rgba(255,209,102,0.35) 0%, rgba(255,209,102,0.12) 100%)',
    minInvites: 15,
    description: 'Match-winning smash + fully-loaded nacho supreme. Top of the community. Legendary status.',
  },
}

/**
 * Derive an ambassador tier from a successful-invite count.
 * Returns null when count is 0 (no badge yet).
 */
export function tierForCount(count: number): AmbassadorTierSpec | null {
  if (count >= AMBASSADOR_TIERS.smash.minInvites) return AMBASSADOR_TIERS.smash
  if (count >= AMBASSADOR_TIERS.vibora.minInvites) return AMBASSADOR_TIERS.vibora
  if (count >= AMBASSADOR_TIERS.bandeja.minInvites) return AMBASSADOR_TIERS.bandeja
  return null
}

/**
 * Returns the next tier above the current count, and how many more
 * invites are needed to reach it. Used for progress hints on the
 * profile row.
 */
export function nextTierProgress(count: number): { next: AmbassadorTierSpec; remaining: number } | null {
  if (count < AMBASSADOR_TIERS.bandeja.minInvites) {
    return { next: AMBASSADOR_TIERS.bandeja, remaining: AMBASSADOR_TIERS.bandeja.minInvites - count }
  }
  if (count < AMBASSADOR_TIERS.vibora.minInvites) {
    return { next: AMBASSADOR_TIERS.vibora, remaining: AMBASSADOR_TIERS.vibora.minInvites - count }
  }
  if (count < AMBASSADOR_TIERS.smash.minInvites) {
    return { next: AMBASSADOR_TIERS.smash, remaining: AMBASSADOR_TIERS.smash.minInvites - count }
  }
  return null  // maxed out
}

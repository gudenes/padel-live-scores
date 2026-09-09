// Single source of truth for the pro/amateur split on public.players.
//
// Amateurs live in the same table as professionals (see the 2026-09-09
// amateur-profiles spec). The isolation that keeps them out of the pro
// product is enforced here and at the three call sites documented in the
// spec — most importantly PlayerResolver, which must never match one.

export const PLAYER_TIERS = ['pro', 'amateur'] as const
export type PlayerTier = (typeof PLAYER_TIERS)[number]

/** Column name, so query builders never hardcode the string. */
export const TIER_COLUMN = 'tier'
export const AMATEUR_TIER: PlayerTier = 'amateur'
export const PRO_TIER: PlayerTier = 'pro'

/**
 * True when the row belongs to the professional product. A null/undefined
 * tier means the column wasn't selected or predates the migration — those
 * rows are professionals.
 */
export function isProTier(tier: string | null | undefined): boolean {
  return tier == null || tier === PRO_TIER
}

/** True only for an explicit amateur row. */
export function isAmateurTier(tier: string | null | undefined): boolean {
  return tier === AMATEUR_TIER
}

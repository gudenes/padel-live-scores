// Compute the link/enrichment status of a player rendered anywhere in ops.
// Used by the PlayerLink component to choose a status-dot color + decide
// whether the row is clickable.

export type PlayerLinkStatus = 'enriched' | 'thin' | 'unresolved'

/**
 * Minimal shape the status helper reads. Each caller passes whatever fields
 * it has from its API. Missing fields default to null/undefined → treated
 * as "no enrichment".
 */
export interface PlayerLinkInput {
  id: string | null
  name: string
  /** Any enrichment field flips the status from 'thin' to 'enriched'. */
  avatar_url?: string | null
  ranking?: number | null
  padelapi_id?: string | null
  /** Carried for tooltip / external-id badges only — does NOT affect status. */
  fip_id?: string | null
}

/**
 * Decision rules:
 *   - id missing → 'unresolved' (no DB row, just a free-text name)
 *   - id present + at least one enrichment field truthy → 'enriched'
 *   - id present + no enrichment → 'thin'
 *
 * Empty strings count as "missing" (defensive — sometimes APIs return '' instead of null).
 */
export function computePlayerLinkStatus(player: PlayerLinkInput): PlayerLinkStatus {
  if (!player.id) return 'unresolved'
  const hasAvatar = !!(player.avatar_url && player.avatar_url.length > 0)
  const hasRanking = player.ranking != null
  const hasPadelapi = !!(player.padelapi_id && player.padelapi_id.length > 0)
  if (hasAvatar || hasRanking || hasPadelapi) return 'enriched'
  return 'thin'
}

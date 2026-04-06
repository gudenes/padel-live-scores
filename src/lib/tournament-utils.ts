// src/lib/tournament-utils.ts
// Tournament readiness helpers for entry list gating.

/**
 * Returns true if a FIP tournament is gated (entry list not fully uploaded).
 * Gated tournaments show "Coming Soon" badges and grayed-out matches on user-facing pages.
 */
export function isTournamentGated(t: {
  source?: string | null
  level?: string | null
  entry_list_status?: string | null
}): boolean {
  const isFip = t.source === 'fip' || (t.level ?? '').startsWith('fip_')
  if (!isFip) return false
  return t.entry_list_status !== 'ready'
}

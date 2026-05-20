// Feature flag client helpers.
//
// Flags live in the `feature_flags` table — public-read RLS so client
// code can fetch them as part of normal data loads, no API round-trip.
// Writes are restricted to ops API routes that use the service-role
// key (which bypasses RLS).
//
// Each flag has an optional env-var override for local development —
// useful when you want to keep testing a feature locally that's been
// shipped to production disabled.

import type { SupabaseClient } from '@supabase/supabase-js'

/** Canonical keys, kept in sync with `feature_flags.key` rows. */
export const FLAG_KEYS = {
  HOME_LIVE_TOURNAMENTS_CAROUSEL: 'home_live_tournaments_carousel',
} as const

export type FlagKey = (typeof FLAG_KEYS)[keyof typeof FLAG_KEYS]

/**
 * Returns a local override boolean for a given flag, or `null` if no
 * override is set. Env vars must be referenced as literal strings so
 * Next.js can inline them at build time — we enumerate explicitly per
 * flag rather than constructing the env var name from the key.
 */
export function getFlagOverride(key: FlagKey): boolean | null {
  let raw: string | undefined
  switch (key) {
    case FLAG_KEYS.HOME_LIVE_TOURNAMENTS_CAROUSEL:
      raw = process.env.NEXT_PUBLIC_FORCE_LIVE_TOURNAMENTS_CAROUSEL
      break
    default:
      return null
  }
  if (raw === 'true') return true
  if (raw === 'false') return false
  return null
}

/**
 * Reads a single flag's enabled value from the DB. Falls back to
 * `defaultValue` (defaults to false) when the row is missing or the
 * query errors — flags should always have a safe default.
 *
 * Caller passes the supabase client they already use elsewhere
 * (anon-key on the client, service-key on the server) so this helper
 * doesn't open its own connection.
 */
export async function fetchFeatureFlag(
  supabase: SupabaseClient,
  key: FlagKey,
  defaultValue = false,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('feature_flags')
    .select('enabled')
    .eq('key', key)
    .maybeSingle()
  if (error) {
    console.warn(`[feature-flags] fetch failed for ${key}:`, error.message)
    return defaultValue
  }
  return data?.enabled ?? defaultValue
}

/**
 * Resolves a flag's final value: env override wins if present,
 * otherwise the DB-stored value, otherwise the default.
 */
export function resolveFlag(
  key: FlagKey,
  dbValue: boolean | null | undefined,
  defaultValue = false,
): boolean {
  const override = getFlagOverride(key)
  if (override !== null) return override
  return dbValue ?? defaultValue
}

// Feature flag client helpers.
//
// Flags live in the `feature_flags` table — public-read RLS so client
// code can fetch them as part of normal data loads, no API round-trip.
// Writes are restricted to ops API routes that use the service-role
// key (which bypasses RLS).
//
// Each flag has TWO independent switches:
//   - `enabled`        — production (any non-localhost host)
//   - `enabled_local`  — localhost dev (window.location.hostname matches)
//
// `resolveFlag()` picks the right column based on the current host so
// the same DB row can hold "off in prod, on for local polish" without
// touching env vars.

import type { SupabaseClient } from '@supabase/supabase-js'

/** Canonical keys, kept in sync with `feature_flags.key` rows. */
export const FLAG_KEYS = {
  HOME_LIVE_TOURNAMENTS_CAROUSEL: 'home_live_tournaments_carousel',
  NEWS_PIPELINE_ENRICHMENT:       'news_pipeline_enrichment',
  FORYOU_ENABLED:                 'foryou_enabled',
  SUGGEST_A_SOURCE_BUTTON:        'suggest_a_source_button',
  HOME_NEWS_IMMERSIVE_LINK:       'home_news_immersive_link',
} as const

export type FlagKey = (typeof FLAG_KEYS)[keyof typeof FLAG_KEYS]

export interface FeatureFlagRow {
  enabled: boolean | null
  enabled_local: boolean | null
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0'])

/**
 * True when the current page is being viewed on a localhost dev host.
 * Server-side rendering can't know the eventual viewer hostname, so
 * SSR returns false (treat as production) — the home page is a client
 * component and reads the flag in a useEffect, so this branch is only
 * hit during SSR shells that never render the gated section anyway.
 */
export function isLocalEnv(): boolean {
  if (typeof window === 'undefined') return false
  return LOCAL_HOSTS.has(window.location.hostname)
}

/**
 * Picks the right column for the current host. Defaults to `false`
 * when the row is missing — flags must always have a safe default.
 */
export function resolveFlag(
  row: FeatureFlagRow | null | undefined,
  defaultValue = false,
): boolean {
  if (!row) return defaultValue
  const column = isLocalEnv() ? row.enabled_local : row.enabled
  return column ?? defaultValue
}

/**
 * Reads a single flag row from the DB. Falls back to a row of nulls
 * (which `resolveFlag` will then treat as defaultValue) on missing
 * row or query error.
 *
 * Caller passes the supabase client they already use elsewhere so
 * this helper doesn't open its own connection.
 */
export async function fetchFeatureFlag(
  supabase: SupabaseClient,
  key: FlagKey,
): Promise<FeatureFlagRow> {
  const { data, error } = await supabase
    .from('feature_flags')
    .select('enabled, enabled_local')
    .eq('key', key)
    .maybeSingle()
  if (error) {
    console.warn(`[feature-flags] fetch failed for ${key}:`, error.message)
    return { enabled: null, enabled_local: null }
  }
  return {
    enabled: data?.enabled ?? null,
    enabled_local: data?.enabled_local ?? null,
  }
}

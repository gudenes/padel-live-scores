// src/lib/tier-visibility.ts
//
// Operator-controlled tier visibility. Reads the `tier_visibility`
// table (one row per tournaments.level). v1 has a single switch,
// `show_on_matches`, consumed only by the /matches data helpers
// (fetch-matches-day, fetch-matches-calendar).
//
// Fail-open: any read error → hide nothing, so /matches never goes
// blank because of this table (including before the migration lands).
// A level with no row is shown; a null tournaments.level is never hidden.
//
// Spec: docs/superpowers/specs/2026-09-27-tier-visibility-design.md

import type { SupabaseClient } from '@supabase/supabase-js'

const TTL_MS = 60_000

let cache: { value: string[]; expiresAt: number } | null = null

/** Test hook — clears the module-level cache. */
export function __resetTierVisibilityCache(): void {
  cache = null
}

/**
 * Levels hidden from the /matches page. Cached for 60s per server
 * instance — the matches page is force-dynamic, so this keeps it to
 * one tiny query per minute rather than one per request.
 */
export async function fetchMatchesHiddenTiers(
  supabase: SupabaseClient,
  now: number = Date.now(),
): Promise<string[]> {
  if (cache && cache.expiresAt > now) return cache.value

  const { data, error } = await supabase
    .from('tier_visibility')
    .select('level')
    .eq('show_on_matches', false)

  if (error) {
    console.warn('[tier-visibility] read failed, hiding nothing:', error.message)
    return []
  }

  const value = ((data ?? []) as Array<{ level: string }>).map((r) => r.level)
  cache = { value, expiresAt: now + TTL_MS }
  return value
}

/**
 * PostgREST `or` filter for the embedded tournaments resource that
 * drops hidden levels but keeps NULL levels (`level not in (...)` alone
 * is NULL for a NULL level and would hide unclassified tournaments).
 *
 * Returns null when nothing is hidden — callers must then skip the
 * filter AND the `!inner` join entirely (`not.in.()` is a 400).
 */
export function tierExclusionFilter(hiddenLevels: readonly string[]): string | null {
  if (hiddenLevels.length === 0) return null
  return `level.is.null,level.not.in.(${hiddenLevels.join(',')})`
}

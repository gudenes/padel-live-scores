// src/lib/source-priority.ts
//
// Authoritative source priority rules for every data field that can come
// from more than one upstream. Sync jobs consult these rules before
// overwriting an existing value so a secondary source can't clobber data
// owned by a primary source.
//
// HOW IT WORKS
// - Each field has an ordered list of sources, highest priority first.
// - When a sync job wants to write a value, it calls `shouldOverwrite()`
//   with the field name, the source currently recorded on the row, and
//   the source attempting the write.
// - The attempt wins if the attempting source is equal-or-higher priority
//   than the current source. Equal sources win ties (fresher data from
//   the same source is always allowed).
// - Sources not listed in the field's priority list lose to any listed
//   source (conservative: unknown sources don't overwrite known ones).
// - Fields not listed here default to "anyone can write" (so adding a
//   new field doesn't require updating this config just to make sync
//   jobs work).
//
// USAGE
// ```
// import { shouldOverwrite, SOURCE_PRIORITY } from '@/lib/source-priority'
//
// if (shouldOverwrite('player.avatar_url', row.avatar_url_source, 'fip')) {
//   row.avatar_url = newValue
//   row.avatar_url_source = 'fip'
// }
// ```
//
// CHANGING THESE RULES
// Treat this file like a schema change: require code review, deploy
// deliberately, and document the reason in the commit message. These
// rules affect data correctness — a flip that's wrong can silently
// corrupt the DB.

// ── Types ──────────────────────────────────────────────────────

/** All source names we currently know about. New sources should be added
 *  here as they're integrated so TypeScript can check field rules. */
export type SourceName =
  | 'padelapi'          // padelapi.org — primary live/schedule data
  | 'fip'               // FIP WordPress API / scraper
  | 'fip_official'      // FIP official ranking feed (subset of 'fip')
  | 'premierpadel'      // Premier Padel API — per-set match stats
  | 'manual'            // Hand-edited via ops dashboard
  | 'simulated'         // Dev/test simulator
  | 'youtube'           // YouTube Data API
  | 'rss'               // Google News / generic RSS aggregator

/** A sortable priority list for a single field. Index 0 = highest. */
export type PriorityList = readonly SourceName[]

// ── Field keys ─────────────────────────────────────────────────
// Fully-qualified "entity.field" names so we can have distinct rules
// per table even if the column name repeats (e.g. many tables have a
// name/logo/etc.)

export type FieldKey =
  // players
  | 'player.name'
  | 'player.country'
  | 'player.category'
  | 'player.avatar_url'
  | 'player.ranking'
  | 'player.points'
  | 'player.race_ranking'
  | 'player.race_points'
  | 'player.birthdate'
  | 'player.birthplace'
  | 'player.height'
  | 'player.hand'
  | 'player.side'
  | 'player.win_rate'
  | 'player.total_matches'
  | 'player.titles'
  | 'player.finals'
  // tournaments
  | 'tournament.name'
  | 'tournament.country'
  | 'tournament.level'
  | 'tournament.starts_at'
  | 'tournament.ends_at'
  | 'tournament.logo_url'
  | 'tournament.venue'
  | 'tournament.venue_address'
  | 'tournament.venue_type'
  | 'tournament.prize_money'
  | 'tournament.prize_money_fip'
  | 'tournament.prize_breakdown'
  | 'tournament.registration_status'
  | 'tournament.signup_fee_eur'
  | 'tournament.schedule_notes'
  | 'tournament.draw_size_md'
  | 'tournament.draw_size_qd'
  | 'tournament.url'
  | 'tournament.status'
  // matches
  | 'match.status'
  | 'match.winner_pair'
  | 'match.round'
  | 'match.court'
  | 'match.scheduled_at'
  | 'match.started_at'
  | 'match.finished_at'
  | 'match.duration'
  | 'match.sets'
  | 'match.coverage'
  | 'match.stats'

// ── Priority rules ─────────────────────────────────────────────

export const SOURCE_PRIORITY: Record<FieldKey, PriorityList> = {
  // ── Players ──────────────────────────────────────────────────
  // POLICY: FIP (via padelgod ingestion) is the canonical truth for player
  // identity. padelapi enriches with operational data (career stats, hosted
  // avatars). When both sources have a value, FIP wins on identity fields.
  //
  // Why FIP-primary for identity (changed 2026-05-07): FIP carries full legal
  // names (used by tournament draws + entry lists), ISO-2 country codes, and
  // is the official body — padelapi's name format is sometimes a stage name
  // ("Marta Borrero") that loses information vs. FIP's full form ("Marta
  // Borrero Fernández de la Puente"). The 2026-04 slug-style padelapi_id
  // incident showed that letting padelapi own identity creates duplicates
  // when the two name forms diverge. Primary stays with whoever has the
  // most authoritative version of the field.
  'player.name':           ['fip', 'padelapi', 'manual'],
  'player.country':        ['fip', 'padelapi', 'manual'],
  'player.category':       ['fip', 'padelapi'],
  'player.birthdate':      ['fip', 'padelapi', 'manual'],
  'player.birthplace':     ['fip', 'padelapi', 'manual'],
  'player.height':         ['fip', 'padelapi', 'manual'],
  'player.hand':           ['fip', 'padelapi', 'manual'],
  'player.side':           ['fip', 'padelapi', 'manual'],

  // Avatar stays padelapi-primary — padelapi avatars are hosted on Supabase
  // Storage (higher quality, never breaks); FIP avatars are 150×150 thumbs
  // hot-linked from padelfip.com. FIP is the fallback when we have no
  // padelapi avatar.
  'player.avatar_url':     ['padelapi', 'fip', 'manual'],

  // FIP is the authoritative ranking body — their feed wins over everything.
  'player.ranking':        ['fip_official', 'fip', 'padelapi'],
  'player.points':         ['fip_official', 'fip', 'padelapi'],
  'player.race_ranking':   ['fip_official', 'fip'],
  'player.race_points':    ['fip_official', 'fip'],

  // Career stats: padelapi maintains these, FIP doesn't publish them live
  'player.win_rate':       ['padelapi'],
  'player.total_matches':  ['padelapi'],
  'player.titles':         ['padelapi'],
  'player.finals':         ['padelapi'],

  // ── Tournaments ──────────────────────────────────────────────
  // padelapi is the operational source (schedule + matches).
  'tournament.name':       ['padelapi', 'fip', 'manual'],
  'tournament.country':    ['padelapi', 'fip'],
  'tournament.level':      ['padelapi', 'fip'],
  'tournament.starts_at':  ['padelapi', 'fip'],
  'tournament.ends_at':    ['padelapi', 'fip'],
  'tournament.status':     ['padelapi'],  // status transitions are padelapi-driven
  // padelapi doesn't actually populate venue — the column was added in
  // 20260328 specifically for FIP scraping. Promoted to fip-primary
  // 2026-04-28 so the FIP scraper can write to existing padelapi-source
  // rows (Premier tournaments) too.
  'tournament.venue':         ['fip', 'padelapi', 'manual'],
  'tournament.venue_address': ['fip', 'padelapi', 'manual'],
  'tournament.prize_money': ['padelapi', 'manual'],
  'tournament.prize_money_fip': ['fip', 'manual'],

  // FIP is the source for marketing/presentation fields.
  'tournament.logo_url':   ['fip', 'padelapi', 'manual'],
  'tournament.url':        ['fip', 'padelapi'],
  'tournament.draw_size_md': ['fip', 'padelapi'],
  'tournament.draw_size_qd': ['fip', 'padelapi'],

  // Overview-block fields scraped from padelfip.com event pages
  // (added 2026-04-28). FIP is the only source that publishes these,
  // including for Premier-tier events. `venue_type` is the "Court
  // conditions" label (covered/outdoor); `surface` is unused for now.
  'tournament.venue_type':         ['fip', 'manual'],
  'tournament.registration_status': ['fip'],
  'tournament.signup_fee_eur':     ['fip', 'manual'],
  'tournament.prize_breakdown':    ['fip', 'manual'],
  'tournament.schedule_notes':     ['fip', 'manual'],

  // ── Matches ──────────────────────────────────────────────────
  // Live match data is padelapi-only. FIP has no live scoring.
  'match.status':          ['padelapi', 'simulated'],
  'match.winner_pair':     ['padelapi', 'simulated'],
  'match.round':           ['padelapi', 'fip'],
  'match.court':           ['padelapi'],
  'match.scheduled_at':    ['padelapi', 'fip'],
  'match.started_at':      ['padelapi'],
  'match.finished_at':     ['padelapi'],
  'match.duration':        ['padelapi'],
  'match.sets':            ['padelapi', 'simulated'],
  'match.coverage':        ['padelapi'],
  'match.stats':           ['premierpadel'],
}

// ── API ────────────────────────────────────────────────────────

/**
 * Returns true if `attemptingSource` is allowed to overwrite a field whose
 * current value was written by `currentSource`.
 *
 * Rules:
 *   1. If the field has no rule, allow the write (default permissive).
 *   2. If `currentSource` is null/undefined (field is empty), allow.
 *   3. If the attempting source is not listed, reject (conservative).
 *   4. Otherwise, allow when attempting priority ≤ current priority
 *      (lower index = higher priority).
 *   5. Equal sources always win (refreshed data from the same source).
 */
export function shouldOverwrite(
  field: FieldKey,
  currentSource: SourceName | null | undefined,
  attemptingSource: SourceName
): boolean {
  // Same source always refreshes
  if (currentSource === attemptingSource) return true

  // Empty field → always allow
  if (!currentSource) return true

  const priorityList = SOURCE_PRIORITY[field]
  // Unknown field → default permissive
  if (!priorityList) return true

  const currentIdx = priorityList.indexOf(currentSource)
  const attemptingIdx = priorityList.indexOf(attemptingSource)

  // Attempting source not listed → reject
  if (attemptingIdx === -1) return false

  // Current source not listed but attempting is → allow (we're replacing
  // an unknown source with a known one, which is an improvement)
  if (currentIdx === -1) return true

  // Standard comparison: lower index = higher priority
  return attemptingIdx <= currentIdx
}

/**
 * Returns the highest-priority source that has ever been mentioned for a
 * field. Useful for UI that wants to show "this field comes from X".
 */
export function primarySourceFor(field: FieldKey): SourceName | null {
  const list = SOURCE_PRIORITY[field]
  return list?.[0] ?? null
}

/**
 * Returns the priority list for a field (readonly). Callers that need to
 * iterate in priority order can use this directly.
 */
export function prioritiesFor(field: FieldKey): PriorityList {
  return SOURCE_PRIORITY[field] ?? ([] as const)
}

// ── Payload filtering ──────────────────────────────────────────
// Helpers for sync jobs that want to hand off a raw update payload and
// let the priority config decide what they're allowed to write. This is
// the safer pattern when we don't have per-field source tracking columns
// on the row.

export type EntityType = 'player' | 'tournament' | 'match'

/**
 * Returns true if the given source is the PRIMARY owner of the field
 * (first in the priority list). Primary owners can always write.
 */
export function isPrimaryOwner(field: FieldKey, source: SourceName): boolean {
  const list = SOURCE_PRIORITY[field]
  return list?.[0] === source
}

/**
 * Returns true if the source is listed anywhere in the priority list for
 * the field. Listed sources can write when they're the primary OR as
 * fallback data (caller decides via `mode`).
 */
export function isListedSource(field: FieldKey, source: SourceName): boolean {
  const list = SOURCE_PRIORITY[field]
  return list?.includes(source) ?? false
}

/**
 * Filters an update payload by source-priority rules. The column names in
 * `payload` are matched against field keys using the `${entityType}.${col}`
 * format.
 *
 * Modes:
 *   - 'primary'  (default): keep only fields where the source is the top
 *                of the priority list. Strict — the safest for secondary
 *                sources that shouldn't overwrite primary data.
 *   - 'writable': keep fields where the source is listed anywhere in the
 *                priority list. Looser — use when the source can legally
 *                act as fallback data.
 *
 * Unknown field keys pass through unchanged (default permissive, same
 * behaviour as `shouldOverwrite()`).
 */
export function filterUpdateByPriority<T extends Record<string, unknown>>(
  payload: T,
  entityType: EntityType,
  source: SourceName,
  mode: 'primary' | 'writable' = 'primary'
): Partial<T> {
  const out: Partial<T> = {}
  for (const [col, value] of Object.entries(payload)) {
    const fieldKey = `${entityType}.${col}` as FieldKey
    const list = SOURCE_PRIORITY[fieldKey]

    if (!list) {
      // Unknown field: pass through
      ;(out as Record<string, unknown>)[col] = value
      continue
    }

    const allowed = mode === 'primary'
      ? list[0] === source
      : list.includes(source)

    if (allowed) {
      ;(out as Record<string, unknown>)[col] = value
    }
  }
  return out
}

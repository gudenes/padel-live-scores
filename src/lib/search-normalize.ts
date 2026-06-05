// src/lib/search-normalize.ts
//
// Shared helpers for accent-insensitive, display-name-aware search across
// the user-facing search surfaces (nav SearchOverlay, /search page, welcome
// picker).
//
// Why: a bare `ilike('name', '%goni%')` is accent-SENSITIVE, so it misses
// "Goñi", and it never looks at `players.display_name`, so it misses players
// fans know by a nickname (e.g. "Momo Gonzalez", whose canonical name is
// "Jeronimo Gonzalez").
//
// Players already carry a trigger-maintained `normalized_name` column
// (accent-stripped, punctuation-folded, lowercased — see
// 20260412_player_normalized_name.sql). `normalizeSearchQuery` mirrors that
// exact formula so we can compare the user's keystrokes like-with-like.
// Tournaments have no such column, so we fold accents in JS via
// `tournamentNameMatches` (the table is small — a few hundred rows).

/**
 * Mirror the DB `players.normalized_name` formula: strip diacritics, replace
 * every non-alphanumeric run with a single space, collapse whitespace,
 * lowercase, trim.
 *
 * The output contains only `[a-z0-9 ]`, which also makes it safe to splice
 * into a PostgREST `.or()` filter string (no commas / parens to break the
 * grammar).
 */
export function normalizeSearchQuery(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritical marks (≈ unaccent)
    .replace(/[^a-zA-Z0-9 ]/g, ' ') // fold punctuation to spaces, matching the DB regex
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * PostgREST `.or()` filter for player search: accent-insensitive match on the
 * canonical name (via `normalized_name`) OR a substring of the `display_name`
 * override. `norm` MUST be the output of `normalizeSearchQuery` — both for
 * correct matching and so the value is free of `.or()`-breaking characters.
 *
 * `display_name` has no normalized sibling column; seeded display names are
 * already unaccented, so matching the normalized query against it (ilike is
 * case-insensitive) covers the real data. An accented display name searched
 * by its unaccented form is the one uncovered edge — rare and acceptable.
 */
export function playerSearchOr(norm: string): string {
  return `normalized_name.ilike.%${norm}%,display_name.ilike.%${norm}%`
}

/**
 * Accent-insensitive substring test for a tournament name. Tournaments have
 * no `normalized_name` column, so we normalize the stored name on the fly and
 * test against an already-normalized query.
 */
export function tournamentNameMatches(name: string, norm: string): boolean {
  if (!norm) return false
  return normalizeSearchQuery(name).includes(norm)
}

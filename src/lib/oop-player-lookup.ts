// src/lib/oop-player-lookup.ts
//
// Maps OOP-format abbreviated player names ("C. Orsi", "P. Llaguno Zielinski")
// to existing player UUIDs in `public.players`. Used by the Schedule Review
// route to populate null pair_*_player_*_id FKs on matches when the OOP widget
// has player names but our DB has TBD slots.
//
// Why this lives outside PlayerResolver
// -------------------------------------
// PlayerResolver targets full names + FIP/padelapi identifiers and does token
// overlap via `tokenSimilarity`. OOP names are abbreviated ("C. Orsi") and
// score poorly on token overlap because the one-letter initial gets filtered
// out by the ≥2-char token guard. Instead of bending the general resolver,
// this module implements a narrow, initial-aware lookup specifically for OOP
// input. Zero impact on existing resolver callers.
//
// Resolution strategy
// -------------------
// 1. Parse "C. Orsi" into { initial: "C", surname: "Orsi" }.
// 2. Query `players` where category matches AND normalized_name contains the
//    most-distinctive (last) surname token — `ilike '%orsi%'`.
// 3. Filter the result set: candidate's first-name first-character must equal
//    the OOP initial, AND ALL surname tokens must appear in the candidate's
//    normalized name tokens.
// 4. Return the player id iff exactly one candidate survives. Zero matches or
//    multiple matches both return null — ambiguity is safer to leave alone
//    than to guess wrong.
//
// Safety: never creates players. Only reads. Callers decide whether to write
// the returned id into a currently-null match FK slot.

import type { SupabaseClient } from '@supabase/supabase-js'
import { normalize } from './player-resolver'

export interface OopAbbreviatedName {
  /** Uppercase first letter of the first name, e.g. "C" from "C. Orsi". */
  initial: string
  /** Everything after the first space, preserving multi-word surnames. */
  surname: string
}

/**
 * Parse OOP-style "X. Surname" into parts. Tolerates trailing periods on the
 * initial, multi-word surnames, and extra whitespace. Returns null for any
 * unexpected shape (empty string, single token, etc.) so callers can skip
 * safely.
 */
export function parseAbbreviatedName(
  raw: string | null | undefined,
): OopAbbreviatedName | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null

  // Split on the first whitespace run — the rest (possibly multi-word) is the
  // surname. "P. Llaguno Zielinski" → initial="P.", surname="Llaguno Zielinski".
  const match = trimmed.match(/^(\S+)\s+(.+)$/)
  if (!match) return null

  const initialRaw = match[1]!.replace(/\.$/, '').trim()
  const surnameRaw = match[2]!.trim()
  if (!initialRaw || !surnameRaw) return null

  // Only take the first character of whatever the first token was — guards
  // against weird shapes like "Ch. Surname" (some writers). Uppercase for
  // case-insensitive comparison downstream.
  return {
    initial: initialRaw.charAt(0).toUpperCase(),
    surname: surnameRaw,
  }
}

/**
 * Resolve an OOP abbreviated name to a players.id. Returns null when zero or
 * multiple candidates match — callers should leave the slot as-is (TBD) so
 * operators can decide manually.
 *
 * @param supabase  Supabase client (service-key scope recommended to see all rows)
 * @param abbreviated  e.g. "C. Orsi", "P. Llaguno Zielinski"
 * @param category  'men' | 'women' — required to scope the search
 */
export async function resolveOopPlayerToId(
  supabase: SupabaseClient,
  abbreviated: string,
  category: 'men' | 'women',
): Promise<string | null> {
  const parts = parseAbbreviatedName(abbreviated)
  if (!parts) return null

  // Tokenise surname the same way PlayerResolver normalises names, so we can
  // compare against `players.normalized_name` (stripped diacritics, lowercase,
  // non-alphanum → space).
  const surnameTokens = normalize(parts.surname)
    .split(' ')
    .filter((t) => t.length >= 2)
  if (surnameTokens.length === 0) return null

  // Use the LAST surname token as the DB filter — in Spanish/Portuguese names
  // ("Garcia Morales", "Perez Parra") the second surname is more distinctive
  // and cuts the candidate set faster. Short prefixes risk hitting names that
  // contain the substring by accident, but the post-filter restores precision.
  const searchToken = surnameTokens[surnameTokens.length - 1]!

  const { data, error } = await supabase
    .from('players')
    .select('id, name, normalized_name, category')
    .eq('category', category)
    .ilike('normalized_name', `%${searchToken}%`)
    .limit(50)

  if (error || !data) return null

  const initialLower = parts.initial.toLowerCase()

  const matches = data.filter((p) => {
    const norm = (p.normalized_name ?? normalize(p.name)) as string
    const normTokens = norm.split(' ').filter((t) => t.length > 0)
    if (normTokens.length === 0) return false

    // First-name initial: first character of the first token must match.
    // (PlayerResolver stores names as "First Middle Surname" in normalized_name.)
    if (normTokens[0]!.charAt(0) !== initialLower) return false

    // ALL surname tokens must appear — handles "Llaguno" without "Zielinski"
    // not matching "C. Llaguno Zielinski" but also prevents "Llaguno" alone
    // from matching a different "Llaguno" whose full name includes a
    // different second surname.
    for (const st of surnameTokens) {
      if (!normTokens.includes(st)) return false
    }
    return true
  })

  // Unique match only. Two candidates → ambiguous → leave TBD.
  if (matches.length === 1) return matches[0]!.id as string
  return null
}
